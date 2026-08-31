/**
 * HTTP surface tests: CORS, preflight, health and the endpoints the Windows
 * workstation depends on when Release Manager is opened from SharePoint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';

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
  assert.equal(body.length, 23);
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
  const b = await call('/api/sites', payload('B', 'siteDB1', 'siteUsersDb1'));
  const c = await call('/api/sites', payload('C', 'siteDBFinance', 'siteUsersDbFinance'));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, `second target rejected: ${JSON.stringify(b.body)}`);
  assert.equal(c.status, 201, `third target rejected: ${JSON.stringify(c.body)}`);
  assert.notEqual(a.body.site.targetKey, b.body.site.targetKey);
  assert.notEqual(b.body.site.targetKey, c.body.site.targetKey);

  // The same physical target twice is still a duplicate.
  const duplicate = await call('/api/sites', payload('A again', 'siteDB', 'siteUsersDb'));
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /יעד פיזי/);

  const releaseId = new ObjectId();
  await db.collection('releases').insertOne({
    _id: releaseId,
    version: '9.1.0',
    status: 'READY',
    buildId: 'build-910',
    createdAt: new Date(),
  });
  const newerReleaseId = new ObjectId();
  await db.collection('releases').insertOne({
    _id: newerReleaseId,
    version: '9.2.0',
    status: 'READY',
    buildId: 'build-920',
    createdAt: new Date(Date.now() + 1000),
  });
  const aId = new ObjectId(a.body.site.id);
  const bId = new ObjectId(b.body.site.id);
  const runA = new ObjectId();
  const runB = new ObjectId();
  await db.collection('deployment_jobs').insertMany([
    { _id: runA, siteId: aId, releaseId, targetKey: a.body.site.targetKey, state: 'SUCCEEDED', type: 'UPDATE', createdAt: new Date(), finishedAt: new Date(), finalUrl: a.body.site.finalUrl },
    { _id: runB, siteId: bId, releaseId, targetKey: b.body.site.targetKey, state: 'FAILED', type: 'UPDATE', createdAt: new Date(), finishedAt: new Date(), finalUrl: b.body.site.finalUrl },
  ]);
  await db.collection('sites').updateOne(
    { _id: aId },
    { $set: { currentReleaseId: releaseId, currentVersion: '9.1.0', lastPublishedAt: new Date() } },
  );
  await db.collection('sites').updateOne(
    { _id: bId },
    { $set: { currentReleaseId: null, currentVersion: '9.3.0', lastPublishedAt: new Date() } },
  );
  const backupAId = new ObjectId();
  const backupBId = new ObjectId();
  await db.collection('backups').insertMany([
    {
      _id: backupAId,
      siteId: aId, runId: runA, targetKey: a.body.site.targetKey, storageBackend: 'txt',
      strategy: 'SHAREPOINT_TXT_FILES', trigger: 'PRE_DEPLOY', outcome: 'PASSED',
      createdAt: new Date(), fileCount: 10, copiedCount: 10, skippedCount: 0, failedCount: 0,
      target: { host: 'portal.army.idf', siteCode: 'schedule', siteDbFolder: 'siteDB', usersDbFolder: 'siteUsersDb', finalAppUrl: a.body.site.finalUrl },
      siteSnapshot: { name: 'A', unit: 'u' },
    },
    {
      _id: backupBId,
      siteId: bId, runId: runB, targetKey: b.body.site.targetKey, storageBackend: 'txt',
      strategy: 'SHAREPOINT_TXT_FILES', trigger: 'PRE_DEPLOY', outcome: 'FAILED',
      createdAt: new Date(), fileCount: 10, copiedCount: 0, skippedCount: 0, failedCount: 10,
      target: { host: 'portal.army.idf', siteCode: 'schedule', siteDbFolder: 'siteDB1', usersDbFolder: 'siteUsersDb1', finalAppUrl: b.body.site.finalUrl },
      siteSnapshot: { name: 'B', unit: 'u' },
    },
  ]);

  const detailsA = await call(`/api/sites/${a.body.site.id}`);
  const detailsB = await call(`/api/sites/${b.body.site.id}`);
  assert.equal(detailsA.status, 200);
  assert.equal(detailsB.status, 200);
  assert.deepEqual(detailsA.body.runs.map((run) => run.id), [String(runA)]);
  assert.deepEqual(detailsB.body.runs.map((run) => run.id), [String(runB)]);
  assert.equal(detailsA.body.backups[0].target.siteDbFolder, 'siteDB');
  assert.equal(detailsB.body.backups[0].target.siteDbFolder, 'siteDB1');
  assert.equal(detailsB.body.plan.txtSeeds.every((seed) => seed.path.includes('/siteDB1/') || seed.path.includes('/siteUsersDb1/')), true);
  assert.equal(detailsA.body.currentRelease.id, String(releaseId));
  assert.equal(detailsA.body.currentRelease.buildId, 'build-910');
  assert.equal(detailsA.body.latestAvailableRelease.id, String(newerReleaseId));
  assert.equal(detailsB.body.currentRelease, null);
  assert.equal(detailsB.body.latestAvailableRelease, null, 'an older READY release is not newer than a tracked currentVersion');

  const duplicateEdit = await call(`/api/sites/${b.body.site.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteDbFolder: 'siteDB', usersDbFolder: 'siteUsersDb' }),
  });
  assert.equal(duplicateEdit.status, 409);

  await db.collection('sites').updateOne(
    { _id: bId },
    { $set: { identityEdit: { token: 'edit-in-progress', acquiredAt: new Date() } } },
  );
  const deploymentDuringIdentityEdit = await call(`/api/sites/${b.body.site.id}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ releaseId }),
  });
  assert.equal(deploymentDuringIdentityEdit.status, 409);
  assert.equal(deploymentDuringIdentityEdit.body.code, 'SITE_IDENTITY_EDIT_IN_PROGRESS');
  await db.collection('sites').updateOne({ _id: bId }, { $unset: { identityEdit: '' } });
  await db.collection('sites').updateOne(
    { _id: bId },
    { $set: { identityEdit: { token: 'stale-edit', acquiredAt: new Date(0) } } },
  );
  const deploymentAfterStaleEdit = await call(`/api/sites/${b.body.site.id}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ releaseId }),
  });
  assert.notEqual(deploymentAfterStaleEdit.body.code, 'SITE_IDENTITY_EDIT_IN_PROGRESS');
  assert.equal((await db.collection('sites').findOne({ _id: bId })).identityEdit, undefined);

  await db.collection('deployment_jobs').updateOne({ _id: runA }, { $set: { state: 'DEPLOYING' } });
  await db.collection('deployment_locks').insertOne({
    targetKey: a.body.site.targetKey,
    jobId: runA,
    siteId: aId,
    acquiredAt: new Date(),
    heartbeatAt: new Date(),
  });
  const metadataEdit = await call(`/api/sites/${a.body.site.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'A renamed while active' }),
  });
  assert.equal(metadataEdit.status, 200);
  assert.equal(metadataEdit.body.siteDbFolder, 'siteDB');
  assert.equal(metadataEdit.body.usersDbFolder, 'siteUsersDb');
  const lockedIdentityEdit = await call(`/api/sites/${a.body.site.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteAssetsFolder: 'siteAssetsOther' }),
  });
  assert.equal(lockedIdentityEdit.status, 409);
  assert.equal(lockedIdentityEdit.body.code, 'TARGET_LOCKED');
  await db.collection('deployment_locks').deleteOne({ jobId: runA });
  await db.collection('deployment_jobs').updateOne({ _id: runA }, { $set: { state: 'SUCCEEDED' } });

  const filteredBackups = await call(`/api/backups?siteId=${b.body.site.id}&backend=txt&outcome=FAILED`);
  assert.equal(filteredBackups.status, 200);
  assert.equal(filteredBackups.body.length, 1);
  assert.equal(filteredBackups.body[0].site.name, 'B');

  // Deleting A is a tracking-only operation. B's record/history/backup remain,
  // and A's durable backup metadata is not mistaken for SharePoint payload.
  const deletedA = await call(`/api/sites/${a.body.site.id}?confirm=delete-tracking-record`, { method: 'DELETE' });
  assert.equal(deletedA.status, 200);
  assert.equal(deletedA.body.deletedSharePointData, false);
  assert.equal(await db.collection('sites').countDocuments({ _id: bId }), 1);
  assert.equal(await db.collection('deployment_jobs').countDocuments({ _id: runB, siteId: bId }), 1);
  assert.equal(await db.collection('backups').countDocuments({ siteId: bId, targetKey: b.body.site.targetKey }), 1);
  assert.equal(await db.collection('backups').countDocuments({ siteId: aId, targetKey: a.body.site.targetKey }), 1);
  assert.equal(await db.collection('deployment_jobs').countDocuments({ _id: runA, siteId: aId }), 1);

  const deletedSiteBackup = await call(`/api/backups/${backupAId}`);
  assert.equal(deletedSiteBackup.status, 200);
  assert.equal(deletedSiteBackup.body.site.tracked, false);
  assert.equal(deletedSiteBackup.body.site.name, 'A');
  const preservedRun = await call(`/api/runs/${runA}`);
  assert.equal(preservedRun.status, 200);
  assert.equal(preservedRun.body.site, null);

  const runList = await call('/api/runs?limit=20');
  const listedB = runList.body.find((run) => run.id === String(runB));
  assert.equal(listedB.site.siteDbFolder, 'siteDB1');
  assert.equal(listedB.site.usersDbFolder, 'siteUsersDb1');

  await db.collection('sites').updateOne(
    { _id: bId },
    {
      $set: {
        siteDbFolder: 'siteDBRetryChanged',
        targetKey: 'portal.army.idf|schedule|sitedbretrychanged|siteusersdb1',
      },
    },
  );
  const retryAfterIdentityChange = await call(`/api/runs/${runB}/retry`, { method: 'POST' });
  assert.equal(retryAfterIdentityChange.status, 409);
  assert.equal(retryAfterIdentityChange.body.code, 'RUN_TARGET_CHANGED');
});

test('an invalid legacy Site remains visible and can be repaired through canonical identity fields', async (t) => {
  if (!available) { t.skip('Set SRM_TEST_MONGO_URI to run database-backed API tests.'); return; }
  const siteId = new ObjectId();
  await db.collection('sites').insertOne({
    _id: siteId,
    unit: 'u',
    name: 'Legacy invalid',
    managerName: 'm',
    host: 'portal.army.idf',
    siteCode: '?',
    siteDbFolder: 'siteDBLegacy',
    usersDbFolder: 'siteUsersDbLegacy',
    storageBackend: 'txt',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const before = await call(`/api/sites/${siteId}`);
  assert.equal(before.status, 200);
  assert.equal(before.body.identity, null);
  assert.ok(before.body.identityError);
  assert.equal(before.body.targetKey, '');
  assert.equal(before.body.finalUrl, '');

  const repaired = await call(`/api/sites/${siteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteCode: 'legacy-site' }),
  });
  assert.equal(repaired.status, 200);
  assert.equal(repaired.body.identity.siteCode, 'legacy-site');
  assert.equal(repaired.body.finalUrl, 'https://portal.army.idf/sites/legacy-site/siteDBLegacy/dist/index.html');
});

test('backup lifecycle endpoints durably persist successful and failed outcomes', async (t) => {
  if (!available) { t.skip('Set SRM_TEST_MONGO_URI to run database-backed API tests.'); return; }
  const siteId = new ObjectId();
  const releaseId = new ObjectId();
  const targetKey = 'portal.army.idf|backupsite|sitedbbackup|siteusersdbbackup';
  await db.collection('sites').insertOne({
    _id: siteId,
    unit: 'u',
    name: 'Backup Site',
    managerName: 'm',
    host: 'portal.army.idf',
    siteCode: 'backupsite',
    siteDbFolder: 'siteDBBackup',
    usersDbFolder: 'siteUsersDbBackup',
    siteAssetsFolder: 'siteAssets',
    imagesFolder: 'images',
    widgetsDbTarget: 'users',
    storageBackend: 'txt',
    currentVersion: '1.3.0',
    targetKey,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection('releases').insertOne({
    _id: releaseId,
    version: '10.0.0',
    status: 'READY',
    createdAt: new Date(),
  });

  for (const outcome of ['PASSED', 'FAILED']) {
    const runId = new ObjectId();
    const leaseId = `lease-${outcome.toLowerCase()}`;
    await db.collection('deployment_jobs').insertOne({
      _id: runId,
      siteId,
      releaseId,
      targetKey,
      state: 'DEPLOYING',
      browserLease: { leaseId, clientId: 'test-worker', acquiredAt: new Date(), heartbeatAt: new Date() },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const headers = { 'Content-Type': 'application/json', 'X-SRM-Lease': leaseId };
    const started = await call(`/api/deployments/${runId}/backup/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ startedAt: new Date().toISOString() }),
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.backup.outcome, 'IN_PROGRESS');

    const copiedFiles = outcome === 'PASSED'
      ? Array.from({ length: 10 }, (_, index) => ({
        fileName: `file-${index}.txt`,
        sourcePath: `/source/file-${index}.txt`,
        targetPath: `/backup/file-${index}.txt`,
        size: index + 1,
        sha256: 'a'.repeat(64),
        verified: true,
      }))
      : [];
    const failedFiles = outcome === 'FAILED'
      ? [{ fileName: 'users_data.txt', sourcePath: '/source/users_data.txt', operation: 'read', error: 'denied' }]
      : [];
    const finished = await call(`/api/deployments/${runId}/backup/finish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        outcome,
        fileCount: 10,
        copiedFiles,
        skippedFiles: [],
        failedFiles,
        totalSizeBytes: copiedFiles.reduce((sum, file) => sum + file.size, 0),
        verificationStatus: outcome,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }),
    });
    assert.equal(finished.status, 200);
    assert.equal(finished.body.backup.outcome, outcome);
  }

  const records = await call(`/api/backups?siteId=${siteId}&backend=txt`);
  assert.equal(records.status, 200);
  assert.deepEqual(new Set(records.body.map((record) => record.outcome)), new Set(['PASSED', 'FAILED']));
});

test('the internal Site route returns a real 404 for an unknown or malformed id', async (t) => {
  if (!available) { t.skip('Set SRM_TEST_MONGO_URI to run database-backed API tests.'); return; }
  const malformed = await call('/api/sites/not-an-object-id');
  assert.equal(malformed.status, 404);
  const missing = await call(`/api/sites/${new ObjectId()}`);
  assert.equal(missing.status, 404);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (available) {
    await db.dropDatabase().catch(() => {});
    await closeDb().catch(() => {});
  }
  fs.rmSync(process.env.STORAGE_ROOT, { recursive: true, force: true });
});
