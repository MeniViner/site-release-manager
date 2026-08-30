/**
 * HTTP surface tests: CORS, preflight, health and the endpoints the Windows
 * workstation depends on when Release Manager is opened from SharePoint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const TEST_URI = process.env.SRM_TEST_MONGO_URI || '';
const TEST_DB = `srm_api_${Date.now()}`;
process.env.MONGO_URI = TEST_URI || 'mongodb://127.0.0.1:1';
process.env.MONGO_DB_NAME = TEST_DB;
process.env.STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-api-'));
process.env.CLIENT_ORIGINS = 'http://localhost:5173,https://portal.army.idf';
process.env.SHAREPOINT_HOSTS = 'portal.army.idf,mazi.army.idf';

let available = false;
if (TEST_URI) {
  const probe = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 1500 });
  try { await probe.connect(); await probe.db(TEST_DB).command({ ping: 1 }); available = true; } catch { available = false; }
  finally { await probe.close().catch(() => {}); }
}

const { createApp, ALLOWED_REQUEST_HEADERS } = await import('../src/app.js');
let connectDb; let closeDb; let db;
if (available) {
  ({ connectDb, closeDb } = await import('../src/db.js'));
  db = await connectDb();
}

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (pathname, options = {}) => {
  const response = await fetch(`${base}${pathname}`, options);
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  return { status: response.status, headers: response.headers, body };
};

test('health reports version and the configured origins', async () => {
  const { status, body } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.appVersion);
  assert.ok(body.clientOrigins.includes('http://localhost:5173'));
  assert.ok(Number.isFinite(body.uptimeSeconds));
});

test('a configured SharePoint origin passes CORS', async () => {
  const { status, headers } = await call('/api/health', { headers: { Origin: 'https://portal.army.idf' } });
  assert.equal(status, 200);
  assert.equal(headers.get('access-control-allow-origin'), 'https://portal.army.idf');
});

test('preflight allows the lease header and the methods the worker uses', async () => {
  const { status, headers } = await call('/api/deployments/abc/event', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://portal.army.idf',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-srm-lease',
    },
  });
  assert.equal(status, 204);
  const allowed = String(headers.get('access-control-allow-headers') || '').toLowerCase();
  for (const header of ALLOWED_REQUEST_HEADERS) {
    assert.ok(allowed.includes(header.toLowerCase()), `preflight does not allow ${header}`);
  }
  assert.ok(String(headers.get('access-control-allow-methods') || '').includes('POST'));
});

test('a Private Network Access preflight is answered', async () => {
  const { headers } = await call('/api/health', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://portal.army.idf',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Private-Network': 'true',
    },
  });
  assert.equal(headers.get('access-control-allow-private-network'), 'true');
});

test('an unconfigured origin gets an actionable 403 instead of an opaque 500', async () => {
  const { status, body } = await call('/api/health', { headers: { Origin: 'https://not-configured.example' } });
  assert.equal(status, 403);
  assert.equal(body.code, 'ORIGIN_NOT_CONFIGURED');
  assert.ok(Array.isArray(body.configuredOrigins));
  assert.ok(body.fix);
});

test('an unknown API route answers JSON, never the SPA HTML', async () => {
  const { status, body } = await call('/api/does-not-exist');
  assert.equal(status, 404);
  assert.equal(body.code, 'UNKNOWN_API_ROUTE');
});

test('the canonical stage list is served for the Runs UI', async () => {
  const { status, body } = await call('/api/runs/stages');
  assert.equal(status, 200);
  assert.equal(body.length, 21);
  assert.equal(body[0].stage, 'RELEASE_VALIDATE');
  assert.equal(body.at(-1).stage, 'COMPLETE');
});

test('the provisioning boundary states that Release Manager does not create a SharePoint Web', async () => {
  const { status, body } = await call('/api/sites/provisioning-boundary');
  assert.equal(status, 200);
  assert.equal(body.createsSharePointWeb, false);
  assert.equal(body.createsDocumentLibraries, true);
  assert.ok(body.note);
});

test('site CRUD works end to end and delete needs explicit confirmation', async (t) => {
  if (!available) { t.skip('Set SRM_TEST_MONGO_URI to run database-backed API tests.'); return; }
  await db.collection('sites').deleteMany({});

  const created = await call('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit: 'unit', name: 'Schedule', managerName: 'manager', host: 'portal.army.idf', siteCode: 'schedule' }),
  });
  assert.equal(created.status, 201);
  const siteId = created.body.site.id;
  assert.equal(created.body.site.identity.targetDistPath, '/sites/schedule/siteDB/dist');

  const details = await call(`/api/sites/${siteId}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.plan.libraries.length, 2);
  assert.equal(details.body.plan.txtSeeds.length, 10);
  assert.ok(details.body.plan.txtSeeds.some((seed) => seed.fileName === 'boom_data.txt'));
  assert.equal(details.body.plan.boundary.createsSharePointWeb, false);

  const edited = await call(`/api/sites/${siteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Schedule Renamed', siteDbFolder: 'siteDBFresh', usersDbFolder: 'siteUsersDBFresh' }),
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.name, 'Schedule Renamed');
  // Derived values follow identity; they are never independently editable.
  assert.equal(edited.body.identity.targetDistPath, '/sites/schedule/siteDBFresh/dist');
  assert.equal(edited.body.finalUrl, 'https://portal.army.idf/sites/schedule/siteDBFresh/dist/index.html');

  const unconfirmed = await call(`/api/sites/${siteId}`, { method: 'DELETE' });
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.body.code, 'CONFIRMATION_REQUIRED');

  const deleted = await call(`/api/sites/${siteId}?confirm=delete-tracking-record`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deletedSharePointData, false, 'deleting a tracking record must never delete SharePoint data');
});

test('an invalid target identity is rejected with a clear message', async (t) => {
  if (!available) { t.skip('Set SRM_TEST_MONGO_URI to run database-backed API tests.'); return; }
  const badHost = await call('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit: 'u', name: 'n', managerName: 'm', host: 'unknown.host', siteCode: 'schedule' }),
  });
  assert.equal(badHost.status, 400);

  const sameLibraries = await call('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit: 'u', name: 'n', managerName: 'm', host: 'portal.army.idf', siteCode: 'schedule', siteDbFolder: 'shared', usersDbFolder: 'shared' }),
  });
  assert.equal(sameLibraries.status, 400);
  assert.ok(/different Document Libraries/i.test(sameLibraries.body.error));
});

test('two logical targets can be tracked inside one SharePoint Web', async (t) => {
  if (!available) { t.skip('Set SRM_TEST_MONGO_URI to run database-backed API tests.'); return; }
  await db.collection('sites').deleteMany({});
  const payload = (name, siteDbFolder, usersDbFolder) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit: 'u', name, managerName: 'm', host: 'portal.army.idf', siteCode: 'schedule', siteDbFolder, usersDbFolder }),
  });
  const a = await call('/api/sites', payload('A', 'siteDB', 'siteUsersDb'));
  const b = await call('/api/sites', payload('B', 'siteDBFinance', 'siteUsersDBFinance'));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, `second target rejected: ${JSON.stringify(b.body)}`);
  assert.notEqual(a.body.site.targetKey, b.body.site.targetKey);

  // The same physical target twice is still a duplicate.
  const duplicate = await call('/api/sites', payload('A again', 'siteDB', 'siteUsersDb'));
  assert.equal(duplicate.status, 409);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (available) {
    await db.dropDatabase().catch(() => {});
    await closeDb().catch(() => {});
  }
  fs.rmSync(process.env.STORAGE_ROOT, { recursive: true, force: true });
});
