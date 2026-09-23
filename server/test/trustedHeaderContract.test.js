/**
 * The trusted-header contract between IIS and the Node application.
 *
 * Both headers the app treats as trusted are spoofable unless IIS overwrites
 * them on EVERY request. Two concrete defects are locked down here:
 *
 *  1. The rewrite rule that stamped X-IISNode-Auth-User was guarded by
 *     "{REQUEST_FILENAME} is not a file", so a request resolving to a real file
 *     (index.cjs is itself the iisnode handler) bypassed the stamp and carried
 *     the caller's own header into Node.
 *
 *  2. x-iisnode-sharepoint-sites -- the per-site access list for ordinary users
 *     -- was read by the app but never written by IIS, so it was entirely
 *     caller-supplied.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WEB_CONFIG = path.resolve(__dirname, '..', '..', 'web.config');
const xml = fs.readFileSync(WEB_CONFIG, 'utf8');

function ruleBlock(name) {
  const start = xml.indexOf(`<rule name="${name}"`);
  assert.notEqual(start, -1, `web.config must declare the ${name} rule`);
  const end = xml.indexOf('</rule>', start);
  return xml.slice(start, end);
}

test('the trusted identity header is stamped by an unconditional rule', () => {
  const block = ruleBlock('StampTrustedIdentityHeaders');
  assert.match(block, /<match url="\.\*" \/>/, 'the stamping rule must match every URL');
  assert.ok(
    !block.includes('<conditions'),
    'the stamping rule must carry NO conditions; a conditional stamp can be bypassed',
  );
  assert.match(
    block,
    /<set name="HTTP_X_IISNODE_AUTH_USER" value="\{AUTH_USER\}" replace="true" \/>/,
    'the identity header must be replaced, not merely added',
  );
});

test('the per-site access header is blanked until a server-side adapter exists', () => {
  const block = ruleBlock('StampTrustedIdentityHeaders');
  assert.match(
    block,
    /<set name="HTTP_X_IISNODE_SHAREPOINT_SITES" value="" replace="true" \/>/,
    'nothing in IIS derives per-site membership, so the header must be cleared',
  );
});

test('the stamping rule runs before the SPA fallback and does not stop processing', () => {
  const stampAt = xml.indexOf('<rule name="StampTrustedIdentityHeaders"');
  const fallbackAt = xml.indexOf('<rule name="SiteReleaseManager"');
  assert.ok(stampAt > -1 && fallbackAt > -1);
  assert.ok(stampAt < fallbackAt, 'headers must be stamped before any rule can stop processing');
  assert.match(ruleBlock('StampTrustedIdentityHeaders'), /stopProcessing="false"/);
});

test('the SPA fallback no longer owns the identity stamp', () => {
  const block = ruleBlock('SiteReleaseManager');
  assert.ok(
    !block.includes('HTTP_X_IISNODE_AUTH_USER'),
    'the conditional fallback rule must not be the only place identity is stamped',
  );
});

test('the IIS upload ceiling and protected segments are preserved', () => {
  assert.match(xml, /maxAllowedContentLength="629145600"/);
  for (const segment of ['server', 'storage', 'scripts', '.env', 'node_modules']) {
    assert.ok(xml.includes(`<add segment="${segment}" />`), `${segment} must stay hidden`);
  }
});

test('web.config declares no local iisnode section', () => {
  assert.ok(!/<iisnode\b/.test(xml), 'a local <iisnode> section breaks the locked-down profile');
});

// The per-site access header is no longer read by the application at all; the
// remaining contract is simply that web.config keeps blanking it.
test('the shipped IIS env template keeps the trusted identity boundary on', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '..', '..', '.env.iis.example'), 'utf8');
  const setting = (key) => {
    const line = template.split(/\r?\n/).find((row) => row.trim().startsWith(`${key}=`));
    return line ? line.split('=').slice(1).join('=').trim() : '';
  };
  assert.equal(setting('TRUSTED_IDENTITY_ENABLED').toLowerCase(), 'true');
  assert.ok(setting('MANAGEMENT_SESSION_SECRET'), 'the template must prompt for a signing secret');
  assert.ok(
    !template.includes('TRUSTED_SITE_ACCESS_ENABLED'),
    'the removed header-derived access path must not reappear in the template',
  );
});

// ------------------------------------------------- route-specific auth topology

function locationBlock(path) {
  const start = xml.indexOf(`<location path="${path}"`);
  assert.notEqual(start, -1, `web.config must declare a <location> for ${path}`);
  return xml.slice(start, xml.indexOf('</location>', start));
}

test('the application baseline is anonymous so Bearer requests are never challenged', () => {
  // Challenging a Bearer-authorized management call is what turned an ordinary
  // click into a native Windows credential dialog.
  const root = xml.slice(0, xml.indexOf('</system.webServer>'));
  assert.match(root, /<anonymousAuthentication enabled="true" \/>/);
  assert.match(root, /<windowsAuthentication enabled="false" \/>/);
});

test('the session exchange is the ONLY Windows-authenticated management path', () => {
  const session = locationBlock('api/auth/session');
  assert.match(session, /<anonymousAuthentication enabled="false" \/>/);
  assert.match(session, /<windowsAuthentication enabled="true" \/>/);

  // Any other management location would re-open the dialog on routine traffic.
  const managementLocations = [...xml.matchAll(/<location path="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith('api/') && !path.startsWith('api/daily-data/'));
  assert.deepEqual(managementLocations, ['api/auth/session']);
});

test('Daily Data site routes keep the end-user Windows identity', () => {
  // A different boundary on purpose: these authorize the actual signed-in user
  // against each site's dataAccess lists, so a management session is not enough.
  const daily = locationBlock('api/daily-data/v1/sites');
  assert.match(daily, /<anonymousAuthentication enabled="false" \/>/);
  assert.match(daily, /<windowsAuthentication enabled="true" \/>/);
});

test('health and readiness are NOT inside an authenticated location', () => {
  // Site Builder's deploy gate calls readyz unauthenticated.
  for (const path of ['api/daily-data/v1/healthz', 'api/daily-data/v1/readyz', 'api/health']) {
    assert.equal(
      xml.includes(`<location path="${path}"`), false,
      `${path} must stay on the anonymous baseline`,
    );
  }
});

test('CORS preflight is diverted to an anonymous handler before authentication', () => {
  const start = xml.indexOf('<rule name="AnonymousCorsPreflight"');
  assert.notEqual(start, -1, 'a browser preflight carries no credentials and must not be challenged');
  const rule = xml.slice(start, xml.indexOf('</rule>', start));
  assert.match(rule, /<add input="\{REQUEST_METHOD\}" pattern="\^OPTIONS\$" \/>/);
  assert.match(rule, /api\/daily-data\/v1\/sites/);
  assert.match(rule, /<action type="Rewrite" url="api\/cors-preflight\/daily-data" \/>/);

  // It must be evaluated before the SPA fallback can stop processing.
  assert.ok(start < xml.indexOf('<rule name="SiteReleaseManager"'));
});

test('the identity stamp still runs before the preflight diversion', () => {
  // Order matters: a diverted OPTIONS must not be able to carry a forged header.
  assert.ok(
    xml.indexOf('<rule name="StampTrustedIdentityHeaders"') < xml.indexOf('<rule name="AnonymousCorsPreflight"'),
    'trusted headers must be re-stamped first, unconditionally',
  );
});

test('the deployment README documents the allowedServerVariables prerequisite', () => {
  // URL Rewrite silently refuses to set a server variable that is not allow-listed,
  // which would leave the trusted header empty and every session refused.
  const readme = fs.readFileSync(path.resolve(__dirname, '..', '..', 'IIS-DEPLOY-README.txt'), 'utf8');
  assert.match(readme, /allowedServerVariables/i);
  assert.match(readme, /HTTP_X_IISNODE_AUTH_USER/);
  assert.match(readme, /HTTP_X_IISNODE_SHAREPOINT_SITES/);
});
