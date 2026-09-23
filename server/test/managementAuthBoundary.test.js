/**
 * The management-auth boundary and the non-site readiness contract.
 *
 * Two defects motivated this suite:
 *
 *  1. `/healthz` and `/readyz` sat BEHIND the daily-data identity middleware, so
 *     Site Builder's canonical readiness probe -- which is deliberately
 *     unauthenticated and only accepts JSON `ok === true` -- got a 401 instead.
 *
 *  2. Mongo site creation combined an IIS-injected Windows identity header with a
 *     credentialed browser fetch. When IIS could not authenticate silently it
 *     answered 401 + `WWW-Authenticate`, and because the browser was allowed to
 *     join the handshake that escalated into a NATIVE username/password dialog.
 *     The management boundary must fail closed with application JSON instead.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MongoClient } = require('mongodb');

const TEST_URI = process.env.SRM_TEST_MONGO_URI || '';
const TEST_DB = `srm_auth_${Date.now()}`;
process.env.MONGO_URI = TEST_URI || 'mongodb://127.0.0.1:1';
process.env.MONGO_DB_NAME = TEST_DB;
process.env.BUILDER_DATA_MONGO_DB_NAME = `${TEST_DB}_data`;
process.env.STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-auth-'));
process.env.CLIENT_ORIGINS = 'http://localhost:5173,https://portal.army.idf';
process.env.SHAREPOINT_HOSTS = 'portal.army.idf,mazi.army.idf';

const { createApp } = require('../src/app.js');

let available = false;
let server;
let base;
let connectDb;
let closeDb;

test.before(async () => {
  if (TEST_URI) {
    const probe = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 1500 });
    try { await probe.connect(); await probe.db(TEST_DB).command({ ping: 1 }); available = true; }
    catch { available = false; }
    finally { await probe.close().catch(() => {}); }
  }
  if (available) {
    ({ connectDb, closeDb } = require('../src/db.js'));
    await connectDb();
  }
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (available && closeDb) await closeDb().catch(() => {});
});

const call = async (pathname, options = {}) => {
  const response = await fetch(`${base}${pathname}`, options);
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  return { status: response.status, headers: response.headers, body };
};

const DAILY = '/api/daily-data/v1';

// ---------------------------------------------------------------- readiness

test('healthz answers unauthenticated JSON', async () => {
  const { status, headers, body } = await call(`${DAILY}/healthz`);
  assert.equal(status, 200, 'health must not require an identity');
  assert.match(headers.get('content-type') || '', /application\/json/);
  assert.equal(body.ok, true);
});

test('readyz answers unauthenticated JSON and never challenges', async () => {
  const { status, headers, body } = await call(`${DAILY}/readyz`);
  assert.equal(status, 200, 'readiness must not require an identity');
  assert.match(headers.get('content-type') || '', /application\/json/,
    'Site Builder only accepts JSON readiness, never an HTML 200');
  assert.equal(
    headers.get('www-authenticate'), null,
    'a readiness probe must never emit a browser auth challenge',
  );
  assert.equal(typeof body.ok, 'boolean');
  assert.equal(body.service, 'site-release-manager-daily-data');
});

test('readyz reports ok === true only when the required collections exist', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed readiness tests.');
  const { status, body } = await call(`${DAILY}/readyz`);
  assert.equal(status, 200);
  if (body.ok !== true) {
    // Unready is a legitimate state, but it must be explicit and not a bare 200.
    assert.equal(body.readiness, 'not_ready');
    assert.ok(Array.isArray(body.missingCollections) && body.missingCollections.length > 0);
  } else {
    assert.equal(body.readiness, 'ready');
    assert.deepEqual(body.missingCollections, []);
  }
});

// ------------------------------------------------- site data stays protected

test('site data still requires an identity after readiness was opened up', async () => {
  const { status, body } = await call(`${DAILY}/sites/any-site/data/alerts`);
  assert.equal(status, 401, 'opening readiness must not open site data');
  assert.equal(body.ok ?? false, false);
  assert.ok(body.error?.code || body.code, 'the refusal must carry a machine-readable code');
});

test('a site data refusal is application JSON, not a native auth challenge', async () => {
  const { headers, body } = await call(`${DAILY}/sites/any-site/data/alerts`);
  assert.equal(
    headers.get('www-authenticate'), null,
    'emitting WWW-Authenticate is what turns a 401 into a native Windows popup',
  );
  assert.match(headers.get('content-type') || '', /application\/json/);
  assert.ok(body && typeof body === 'object');
});

// ------------------------------------------- management create-site boundary

test('Mongo site creation refuses anonymously with JSON and no auth challenge', async () => {
  const { status, headers, body } = await call('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({
      mode: 'install',
      unit: 'probe-unit',
      name: 'popup-probe',
      managerName: 'probe-manager',
      storageBackend: 'mongo',
      host: 'portal.army.idf',
      siteCode: 'popup-probe',
    }),
  });
  assert.ok(status === 401 || status === 403,
    `an unauthorized create must fail closed, got ${status}`);
  assert.equal(
    headers.get('www-authenticate'), null,
    'the management API must never ask the browser to open a credential dialog',
  );
  assert.match(headers.get('content-type') || '', /application\/json/,
    'the client needs an actionable JSON error, not an IIS challenge');
  assert.ok(body && typeof body === 'object');
});

test('a browser-supplied identity header cannot forge a management principal', async () => {
  const { status, headers } = await call('/api/sites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      'x-iisnode-auth-user': 'DOMAIN\\attacker',
    },
    body: JSON.stringify({
      mode: 'install',
      unit: 'probe-unit',
      name: 'spoof-probe',
      managerName: 'probe-manager',
      storageBackend: 'mongo',
      host: 'portal.army.idf',
      siteCode: 'spoof-probe',
    }),
  });
  assert.equal(
    headers.get('www-authenticate'), null,
    'a spoof attempt must not trigger a credential dialog either',
  );
  // In development the dev-identity header is the only accepted source, so a
  // forged production-style trusted header must not be honoured here.
  assert.ok(status !== 201, 'a forged trusted header must never create a site');
});

test('readiness reports not_ready as JSON when the database is unreachable', async () => {
  // Without SRM_TEST_MONGO_URI the app points at an unreachable Mongo. The probe
  // must still answer parseable JSON: a 500 (or an HTML error page) would break
  // Site Builder's deploy gate, which only understands JSON ok===true.
  const { status, headers, body } = await call(`${DAILY}/readyz`);
  assert.equal(status, 200, 'readiness must not fail the request');
  assert.match(headers.get('content-type') || '', /application\/json/);
  assert.equal(typeof body.ok, 'boolean');
  assert.equal(body.service, 'site-release-manager-daily-data');
  if (body.ok === false) {
    assert.equal(body.readiness, 'not_ready');
    // Never leak a stack, a connection string or credentials.
    const serialized = JSON.stringify(body);
    assert.ok(!/mongodb:\/\//.test(serialized), 'the connection URI must not be exposed');
    assert.ok(!/ {4}at /.test(serialized), 'a stack trace must not be exposed');
  }
});
