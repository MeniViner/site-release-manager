/**
 * End-to-end job lifecycle against a real MongoDB.
 *
 * Skips cleanly when no test database is configured, so the suite still runs on
 * a machine without Mongo. Point SRM_TEST_MONGO_URI at a scratch instance:
 *   mongod --dbpath <tmp> --port 27099
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';

const TEST_URI = process.env.SRM_TEST_MONGO_URI || '';
const TEST_DB = `srm_test_${Date.now()}`;

// The services read config at import time, so the environment must be set first.
process.env.MONGO_URI = TEST_URI || 'mongodb://127.0.0.1:1';
process.env.MONGO_DB_NAME = TEST_DB;

const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-lifecycle-'));
process.env.STORAGE_ROOT = path.join(artifactRoot, 'storage');

let available = false;
if (TEST_URI) {
  const probe = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 1500 });
  try { await probe.connect(); await probe.db(TEST_DB).command({ ping: 1 }); available = true; } catch { available = false; }
  finally { await probe.close().catch(() => {}); }
}

const skipAll = (t) => {
  t.skip('Set SRM_TEST_MONGO_URI to a scratch MongoDB to run job lifecycle tests.');
};

let db;
let connectDb; let closeDb;
let createDeploymentJob; let cancelDeploymentJob; let retryDeploymentJob; let findActiveJobForTarget; let initializeQueue; let settleJob;
let JOB_STATE; let canonicalState;
let TargetLockedError; let readTargetLock;

if (available) {
  ({ connectDb, closeDb } = await import('../src/db.js'));
  ({ createDeploymentJob, cancelDeploymentJob, retryDeploymentJob, findActiveJobForTarget, initializeQueue, settleJob } = await import('../src/services/jobQueue.js'));
  ({ JOB_STATE, canonicalState } = await import('../src/services/jobState.js'));
  ({ TargetLockedError, readTargetLock } = await import('../src/services/targetLock.js'));
  db = await connectDb();
}

/** A minimal but genuinely valid Universal artifact on disk. */
let releaseCounter = 0;

async function makeRelease(version) {
  const { collectFiles, hashDirectory, ensureDirectory } = await import('../src/utils/files.js');
  // A stored release is immutable, so every fixture gets its own directory
  // rather than reusing (and therefore mutating) a previous one.
  releaseCounter += 1;
  const releaseRoot = path.join(artifactRoot, 'releases', `${version}-${releaseCounter}`);
  const distDir = path.join(releaseRoot, 'dist');
  ensureDirectory(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), `console.log("build ${version}")`);
  fs.writeFileSync(path.join(distDir, 'assets', 'app.css'), 'body{margin:0}');
  fs.writeFileSync(path.join(distDir, 'index.html'), '<html><head><link href="./assets/app.css"><script src="./assets/app.js"></script></head><body></body></html>');

  const files = collectFiles(distDir);
  const manifest = {
    kind: 'sitebuilder-release-manifest',
    schemaVersion: 4,
    buildId: `build-${version}`,
    buildMode: 'universal',
    artifactKind: 'site-builder-universal-frontend',
    generatedAt: new Date().toISOString(),
    storageCompatibility: ['txt', 'mongo'],
    requiresRuntimeConfig: true,
    preservesRuntimeConfig: true,
    runtimeConfigFiles: ['sitebuilder-runtime-config.json', 'sitebuilder-deployment.json'],
    manifestFile: 'sharepoint-deploy-manifest.json',
    entryPoint: 'index.html',
    commitFile: 'index.html',
    fileCount: files.length,
    requiredFolders: ['assets'],
    indexReferences: ['assets/app.css', 'assets/app.js'],
    files: files.map(({ path: filePath, size, sha256 }) => ({ path: filePath, size, sha256 })),
  };
  fs.writeFileSync(path.join(distDir, 'sharepoint-deploy-manifest.json'), JSON.stringify(manifest, null, 2));

  const document = {
    _id: new ObjectId(), version, notes: '', status: 'READY', artifactType: 'universal-dist',
    releaseRoot, distDir, sha256: hashDirectory(distDir), fileCount: files.length, totalBytes: 0,
    createdAt: new Date(), updatedAt: new Date(),
  };
  await db.collection('releases').insertOne(document);
  return document;
}

async function makeSite(overrides = {}) {
  const site = {
    _id: new ObjectId(),
    unit: 'unit', name: overrides.name || 'Target', managerName: 'manager',
    host: 'portal.army.idf', siteCode: 'schedule',
    siteDbFolder: 'siteDB', usersDbFolder: 'siteUsersDb',
    siteAssetsFolder: 'siteAssets', imagesFolder: 'images', widgetsDbTarget: 'users',
    status: 'TRACKED', currentVersion: null, currentReleaseId: null,
    firstPublishedAt: null, activeJobId: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
  const { buildSiteIdentity, canonicalTargetKey } = await import('../../shared/siteRuntime.js');
  site.targetKey = canonicalTargetKey(buildSiteIdentity(site));
  await db.collection('sites').insertOne(site);
  return site;
}

async function reset() {
  await Promise.all([
    db.collection('sites').deleteMany({}),
    db.collection('releases').deleteMany({}),
    db.collection('deployment_jobs').deleteMany({}),
    db.collection('deployment_locks').deleteMany({}),
  ]);
}

test('preparation reaches READY_FOR_SHAREPOINT with staging and a regenerated manifest', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();

  const job = await createDeploymentJob({ siteId: site._id, releaseId: release._id, type: 'INSTALL' });
  assert.equal(canonicalState(job.state), JOB_STATE.READY_FOR_SHAREPOINT);
  assert.ok(job.stagingDistDir && fs.existsSync(job.stagingDistDir));
  assert.ok(fs.existsSync(path.join(job.stagingDistDir, 'sitebuilder-runtime-config.json')));
  assert.equal(job.finalDistRoot, '/sites/schedule/siteDB/dist');

  // Staging is a copy: the stored release must still be free of any overlay.
  assert.equal(fs.existsSync(path.join(release.distDir, 'sitebuilder-runtime-config.json')), false);

  const stages = (job.runEvents || []).filter((event) => event.status === 'success').map((event) => event.stage);
  for (const expected of ['RELEASE_VALIDATE', 'TARGET_VALIDATE', 'STAGING_CREATE', 'RUNTIME_CONFIG_CREATE', 'MANIFEST_CREATE', 'READY_FOR_SHAREPOINT']) {
    assert.ok(stages.includes(expected), `missing successful stage ${expected}`);
  }
});

test('an active run holds the target and a second run is refused with actionable detail', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();
  const first = await createDeploymentJob({ siteId: site._id, releaseId: release._id });

  await assert.rejects(
    createDeploymentJob({ siteId: site._id, releaseId: release._id }),
    (error) => {
      assert.ok(error instanceof TargetLockedError);
      assert.equal(error.activeJobId, String(first._id));
      assert.equal(error.stale, false);
      return true;
    },
  );
});

test('deploying the SAME release again after a finished run is allowed', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();

  const first = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  await settleJob(first._id, JOB_STATE.SUCCEEDED, { message: 'done' });

  // History must never produce a duplicate-job 409.
  const second = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  assert.equal(canonicalState(second.state), JOB_STATE.READY_FOR_SHAREPOINT);
  assert.notEqual(String(second._id), String(first._id));
});

test('a cancelled run releases the target immediately', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();
  const first = await createDeploymentJob({ siteId: site._id, releaseId: release._id });

  await cancelDeploymentJob(first._id);
  assert.equal(await findActiveJobForTarget(site.targetKey), null);
  const next = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  assert.equal(canonicalState(next.state), JOB_STATE.READY_FOR_SHAREPOINT);
});

test('force supersedes the current owner and transfers the lock exactly once', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();
  const first = await createDeploymentJob({ siteId: site._id, releaseId: release._id });

  const second = await createDeploymentJob({ siteId: site._id, releaseId: release._id, force: true });
  const reloadedFirst = await db.collection('deployment_jobs').findOne({ _id: first._id });
  assert.equal(canonicalState(reloadedFirst.state), JOB_STATE.SUPERSEDED);

  const lock = await readTargetLock(site.targetKey);
  assert.equal(String(lock.jobId), String(second._id));
  const locks = await db.collection('deployment_locks').countDocuments({ targetKey: site.targetKey });
  assert.equal(locks, 1, 'a target must never hold two locks');
});

test('two logical targets inside one SharePoint Web deploy independently', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const targetA = await makeSite({ name: 'A' });
  const targetB = await makeSite({ name: 'B', siteDbFolder: 'siteDBFinance', usersDbFolder: 'siteUsersDBFinance' });

  assert.notEqual(targetA.targetKey, targetB.targetKey);
  const jobA = await createDeploymentJob({ siteId: targetA._id, releaseId: release._id });
  // Same siteCode, different libraries: this must NOT be blocked.
  const jobB = await createDeploymentJob({ siteId: targetB._id, releaseId: release._id });

  assert.equal(canonicalState(jobA.state), JOB_STATE.READY_FOR_SHAREPOINT);
  assert.equal(canonicalState(jobB.state), JOB_STATE.READY_FOR_SHAREPOINT);
  assert.equal(jobA.finalDistRoot, '/sites/schedule/siteDB/dist');
  assert.equal(jobB.finalDistRoot, '/sites/schedule/siteDBFinance/dist');

  const configA = JSON.parse(fs.readFileSync(path.join(jobA.stagingDistDir, 'sitebuilder-runtime-config.json'), 'utf8'));
  const configB = JSON.parse(fs.readFileSync(path.join(jobB.stagingDistDir, 'sitebuilder-runtime-config.json'), 'utf8'));
  assert.equal(configA.usersDbRoot, '/sites/schedule/siteUsersDb');
  assert.equal(configB.usersDbRoot, '/sites/schedule/siteUsersDBFinance');
});

test('a server restart during SharePoint work pauses the run instead of failing it', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();
  const job = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  await db.collection('deployment_jobs').updateOne({ _id: job._id }, { $set: { state: JOB_STATE.DEPLOYING, progress: 70 } });

  await initializeQueue();

  const reloaded = await db.collection('deployment_jobs').findOne({ _id: job._id });
  assert.equal(canonicalState(reloaded.state), JOB_STATE.PAUSED, 'a verified-in-progress deployment must not be marked failed');
  // The target stays held so nothing else claims it while the run is resumable.
  const owner = await findActiveJobForTarget(site.targetKey);
  assert.ok(owner);
  assert.equal(String(owner.job._id), String(job._id));
});

test('retrying a failed run keeps the same job and increments the attempt', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();
  const job = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  await settleJob(job._id, JOB_STATE.FAILED, { message: 'seed stage failed', error: 'boom' });

  const retried = await retryDeploymentJob(job._id);
  assert.equal(String(retried._id), String(job._id), 'a retry must reuse the run, not create a new one');
  assert.equal(retried.attempt, 2);
  assert.equal(canonicalState(retried.state), JOB_STATE.READY_FOR_SHAREPOINT);
  assert.equal(retried.error, null);
});

test('a job whose lock outlived it does not block the target', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();
  const job = await createDeploymentJob({ siteId: site._id, releaseId: release._id });

  // Simulate a settled job whose lock row was left behind.
  await db.collection('deployment_jobs').updateOne({ _id: job._id }, { $set: { state: JOB_STATE.SUCCEEDED } });
  assert.equal(await findActiveJobForTarget(site.targetKey), null);
  assert.equal(await db.collection('deployment_locks').countDocuments({ targetKey: site.targetKey }), 0);
});

test('a stale lock is reported as stale so the UI can offer an explicit supersede', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  const release = await makeRelease('1.0.0');
  const site = await makeSite();
  await createDeploymentJob({ siteId: site._id, releaseId: release._id });

  const longAgo = new Date(Date.now() - 60 * 60 * 1000);
  await db.collection('deployment_locks').updateOne({ targetKey: site.targetKey }, { $set: { heartbeatAt: longAgo, acquiredAt: longAgo } });

  const owner = await findActiveJobForTarget(site.targetKey);
  assert.equal(owner.stale, true);
  await assert.rejects(
    createDeploymentJob({ siteId: site._id, releaseId: release._id }),
    (error) => { assert.equal(error.code, 'STALE_TARGET_LOCK'); return true; },
  );
  // ...and superseding it explicitly works.
  const replacement = await createDeploymentJob({ siteId: site._id, releaseId: release._id, force: true });
  assert.equal(canonicalState(replacement.state), JOB_STATE.READY_FOR_SHAREPOINT);
});

test('one SharePoint Web can hold several tracked targets despite the legacy unique index', async (t) => {
  if (!available) return skipAll(t);
  await reset();
  // Recreate the pre-migration index and prove the migration removes it.
  await db.collection('sites').createIndex({ host: 1, siteCode: 1 }, { unique: true, name: 'legacy_host_sitecode' }).catch(() => {});
  const { migrateIndexes } = await import('../src/db.js');
  await migrateIndexes(db);

  await makeSite({ name: 'A' });
  await makeSite({ name: 'B', siteDbFolder: 'siteDBFresh', usersDbFolder: 'siteUsersDBFresh' });
  assert.equal(await db.collection('sites').countDocuments({ siteCode: 'schedule' }), 2);

  const indexes = await db.collection('sites').indexes();
  assert.equal(indexes.some((index) => index.name === 'legacy_host_sitecode'), false, 'the legacy unique index must be dropped');
  assert.ok(indexes.some((index) => index.unique && index.key.targetKey === 1), 'uniqueness must move to targetKey');
});

test.after(async () => {
  if (!available) return;
  await db.dropDatabase().catch(() => {});
  await closeDb().catch(() => {});
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});
