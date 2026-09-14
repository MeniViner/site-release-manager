/**
 * Regression tests for defects found in the adversarial review pass.
 *
 * Each test names the failure it prevents, because every one of these was a
 * real bug that produced a wrong final state rather than an obvious crash.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MongoClient, ObjectId } = require("mongodb");
const { ensureFolderTree, uploadReleaseAssets, PROVISIONING_ERROR, isFatalProvisioningError } = require("../src/shared/sharepointProvisioning.js");
const { createSharePointClient } = require("../src/shared/sharepointClient.js");
const { SP_ERROR } = require("../src/shared/sharepointErrors.js");
const { buildSiteIdentity } = require("../src/shared/siteRuntime.js");
const { createFakeSharePoint, instantRetry, sha256Hex } = require("./helpers/fakeSharePoint.js");
const IDENTITY = buildSiteIdentity({ host: 'portal.army.idf', siteCode: 'schedule' });
const retry = { ...instantRetry, maxAttempts: 6, maxElapsedMs: 5000 };
const sha256 = async (bytes) => sha256Hex(bytes);

// ---------------------------------------------------------------------------
// Provisioning regressions
// ---------------------------------------------------------------------------

test('a file is reported verified only AFTER it uploads and verifies', async () => {
  // Regression: onProgress fired before the upload, so a failed upload could
  // still be recorded as verified. A later resume then skipped it forever and
  // the run reported success with the file missing from SharePoint.
  const farm = createFakeSharePoint();
  farm.state.folders.set(IDENTITY.siteRoot, { listItemId: 1 });
  farm.addFolder(IDENTITY.targetDistPath);
  farm.addFolder(`${IDENTITY.targetDistPath}/assets`);

  const bodies = { 'assets/good.js': 'ok', 'assets/bad.js': 'nope', 'index.html': '<html></html>' };
  const bytesByPath = new Map();
  const files = Object.entries(bodies).map(([filePath, body]) => {
    const bytes = new TextEncoder().encode(body);
    bytesByPath.set(filePath, bytes);
    return { path: filePath, size: bytes.length, sha256: sha256Hex(bytes) };
  });
  const plan = { files, uploadOrder: ['assets/good.js', 'assets/bad.js', 'index.html'] };

  const original = farm.fetchImpl;
  const client = createSharePointClient({
    webUrl: farm.webUrl,
    getDigest: async () => 'D',
    fetchImpl: async (url, init) => {
      // The second asset can never be written.
      if (String(url).includes('bad.js') && String(init?.method).toUpperCase() === 'POST') {
        return { ok: false, status: 500, headers: { get: () => 'text/plain' }, clone() { return this; }, text: async () => 'boom' };
      }
      return original(url, init);
    },
  });

  const verified = [];
  await assert.rejects(uploadReleaseAssets(client, plan, {
    retry, sha256, distRoot: IDENTITY.targetDistPath,
    downloadFile: async (file) => bytesByPath.get(file.path),
    onVerified: async (filePath) => { verified.push(filePath); },
  }));

  assert.deepEqual(verified, ['assets/good.js'], 'only the genuinely verified file may be recorded');
  assert.equal(verified.includes('assets/bad.js'), false, 'a file that failed to upload must never be recorded as verified');
});

test('a permission failure while creating folders surfaces as PERMISSION_DENIED', async () => {
  // Regression: the create-then-verify catch swallowed every error, so a hard
  // permissions failure was reported as FOLDER_NOT_STABLE / TRANSIENT_NOT_READY
  // with the advice "SharePoint is not consistent yet, we will retry" — the
  // exact opposite of the truth.
  const farm = createFakeSharePoint();
  const original = farm.fetchImpl;
  const client = createSharePointClient({
    webUrl: farm.webUrl,
    getDigest: async () => 'D',
    fetchImpl: async (url, init) => {
      if (String(init?.method || 'GET').toUpperCase() === 'POST') {
        return {
          ok: false, status: 403, headers: { get: () => 'application/json' }, clone() { return this; },
          text: async () => JSON.stringify({ error: { message: { value: 'Access denied.' } } }),
        };
      }
      return original(url, init);
    },
  });

  await assert.rejects(
    ensureFolderTree(client, [`${IDENTITY.siteDbRoot}/siteAssets`], { retry }),
    (error) => {
      const errorClass = error?.sharePoint?.errorClass || error?.errorClass;
      assert.equal(errorClass, SP_ERROR.PERMISSION_DENIED);
      assert.notEqual(error.code, PROVISIONING_ERROR.FOLDER_NOT_STABLE, 'a permissions failure must not be reported as a stabilization timeout');
      return true;
    },
  );
});

test('isFatalProvisioningError separates permanent conditions from transient ones', () => {
  assert.equal(isFatalProvisioningError({ errorClass: SP_ERROR.PERMISSION_DENIED }), true);
  assert.equal(isFatalProvisioningError({ errorClass: SP_ERROR.AUTH_FAILURE }), true);
  assert.equal(isFatalProvisioningError({ errorClass: SP_ERROR.PATH_COLLISION }), true);
  assert.equal(isFatalProvisioningError({ name: 'CancelledError', cancelled: true }), true);
  assert.equal(isFatalProvisioningError({ errorClass: SP_ERROR.TRANSIENT_NOT_READY }), false);
  assert.equal(isFatalProvisioningError({ errorClass: SP_ERROR.MISSING }), false);
});

// ---------------------------------------------------------------------------
// Job lifecycle regressions (need a database)
// ---------------------------------------------------------------------------

const TEST_URI = process.env.SRM_TEST_MONGO_URI || '';
const TEST_DB = `srm_regression_${Date.now()}`;
process.env.MONGO_URI = TEST_URI || 'mongodb://127.0.0.1:1';
process.env.MONGO_DB_NAME = TEST_DB;
const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-regression-'));
process.env.STORAGE_ROOT = path.join(artifactRoot, 'storage');

let available = false;

let db; let closeDb; let createDeploymentJob; let retryDeploymentJob; let settleJob; let JOB_STATE; let canonicalState; let readTargetLock;
test.before(async () => {
  if (!TEST_URI) return;
  const probe = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 1500 });
  try { await probe.connect(); await probe.db(TEST_DB).command({ ping: 1 }); available = true; } catch { available = false; }
  finally { await probe.close().catch(() => {}); }
  if (!available) return;
  const dbModule = require("../src/db.js");
  closeDb = dbModule.closeDb;
  db = await dbModule.connectDb();
  ({ createDeploymentJob, retryDeploymentJob, settleJob } = require("../src/services/jobQueue.js"));
  ({ JOB_STATE, canonicalState } = require("../src/services/jobState.js"));
  ({ readTargetLock } = require("../src/services/targetLock.js"));
});

let counter = 0;
async function makeRelease() {
  const { collectFiles, hashDirectory, ensureDirectory } = require("../src/utils/files.js");
  counter += 1;
  const releaseRoot = path.join(artifactRoot, 'releases', `r${counter}`);
  const distDir = path.join(releaseRoot, 'dist');
  ensureDirectory(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), `console.log(${counter})`);
  fs.writeFileSync(path.join(distDir, 'index.html'), '<html><script src="./assets/app.js"></script></html>');
  const files = collectFiles(distDir);
  fs.writeFileSync(path.join(distDir, 'sharepoint-deploy-manifest.json'), JSON.stringify({
    kind: 'sitebuilder-release-manifest', schemaVersion: 4, buildId: `b${counter}`, buildMode: 'universal',
    artifactKind: 'site-builder-universal-frontend', requiresRuntimeConfig: true, preservesRuntimeConfig: true,
    entryPoint: 'index.html', commitFile: 'index.html', fileCount: files.length,
    indexReferences: ['assets/app.js'],
    files: files.map(({ path: p, size, sha256: h }) => ({ path: p, size, sha256: h })),
  }, null, 2));
  const document = {
    _id: new ObjectId(), version: `1.0.${counter}`, status: 'READY', artifactType: 'universal-dist',
    releaseRoot, distDir, sha256: hashDirectory(distDir), createdAt: new Date(), updatedAt: new Date(),
  };
  await db.collection('releases').insertOne(document);
  return document;
}

async function makeSite() {
  const { canonicalTargetKey } = require("../src/shared/siteRuntime.js");
  counter += 1;
  const site = {
    _id: new ObjectId(), unit: 'u', name: `Site ${counter}`, managerName: 'm',
    host: 'portal.army.idf', siteCode: `schedule${counter}`,
    siteDbFolder: 'siteDB', usersDbFolder: 'siteUsersDb', siteAssetsFolder: 'siteAssets',
    imagesFolder: 'images', widgetsDbTarget: 'users', status: 'TRACKED',
    activeJobId: null, createdAt: new Date(), updatedAt: new Date(),
  };
  site.targetKey = canonicalTargetKey(buildSiteIdentity(site));
  await db.collection('sites').insertOne(site);
  return site;
}

const skip = (t) => t.skip('Set SRM_TEST_MONGO_URI to run database-backed regression tests.');

test('a successful deployment releases the target lock and deletes its staging', async (t) => {
  if (!available) return skip(t);
  // Regression: /complete wrote SUCCEEDED inline, which made settleJob's
  // isTerminal guard fire, so neither the lock nor the staging was released.
  // Every successful deployment leaked one full copy of the release on disk.
  const release = await makeRelease();
  const site = await makeSite();
  const job = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  const stagingRoot = job.stagingRoot;
  assert.ok(fs.existsSync(stagingRoot));

  await settleJob(job._id, JOB_STATE.SUCCEEDED, { message: 'done' });

  assert.equal(await readTargetLock(site.targetKey), null, 'the target lock must be released on success');
  assert.equal(fs.existsSync(stagingRoot), false, 'staging must be deleted on success');
});

test('a settled run can never be resurrected by a late report', async (t) => {
  if (!available) return skip(t);
  const release = await makeRelease();
  const site = await makeSite();
  const job = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  await settleJob(job._id, JOB_STATE.CANCELLED, { message: 'cancelled' });

  // A late settle is a no-op, not a state change.
  const again = await settleJob(job._id, JOB_STATE.SUCCEEDED, { message: 'late success' });
  assert.equal(canonicalState(again.state), JOB_STATE.CANCELLED);
});

test('retry is refused while a browser worker still holds a live lease', async (t) => {
  if (!available) return skip(t);
  // Regression: retry rebuilt staging, deleting the directory the live worker
  // was reading from. The worker then died silently mid-upload.
  const release = await makeRelease();
  const site = await makeSite();
  const job = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  await db.collection('deployment_jobs').updateOne(
    { _id: job._id },
    { $set: { state: JOB_STATE.DEPLOYING, browserLease: { leaseId: 'L1', clientId: 'worker-a', acquiredAt: new Date(), heartbeatAt: new Date() } } },
  );

  await assert.rejects(retryDeploymentJob(job._id), (error) => {
    assert.equal(error.code, 'WORKER_ACTIVE');
    assert.equal(error.statusCode, 409);
    return true;
  });
  assert.ok(fs.existsSync(job.stagingRoot), 'the live worker\'s staging must be left intact');
});

test('a retry that fails to prepare does not leave the target locked', async (t) => {
  if (!available) return skip(t);
  // Regression: retryDeploymentJob took the lock and then called prepare
  // without a try/catch, so a preparation failure left a terminal job holding
  // the target.
  const release = await makeRelease();
  const site = await makeSite();
  const job = await createDeploymentJob({ siteId: site._id, releaseId: release._id });
  await settleJob(job._id, JOB_STATE.FAILED, { message: 'failed', error: 'boom' });

  // Make preparation impossible by removing the stored artifact.
  fs.rmSync(release.distDir, { recursive: true, force: true });

  await assert.rejects(retryDeploymentJob(job._id));
  assert.equal(await readTargetLock(site.targetKey), null, 'a failed retry must not leave the target locked');
});

test.after(async () => {
  if (available) {
    await db.dropDatabase().catch(() => {});
    await closeDb().catch(() => {});
  }
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});
