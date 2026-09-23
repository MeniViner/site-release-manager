/**
 * The management-auth boundary end to end.
 *
 * The defect this closes: Mongo site creation authorized directly off the
 * IIS-injected Windows identity header while the browser opted in with
 * `credentials: 'include'`. A failed silent SSO then became a NATIVE
 * username/password dialog on an ordinary "create site" click.
 *
 * The contract now: POST /api/auth/session is the only credentialed call and the
 * only consumer of the Windows identity. Consequential management operations
 * authorize from a signed bearer token, non-credentialed, and refuse with
 * application JSON.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MongoClient } = require('mongodb');

const TEST_URI = process.env.SRM_TEST_MONGO_URI || '';
const TEST_DB = `srm_mgmt_${Date.now()}`;
process.env.MONGO_URI = TEST_URI || 'mongodb://127.0.0.1:1';
process.env.MONGO_DB_NAME = TEST_DB;
process.env.BUILDER_DATA_MONGO_DB_NAME = `${TEST_DB}_data`;
process.env.STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-mgmt-'));
process.env.CLIENT_ORIGINS = 'http://localhost:5173,https://portal.army.idf';
process.env.SHAREPOINT_HOSTS = 'portal.army.idf,mazi.army.idf';
process.env.MANAGEMENT_SESSION_SECRET = 'test-management-secret-that-is-long-enough-32';

const { createApp } = require('../src/app.js');
const { issueManagementSession, verifyManagementSession } = require('../src/managementSession.js');

const DEV_IDENTITY_HEADER = 'x-daily-data-dev-user';
let available = false;
let server; let base; let connectDb; let closeDb; let db;

test.before(async () => {
  if (TEST_URI) {
    const probe = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 1500 });
    try { await probe.connect(); await probe.db(TEST_DB).command({ ping: 1 }); available = true; }
    catch { available = false; }
    finally { await probe.close().catch(() => {}); }
  }
  if (available) {
    ({ connectDb, closeDb } = require('../src/db.js'));
    db = await connectDb();
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

const openSession = async (principal = 'domain\\operator') => {
  const { status, body } = await call('/api/auth/session', {
    method: 'POST',
    headers: { [DEV_IDENTITY_HEADER]: principal, Origin: 'http://localhost:5173' },
  });
  assert.equal(status, 201, `session exchange failed: ${JSON.stringify(body)}`);
  return body.token;
};

const createPayload = (overrides = {}) => ({
  mode: 'install',
  unit: 'unit-alpha',
  name: `site-${Math.random().toString(36).slice(2, 8)}`,
  managerName: 'manager-alpha',
  storageBackend: 'mongo',
  host: 'portal.army.idf',
  siteCode: `code-${Math.random().toString(36).slice(2, 8)}`,
  ...overrides,
});

const createSite = (token, payload = createPayload(), extraHeaders = {}) => call('/api/sites', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:5173',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  },
  body: JSON.stringify(payload),
});

// ------------------------------------------------------------ token primitive

test('a management token cannot be forged or tampered with', () => {
  const { token, principal } = issueManagementSession('DOMAIN\\Alice');
  assert.equal(principal, 'domain\\alice', 'principals are normalised');
  assert.equal(verifyManagementSession(token).principal, 'domain\\alice');

  const [payload, signature] = token.split('.');
  assert.equal(verifyManagementSession(`${payload}.${'a'.repeat(signature.length)}`), null);

  // Re-signing a different principal with no secret must not verify.
  const forgedPayload = Buffer.from(JSON.stringify({
    v: 'v1', sub: 'domain\\attacker', iat: 1, exp: 9999999999,
  })).toString('base64url');
  assert.equal(verifyManagementSession(`${forgedPayload}.${signature}`), null);
  assert.equal(verifyManagementSession(''), null);
  assert.equal(verifyManagementSession('not-a-token'), null);
});

test('an expired management token is refused', () => {
  const { token } = issueManagementSession('domain\\bob', { ttlSeconds: 60 });
  assert.ok(verifyManagementSession(token));
  assert.equal(verifyManagementSession(token, { now: Date.now() + 61_000 }), null);
});

// ------------------------------------------------------------- session routes

test('whoami is unauthenticated, never challenges, and reports no session', async () => {
  const { status, headers, body } = await call('/api/auth/whoami');
  assert.equal(status, 200);
  assert.equal(headers.get('www-authenticate'), null);
  assert.equal(body.authenticated, false);
  assert.equal(body.principal, null);
});

test('the session exchange refuses a missing identity with JSON, not a challenge', async () => {
  const { status, headers, body } = await call('/api/auth/session', { method: 'POST' });
  assert.equal(status, 401);
  assert.equal(
    headers.get('www-authenticate'), null,
    'emitting a challenge here is exactly what produces the native Windows dialog',
  );
  assert.match(headers.get('content-type') || '', /application\/json/);
  assert.equal(body.error.code, 'management_identity_unavailable');
  assert.ok(body.error.message, 'the UI needs a Hebrew message to render');
});

test('an established session reports the verified principal', async () => {
  const token = await openSession('DOMAIN\\Operator');
  const { status, body } = await call('/api/auth/whoami', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(status, 200);
  assert.equal(body.authenticated, true);
  assert.equal(body.principal, 'domain\\operator');
});

// ------------------------------------------------------- create-site negative

test('creating a Mongo site without a management session fails closed as JSON', async () => {
  const { status, headers, body } = await createSite('');
  assert.equal(status, 401);
  assert.equal(headers.get('www-authenticate'), null);
  assert.equal(body.error.code, 'management_session_required');
});

test('a spoofed trusted identity header does not authorize creation', async () => {
  const { status, body } = await createSite('', createPayload(), {
    'x-iisnode-auth-user': 'DOMAIN\\attacker',
    [DEV_IDENTITY_HEADER]: 'domain\\attacker',
  });
  assert.equal(status, 401, 'identity headers are not read on this route at all');
  assert.equal(body.error.code, 'management_session_required');
});

test('a tampered bearer token does not authorize creation', async () => {
  const token = await openSession();
  const [payload] = token.split('.');
  const forged = `${payload}.${'0'.repeat(43)}`;
  const { status, body } = await createSite(forged);
  assert.equal(status, 401);
  assert.equal(body.error.code, 'management_session_required');
});

test('an expired session is refused rather than silently accepted', async () => {
  const { token } = issueManagementSession('domain\\stale', { ttlSeconds: 60, now: Date.now() - 120_000 });
  const { status, body } = await createSite(token);
  assert.equal(status, 401);
  assert.equal(body.error.code, 'management_session_required');
});

test('authorization is checked before any input validation or database read', async () => {
  // A payload that would otherwise produce 400/404 must still answer 401, so the
  // endpoint cannot be used to probe releases or existing sites.
  const { status } = await createSite('', { storageBackend: 'mongo' });
  assert.equal(status, 401, 'an unauthorized caller must not learn anything about the input');
});

test('production refuses a development identity header for the session exchange', () => {
  const script = `
    const { trustedIdentityForRequest } = require('./src/daily-data/v1/identity.js');
    const devOnly = { get: (n) => n === 'x-daily-data-dev-user' ? 'domain\\\\spoof' : '' };
    try { trustedIdentityForRequest(devOnly); process.exit(2); }
    catch (e) { if (e.code !== 'trusted_identity_required') process.exit(3); }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://srm.army.idf',
      PUBLIC_DAILY_DATA_API_URL: 'https://srm.army.idf/api/daily-data/v1',
      TRUSTED_IDENTITY_ENABLED: 'true',
      MANAGEMENT_SESSION_SECRET: 'x'.repeat(40),
    },
  });
  assert.equal(result.status, 0, result.stderr);
});

test('production will not boot without a strong management session secret', () => {
  const run = (secret) => spawnSync(process.execPath, ['-e', 'require("./src/config.js")'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://srm.army.idf',
      PUBLIC_DAILY_DATA_API_URL: 'https://srm.army.idf/api/daily-data/v1',
      MONGO_URI: 'mongodb://127.0.0.1:27017',
      MONGO_DB_NAME: 'srm',
      BUILDER_DATA_MONGO_DB_NAME: 'srm_data',
      TRUSTED_IDENTITY_ENABLED: 'true',
      TRUSTED_SITE_ACCESS_ENABLED: 'false',
      MANAGEMENT_SESSION_SECRET: secret,
    },
  });
  assert.notEqual(run('').status, 0, 'an empty secret must fail closed');
  assert.notEqual(run('short').status, 0, 'a guessable secret must fail closed');
  assert.equal(run('y'.repeat(40).concat('')).status, 0);
});

// ------------------------------------------------------- create-site positive

test('the authorized create flow establishes a site with a verified owner', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const token = await openSession('DOMAIN\\Owner');
  const payload = createPayload();
  const { status, body } = await createSite(token, payload);
  assert.equal(status, 201, `create failed: ${JSON.stringify(body)}`);

  const stored = await db.collection('sites').findOne({ name: payload.name });
  assert.ok(stored, 'site metadata must be durably persisted');
  assert.equal(stored.storageBackend, 'mongo');
  assert.ok(stored.builderSiteId, 'a stable server-allocated siteId is required');

  // Verified initial owner/admin, never ownerless.
  for (const role of ['viewers', 'submitters', 'editors', 'administrators']) {
    assert.ok(
      stored.dataAccess[role].includes('domain\\owner'),
      `the creator must be the initial ${role}`,
    );
  }
});

test('no Mongo site can be stored without an owner', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const ownerless = await db.collection('sites').find({
    storageBackend: 'mongo',
    $or: [
      { dataAccess: null },
      { 'dataAccess.administrators': { $size: 0 } },
      { 'dataAccess.administrators': { $exists: false } },
    ],
  }).toArray();
  assert.deepEqual(ownerless, [], 'an ownerless Mongo site must be impossible to create');
});

test('a replayed creation does not duplicate the site identity', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const token = await openSession('domain\\replay');
  const payload = createPayload();
  const first = await createSite(token, payload);
  assert.equal(first.status, 201);
  const second = await createSite(token, payload);

  const stored = await db.collection('sites').find({ name: payload.name }).toArray();
  if (second.status === 201) {
    // If a second record is permitted it must still be a DISTINCT allocation,
    // never a silent reuse of another logical site's data identity.
    const ids = new Set(stored.map((row) => row.builderSiteId));
    assert.equal(ids.size, stored.length, 'each logical site needs its own builderSiteId');
  } else {
    assert.equal(stored.length, 1, 'a refused replay must not leave a second record');
  }
});

test('data-access administration requires a management session and admin role', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const ownerToken = await openSession('domain\\access-owner');
  const payload = createPayload();
  const created = await createSite(ownerToken, payload);
  assert.equal(created.status, 201);
  const site = await db.collection('sites').findOne({ name: payload.name });
  const id = String(site._id);

  const patch = (token) => call(`/api/sites/${id}/data-access`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      dataAccess: {
        viewers: ['domain\\reader'],
        submitters: ['domain\\reader'],
        editors: ['domain\\access-owner'],
        administrators: ['domain\\access-owner'],
        sharePointReadAccess: false,
        sharePointInteractionAccess: false,
      },
    }),
  });

  const anonymous = await patch('');
  assert.equal(anonymous.status, 401, 'no session means no access administration');

  const stranger = await patch(await openSession('domain\\stranger'));
  assert.equal(stranger.status, 403, 'a non-administrator must be refused');

  const owner = await patch(ownerToken);
  assert.equal(owner.status, 200, `owner patch failed: ${JSON.stringify(owner.body)}`);

  const updated = await db.collection('sites').findOne({ _id: site._id });
  assert.ok(updated.dataAccess.viewers.includes('domain\\reader'), 'the change must take effect');
  assert.ok(!updated.dataAccess.administrators.includes('domain\\reader'), 'roles must stay distinct');
});
