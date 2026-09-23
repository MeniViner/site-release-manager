const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSharePointAccessResolver, hasRole } = require('../src/daily-data/v1/identity.js');
const { trustedHeaderName } = require('../src/config.js');

function request(siteIds) {
  return { get: (name) => name === 'x-iisnode-sharepoint-sites' ? siteIds : '' };
}

test('trusted SharePoint access grants only the matching site baseline capabilities', () => {
  const resolver = createSharePointAccessResolver({ enabled: true, headerName: 'x-iisnode-sharepoint-sites' });
  const site = {
    builderSiteId: 'srm-alpha',
    dataAccess: { viewers: [], submitters: [], editors: [], administrators: [], sharePointReadAccess: true, sharePointInteractionAccess: true },
  };
  assert.equal(resolver.allows(request('srm-alpha'), site, 'viewers'), true);
  assert.equal(resolver.allows(request('srm-alpha'), site, 'submitters'), true);
  assert.equal(resolver.allows(request('srm-bravo'), site, 'viewers'), false);
  assert.equal(resolver.allows(request('srm-alpha'), { ...site, builderSiteId: 'srm-bravo' }, 'viewers'), false);
});

test('baseline SharePoint access never escalates to editor or administrator', () => {
  const site = {
    builderSiteId: 'srm-alpha',
    dataAccess: { viewers: [], submitters: [], editors: [], administrators: [], sharePointReadAccess: true, sharePointInteractionAccess: true },
  };
  const req = request('srm-alpha');
  assert.equal(hasRole(site, 'ordinary-user', 'editors', req), false);
  assert.equal(hasRole(site, 'ordinary-user', 'administrators', req), false);
});

test('the IIS rewrite header uses the canonical hyphenated HTTP name', () => {
  assert.equal(trustedHeaderName('X-IISNode-Auth-User'), 'x-iisnode-auth-user');
  assert.throws(
    () => trustedHeaderName('x-iisnode-auth_user'),
    /maps to hyphens, not underscores/,
  );
});

test('production rejects development identity headers and accepts only the trusted boundary', () => {
  const script = `
    const { trustedIdentityForRequest } = require('./src/daily-data/v1/identity.js');
    const devOnly = { get: (name) => name === 'x-daily-data-dev-user' ? 'spoofed-user' : '' };
    try {
      trustedIdentityForRequest(devOnly);
      process.exit(2);
    } catch (error) {
      if (error.code !== 'trusted_identity_required') throw error;
    }
    const trusted = { get: (name) => name === 'x-iisnode-auth-user' ? 'DOMAIN\\\\Alice' : '' };
    if (trustedIdentityForRequest(trusted) !== 'domain\\\\alice') process.exit(3);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://sitebuilderhub.idf',
      PUBLIC_DAILY_DATA_API_URL: 'https://sitebuilderhub.idf/api/daily-data/v1',
      MONGO_URI: 'mongodb://127.0.0.1:27018',
      MONGO_DB_NAME: 'test-management',
      BUILDER_DATA_MONGO_DB_NAME: 'test-builder',
      TRUSTED_IDENTITY_ENABLED: 'true',
      TRUSTED_IDENTITY_HEADER: 'x-iisnode-auth-user',
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
