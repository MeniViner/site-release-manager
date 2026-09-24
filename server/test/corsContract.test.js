/**
 * The cross-origin management contract, asserted against the REAL Express app.
 *
 * A browser refuses a request whose preflight does not advertise the method and
 * every non-safelisted header the client will send. That refusal happens before
 * the server is reached, so a route can be perfectly authorized and still be
 * unusable from the SharePoint-hosted UI. These tests pin the preflight to what
 * client/src/api.js actually sends.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.MONGO_URI = process.env.SRM_TEST_MONGO_URI || 'mongodb://127.0.0.1:1';
process.env.MONGO_DB_NAME = `srm_cors_${Date.now()}`;
process.env.STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-cors-'));
process.env.CLIENT_ORIGINS = 'http://localhost:5173,https://portal.army.idf';
process.env.SHAREPOINT_HOSTS = 'portal.army.idf,mazi.army.idf';
process.env.MANAGEMENT_SESSION_SECRET = 'cors-test-management-secret-32-chars-x';

const {
  createApp,
  MANAGEMENT_SESSION_REQUEST_HEADERS,
  ALLOWED_REQUEST_HEADERS,
} = require('../src/app.js');

const ORIGIN = 'https://portal.army.idf';
let server;
let base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { if (server) await new Promise((r) => server.close(r)); });

/** Exactly what a browser sends before the real request. */
async function preflight(pathname, method, requestHeaders) {
  const response = await fetch(`${base}${pathname}`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': method,
      'Access-Control-Request-Headers': requestHeaders.join(','),
    },
  });
  const allowHeaders = String(response.headers.get('access-control-allow-headers') || '').toLowerCase();
  const allowMethods = String(response.headers.get('access-control-allow-methods') || '').toUpperCase();
  return {
    status: response.status,
    origin: response.headers.get('access-control-allow-origin'),
    credentials: response.headers.get('access-control-allow-credentials'),
    allows: (header) => allowHeaders.includes(header.toLowerCase()),
    permits: (verb) => allowMethods.includes(verb),
  };
}

/** Every management operation client/src/api.js performs, with its real headers. */
const MANAGEMENT_OPERATIONS = [
  ['POST', '/api/sites', ['content-type', 'authorization', 'idempotency-key'], 'Mongo create'],
  ['PATCH', '/api/sites/abc123', ['content-type', 'authorization'], 'site update'],
  ['DELETE', '/api/sites/abc123', ['authorization'], 'site delete'],
  ['PATCH', '/api/sites/abc123/data-access', ['content-type', 'authorization'], 'data access'],
  ['POST', '/api/sites/abc123/deploy', ['content-type', 'authorization'], 'deployment'],
  ['POST', '/api/releases/upload', ['authorization'], 'release upload'],
  ['POST', '/api/releases/upload-folder', ['authorization'], 'release folder upload'],
  ['PATCH', '/api/releases/abc123', ['content-type', 'authorization'], 'release update'],
  ['DELETE', '/api/releases/abc123', ['authorization'], 'release delete'],
  ['GET', '/api/auth/whoami', ['authorization'], 'whoami'],
];

for (const [method, pathname, headers, label] of MANAGEMENT_OPERATIONS) {
  test(`preflight allows ${label} (${method} ${pathname})`, async () => {
    const result = await preflight(pathname, method, headers);
    assert.equal(result.status, 204, `${label} preflight must succeed`);
    assert.equal(result.origin, ORIGIN, `${label} must be allowed from the UI origin`);
    assert.ok(result.permits(method), `${label} must advertise ${method}`);
    for (const header of headers) {
      assert.ok(result.allows(header), `${label} must advertise ${header}`);
    }
    // Management mutations are Bearer-authorized and must NOT be credentialed:
    // browser credentials here are what let an IIS challenge become a native
    // Windows login dialog.
    assert.notEqual(result.credentials, 'true', `${label} must stay non-credentialed`);
  });
}

test('Idempotency-Key survives preflight, or a create retry becomes a second site', async () => {
  const result = await preflight('/api/sites', 'POST', ['content-type', 'authorization', 'idempotency-key']);
  assert.ok(result.allows('idempotency-key'));
  assert.ok(MANAGEMENT_SESSION_REQUEST_HEADERS.map((h) => h.toLowerCase()).includes('idempotency-key'));
});

test('TXT and Mongo deployment share one preflight contract', async () => {
  // Deployment is backend-agnostic on the wire; both go through the same route.
  for (const siteId of ['txt-site-id', 'srm-mongo-site-id']) {
    const result = await preflight(`/api/sites/${siteId}/deploy`, 'POST', ['content-type', 'authorization']);
    assert.equal(result.status, 204);
    assert.ok(result.permits('POST'));
    assert.ok(result.allows('authorization'));
  }
});

test('the deploy worker keeps its own lease boundary', async () => {
  const result = await preflight('/api/deployments/job123/claim', 'POST', ['content-type', 'x-srm-lease']);
  assert.equal(result.status, 204);
  assert.ok(result.allows('x-srm-lease'), 'the worker lease header must survive preflight');
  assert.ok(ALLOWED_REQUEST_HEADERS.includes('X-SRM-Lease'));
  assert.notEqual(result.credentials, 'true');
});

test('Daily Data answers its own preflight anonymously, before any identity check', async () => {
  // This is the REAL path a browser preflights. The cors middleware
  // short-circuits OPTIONS ahead of the identity middleware, which is why no
  // intermediate route is needed -- and why IIS only has to avoid challenging it.
  const response = await fetch(`${base}/api/daily-data/v1/sites/any-site/data/alerts`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type,if-match',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  const allow = String(response.headers.get('access-control-allow-headers')).toLowerCase();
  assert.ok(allow.includes('if-match'), 'conditional writes need If-Match');
  assert.match(String(response.headers.get('access-control-allow-methods')).toUpperCase(), /PUT/);
  assert.equal(response.headers.get('www-authenticate'), null);
});

test('the real Daily Data request behind that preflight is still protected', async () => {
  const response = await fetch(`${base}/api/daily-data/v1/sites/any-site/data/alerts`, {
    headers: { Origin: ORIGIN },
  });
  assert.equal(response.status, 401, 'opening the preflight must not open the data');
});

test('only the session exchange is a credentialed management preflight', async () => {
  const session = await preflight('/api/auth/session', 'POST', ['accept']);
  assert.equal(session.status, 204);
  assert.equal(session.credentials, 'true');
});

test('an unconfigured origin is refused at preflight', async () => {
  const response = await fetch(`${base}/api/sites`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://not-configured.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization',
    },
  });
  assert.notEqual(response.headers.get('access-control-allow-origin'), 'https://not-configured.example');
});

test('a preflight never authorizes the request behind it', async () => {
  // The preflight succeeding says nothing about the mutation: without a session
  // the real request must still fail closed, with no browser challenge.
  const response = await fetch(`${base}/api/sites/abc123`, {
    method: 'DELETE',
    headers: { Origin: ORIGIN },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), null);
  const body = await response.json();
  assert.equal(body.error.code, 'management_session_required');
});
