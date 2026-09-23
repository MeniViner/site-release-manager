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

test('a replayed creation converges on ONE logical site, job and provisioning', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const token = await openSession('domain\\replay');
  const payload = createPayload();
  const key = `idem-${Date.now()}-a`;

  const first = await createSite(token, payload, { 'Idempotency-Key': key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const firstId = first.body.site.builderSiteId;

  // Response loss AFTER insertion, after provisioning and after job creation all
  // look the same to the client: it simply sends the request again.
  const replay = await createSite(token, payload, { 'Idempotency-Key': key });
  assert.equal(replay.status, 200, 'a replay is not a new creation');
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.site.builderSiteId, firstId, 'the same logical site must come back');

  const stored = await db.collection('sites').find({
    creationIdempotencyOwner: 'domain\\replay',
    creationIdempotencyKey: key,
  }).toArray();
  assert.equal(stored.length, 1, 'a retry must never leave a second record');

  // Defaults are not duplicated by the resumed provisioning.
  assert.equal(
    replay.body.mongoProvisioning?.provisionStatus?.missingDefaults, 0,
    'the resumed site must still be fully provisioned',
  );
  assert.equal(
    replay.body.mongoProvisioning?.createdCount, 0,
    'a resumed provisioning must create nothing the first pass already created',
  );
});

test('concurrent retries of one intent converge on a single site', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const token = await openSession('domain\\concurrent');
  const payload = createPayload();
  const key = `idem-${Date.now()}-concurrent`;

  const responses = await Promise.all(
    Array.from({ length: 4 }, () => createSite(token, payload, { 'Idempotency-Key': key })),
  );

  // The requirement is convergence, not a particular split of 201/200: which
  // racer wins the insert and which of them additionally races on provisioning
  // is timing, and asserting a fixed split would encode an implementation
  // detail. What must hold is that every racer succeeds and they all end up on
  // the same site.
  const statuses = responses.map((r) => r.status);
  assert.ok(
    statuses.every((status) => status === 200 || status === 201),
    `every racer must succeed, got ${JSON.stringify(statuses)}`,
  );
  assert.equal(statuses.filter((s) => s === 201).length <= 1, true, 'at most one racer may report a fresh creation');

  const ids = new Set(responses.map((r) => r.body.site.builderSiteId));
  assert.equal(ids.size, 1, 'all racers must converge on ONE builderSiteId');

  const stored = await db.collection('sites').find({
    creationIdempotencyOwner: 'domain\\concurrent',
    creationIdempotencyKey: key,
  }).toArray();
  assert.equal(stored.length, 1, 'no orphaned allocation may survive the race');
});

test('a reused key with materially different input is rejected', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const token = await openSession('domain\\conflict');
  const key = `idem-${Date.now()}-conflict`;
  const first = await createSite(token, createPayload(), { 'Idempotency-Key': key });
  assert.equal(first.status, 201);

  const different = await createSite(token, createPayload({ unit: 'a-different-unit' }), { 'Idempotency-Key': key });
  assert.equal(different.status, 409, 'reusing a key for different input is a client bug, not a retry');
  assert.equal(different.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
});

test('a deliberately different site uses a new key and allocates separately', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const token = await openSession('domain\\distinct');
  const a = await createSite(token, createPayload(), { 'Idempotency-Key': `idem-${Date.now()}-x` });
  const b = await createSite(token, createPayload(), { 'Idempotency-Key': `idem-${Date.now()}-y` });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.site.builderSiteId, b.body.site.builderSiteId,
    'distinct intents remain distinct logical sites');
});

test('an idempotency key is scoped to the operator who owns it', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const key = `idem-${Date.now()}-shared`;
  const payload = createPayload();
  const mine = await createSite(await openSession('domain\\owner-a'), payload, { 'Idempotency-Key': key });
  assert.equal(mine.status, 201);

  // The same key from a different operator must not resolve to someone else's
  // site, and must not be able to read it back.
  const theirs = await createSite(await openSession('domain\\owner-b'), createPayload(), { 'Idempotency-Key': key });
  assert.ok(theirs.status === 201 || theirs.status === 409, `unexpected ${theirs.status}`);
  if (theirs.status === 201) {
    assert.notEqual(theirs.body.site.builderSiteId, mine.body.site.builderSiteId,
      'one operator must never resume another operator\'s creation');
  }
});

test('creation without a key still works and stays non-idempotent', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed creation tests.');
  const token = await openSession('domain\\nokey');
  const first = await createSite(token, createPayload());
  assert.equal(first.status, 201, 'the key is optional for compatibility');
  assert.notEqual(first.body.idempotent, true);
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

// ------------------------------------------------- spoofing AT THE ISSUER

test('the token issuer itself cannot be spoofed by a browser-supplied header', async () => {
  // A mutation rejecting a forged header proves nothing about issuance: the
  // mutation never reads identity headers at all. The issuer DOES, so this is
  // where spoof resistance has to be demonstrated.
  //
  // In production `trustedIdentityForRequest` accepts only
  // config.trustedIdentityHeader, which web.config re-stamps unconditionally, and
  // refuses the development header outright. Here (development) the production
  // header must not be honoured.
  const { status, headers, body } = await call('/api/auth/session', {
    method: 'POST',
    headers: { 'x-iisnode-auth-user': 'DOMAIN\\attacker', Origin: 'http://localhost:5173' },
  });
  assert.equal(status, 401, 'a production-style trusted header must not mint a session here');
  assert.equal(body.error.code, 'management_identity_unavailable');
  assert.equal(headers.get('www-authenticate'), null);
});

test('an issued token names the identity the issuer saw, not one the caller asked for', async () => {
  const { body } = await call('/api/auth/session', {
    method: 'POST',
    headers: {
      [DEV_IDENTITY_HEADER]: 'domain\\real-user',
      'x-iisnode-auth-user': 'domain\\claimed-admin',
    },
  });
  assert.equal(body.principal, 'domain\\real-user', 'the caller may not choose the subject');
  assert.equal(verifyManagementSession(body.token).principal, 'domain\\real-user');
});

test('an unauthorized operator gets a session but no access to another site', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed tests.');
  // Holding a valid session is authentication, not authorization.
  const ownerToken = await openSession('domain\\legit-owner');
  const payload = createPayload();
  assert.equal((await createSite(ownerToken, payload)).status, 201);
  const site = await db.collection('sites').findOne({ name: payload.name });

  const strangerToken = await openSession('domain\\stranger-operator');
  const { status } = await call(`/api/sites/${String(site._id)}/data-access`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${strangerToken}` },
    body: JSON.stringify({
      dataAccess: {
        viewers: ['domain\\stranger-operator'], submitters: [], editors: [],
        administrators: ['domain\\stranger-operator'],
        sharePointReadAccess: false, sharePointInteractionAccess: false,
      },
    }),
  });
  assert.equal(status, 403, 'a valid session must not grant another site\'s administration');
});

test('concurrent session acquisition yields independently valid tokens', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => call('/api/auth/session', {
    method: 'POST',
    headers: { [DEV_IDENTITY_HEADER]: 'domain\\concurrent-operator' },
  })));
  assert.ok(results.every((r) => r.status === 201), 'every concurrent acquisition must succeed');
  for (const r of results) {
    assert.equal(verifyManagementSession(r.body.token).principal, 'domain\\concurrent-operator');
  }
});

// ----------------------------------------------- consequential operations

test('every consequential management mutation requires a session', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed tests.');
  const token = await openSession('domain\\inventory');
  const payload = createPayload();
  assert.equal((await createSite(token, payload)).status, 201);
  const site = await db.collection('sites').findOne({ name: payload.name });
  const id = String(site._id);

  // The boundary must not stop at Mongo creation: edit, delete, deploy and the
  // release lifecycle are equally consequential and were previously protected
  // only by blanket IIS Windows authentication.
  const unauthenticated = [
    ['PATCH', `/api/sites/${id}`, { name: 'renamed' }],
    ['DELETE', `/api/sites/${id}?confirm=delete-tracking-record`, null],
    ['POST', `/api/sites/${id}/deploy`, { releaseId: '000000000000000000000000' }],
    ['PATCH', '/api/releases/000000000000000000000000', { version: '9.9.9' }],
    ['DELETE', '/api/releases/000000000000000000000000', null],
  ];

  for (const [method, pathname, payloadBody] of unauthenticated) {
    const { status, headers, body } = await call(pathname, {
      method,
      // Explicitly no Authorization: the harness only adds one when absent.
      headers: { 'Content-Type': 'application/json', Authorization: '' },
      ...(payloadBody ? { body: JSON.stringify(payloadBody) } : {}),
    });
    assert.equal(status, 401, `${method} ${pathname} must require a management session`);
    assert.equal(body.error?.code, 'management_session_required');
    assert.equal(headers.get('www-authenticate'), null, `${method} ${pathname} must not challenge`);
  }
});

test('read-only management endpoints stay open to the UI without a session', async () => {
  // Widening the mutation boundary must not make the read-only UI require a
  // session. Asserted as "not an authorization refusal" rather than 200, because
  // these routes legitimately fail differently when no database is configured
  // and this suite also runs without one.
  for (const pathname of ['/api/health', '/api/config']) {
    const { status } = await call(pathname);
    assert.equal(status, 200, `${pathname} must remain public`);
  }
  for (const pathname of ['/api/sites', '/api/releases']) {
    const { status } = await call(pathname);
    assert.ok(status !== 401 && status !== 403, `${pathname} must not require a management session`);
  }
});

// ------------------------------------------------------ anonymous preflight

test('the diverted CORS preflight answers anonymously with the Daily Data policy', async () => {
  // URL Rewrite sends OPTIONS for the Windows-authenticated Daily Data routes
  // here, because a browser preflight carries no credentials and a 401 would
  // kill the real request behind it.
  const { status, headers } = await call('/api/cors-preflight/daily-data', {
    method: 'OPTIONS',
    headers: { Origin: 'https://portal.army.idf' },
  });
  assert.equal(status, 204);
  assert.equal(headers.get('access-control-allow-origin'), 'https://portal.army.idf');
  assert.equal(headers.get('access-control-allow-credentials'), 'true');
  const allowed = String(headers.get('access-control-allow-headers')).toLowerCase();
  assert.ok(allowed.includes('if-match'), 'conditional writes need If-Match to survive preflight');
  assert.ok(allowed.includes('content-type'));
});

test('an unconfigured origin is refused at the preflight', async () => {
  const { status } = await call('/api/cors-preflight/daily-data', {
    method: 'OPTIONS',
    headers: { Origin: 'https://not-configured.example' },
  });
  assert.equal(status, 403);
});

test('the preflight path is not a data path', async () => {
  const { status, body } = await call('/api/cors-preflight/daily-data');
  assert.equal(status, 405);
  assert.equal(body.error.code, 'preflight_only');
});

// ------------------------------------- SharePoint hosting for Mongo targets

test('Mongo hosting is auto-allocated when no library is chosen', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed tests.');
  const token = await openSession('domain\\hosting-auto');
  const payload = createPayload();
  const { status, body } = await createSite(token, payload);
  assert.equal(status, 201);
  const stored = await db.collection('sites').findOne({ name: payload.name });
  assert.equal(stored.hostingAllocation, 'automatic');
  assert.match(stored.siteDbFolder, /^siteDB-/);
  assert.notEqual(stored.siteDbFolder, stored.usersDbFolder);
  // Hosting is independent of the data identity, which stays server-allocated.
  assert.match(body.site.builderSiteId, /^srm-/);
});

test('an explicit, valid hosting library pair is honoured', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed tests.');
  const token = await openSession('domain\\hosting-explicit');
  const suffix = Math.random().toString(36).slice(2, 8);
  const payload = createPayload({
    siteDbFolder: `chosenSite-${suffix}`,
    usersDbFolder: `chosenUsers-${suffix}`,
  });
  const { status, body } = await createSite(token, payload);
  assert.equal(status, 201, JSON.stringify(body));
  const stored = await db.collection('sites').findOne({ name: payload.name });
  assert.equal(stored.hostingAllocation, 'explicit');
  assert.equal(stored.siteDbFolder, `chosenSite-${suffix}`);
  assert.equal(stored.usersDbFolder, `chosenUsers-${suffix}`);
  // The caller still may not choose the Mongo identity.
  assert.match(stored.builderSiteId, /^srm-/);
  assert.notEqual(stored.builderSiteId, 'browser-controlled-id');
});

test('an invalid or unsafe hosting choice is rejected', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed tests.');
  const token = await openSession('domain\\hosting-invalid');
  const cases = [
    [{ siteDbFolder: 'onlyOne' }, 'INCOMPLETE_HOSTING_CHOICE'],
    [{ siteDbFolder: '../escape', usersDbFolder: 'users' }, 'INVALID_HOSTING_LIBRARY'],
    [{ siteDbFolder: 'Forms', usersDbFolder: 'usersLib' }, 'RESERVED_HOSTING_LIBRARY'],
    [{ siteDbFolder: 'sameName', usersDbFolder: 'SAMENAME' }, 'HOSTING_LIBRARIES_IDENTICAL'],
  ];
  for (const [overrides, code] of cases) {
    const { status, body } = await createSite(token, createPayload(overrides));
    assert.equal(status, 400, `${JSON.stringify(overrides)} -> ${status}`);
    assert.equal(body.code, code);
  }
});

test('two logical sites share a Web but never the same physical target', async (t) => {
  if (!available) return t.skip('Set SRM_TEST_MONGO_URI to run database-backed tests.');
  const token = await openSession('domain\\hosting-shared-web');
  const siteCode = `sharedweb${Math.random().toString(36).slice(2, 7)}`;

  const a = await createSite(token, createPayload({ siteCode, siteDbFolder: 'libAlpha', usersDbFolder: 'usersAlpha' }));
  const b = await createSite(token, createPayload({ siteCode, siteDbFolder: 'libBravo', usersDbFolder: 'usersBravo' }));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, 'several logical sites may share one SharePoint Web');
  assert.notEqual(a.body.site.builderSiteId, b.body.site.builderSiteId);

  // The SAME physical pair must be refused rather than silently shared.
  const collision = await createSite(token, createPayload({ siteCode, siteDbFolder: 'libAlpha', usersDbFolder: 'usersAlpha' }));
  assert.equal(collision.status, 409, 'a conflicting physical target must fail closed');
});
