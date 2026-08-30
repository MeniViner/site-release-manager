/**
 * End-to-end run of the ACTUAL deployment pipeline that ships to the browser,
 * driven against a simulated eventually-consistent SharePoint farm and an
 * in-memory Release Manager API.
 *
 * This is the closest thing to the Windows acceptance run that can be executed
 * on a developer machine: same pipeline module, same provisioning code, same
 * error classifier, same stage vocabulary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runDeploymentPipeline } from '../../shared/deploymentPipeline.js';
import { STAGE } from '../../shared/deploymentStages.js';
import { buildSiteIdentity, buildTxtSeedPlan, requiredLibraries, requiredFolders } from '../../shared/siteRuntime.js';
import { createFakeSharePoint, instantRetry, sha256Hex } from './helpers/fakeSharePoint.js';

/** Real control flow, zero wall-clock cost. */
const FAST_RETRY = { ...instantRetry, maxAttempts: 14, maxElapsedMs: 20_000 };

const FRESH = buildSiteIdentity({
  host: 'portal.army.idf', siteCode: 'schedule',
  siteDbFolder: 'siteDBFresh', usersDbFolder: 'siteUsersDBFresh',
});
const EXISTING = buildSiteIdentity({ host: 'portal.army.idf', siteCode: 'schedule' });

const encoder = new TextEncoder();

function releaseFiles() {
  const bodies = {
    'assets/app.js': 'console.log("site builder")',
    'assets/app.css': 'body{margin:0}',
    'sitebuilder-runtime-config.json': '{"host":"portal.army.idf"}',
    'sitebuilder-deployment.json': '{"kind":"sitebuilder-deployment"}',
    'index.html': '<html><head><link href="./assets/app.css"><script src="./assets/app.js"></script></head><body></body></html>',
  };
  const bytesByPath = new Map();
  const files = Object.entries(bodies).map(([filePath, body]) => {
    const bytes = encoder.encode(body);
    bytesByPath.set(filePath, bytes);
    return { path: filePath, size: bytes.length, sha256: sha256Hex(bytes) };
  });
  return { files, bytesByPath, uploadOrder: [...files.filter((f) => f.path !== 'index.html').map((f) => f.path), 'index.html'] };
}

/**
 * Minimal in-memory stand-in for the Release Manager API, implementing the same
 * lease/claim/telemetry contract as the real routes.
 */
function createFakeApi(identity, release) {
  const state = {
    events: [],
    progress: [],
    verifiedAssets: [],
    lease: null,
    completed: null,
    failed: null,
    leaseRejections: 0,
  };

  const descriptor = {
    job: { id: 'job-1' },
    site: {
      id: 'site-1', name: 'Schedule', ...identity,
      finalDistRoot: identity.targetDistPath,
      finalUrl: identity.finalAppUrl,
    },
    release: { id: 'release-1', version: '1.4.0' },
    libraries: requiredLibraries(identity),
    folders: requiredFolders(identity, ['assets']),
    seedFiles: buildTxtSeedPlan(identity),
    permissionsMarker: `${identity.usersDbRoot}/.permissions-setup.json`,
    manifest: { files: release.files, uploadOrder: release.uploadOrder },
    resume: { resumeFrom: STAGE.BROWSER_ACTIVATE, completedStages: [], verifiedAssets: [] },
  };

  async function apiCall(path, options = {}, leaseId = '') {
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};

    if (path.endsWith('/claim')) {
      if (state.lease && state.lease.clientId !== body.clientId) {
        state.leaseRejections += 1;
        const error = new Error('worker אחר כבר מבצע את הריצה הזו.');
        error.httpStatus = 409;
        error.apiCode = 'LEASE_HELD';
        throw error;
      }
      state.lease = { leaseId: `lease-${Date.now()}`, clientId: body.clientId };
      return { granted: true, leaseId: state.lease.leaseId, resumeFrom: descriptor.resume.resumeFrom, completedStages: descriptor.resume.completedStages, verifiedAssets: descriptor.resume.verifiedAssets };
    }

    // Every write must present the current lease.
    if (method === 'POST' && !path.endsWith('/claim')) {
      if (!state.lease || leaseId !== state.lease.leaseId) {
        const error = new Error('lease lost');
        error.httpStatus = 409;
        error.apiCode = 'LEASE_LOST';
        throw error;
      }
    }

    if (path.endsWith('/event')) { state.events.push(body); return { ok: true }; }
    if (path.endsWith('/progress')) { state.progress.push(body); return { ok: true }; }
    if (path.endsWith('/verified-asset')) { state.verifiedAssets.push(...body.paths); return { ok: true }; }
    if (path.endsWith('/heartbeat')) return { ok: true };
    if (path.endsWith('/release-lease')) { state.lease = null; return { ok: true }; }
    if (path.endsWith('/complete')) { state.completed = body; return { ok: true }; }
    if (path.endsWith('/fail')) { state.failed = body; return { ok: true }; }
    return descriptor;
  }

  return { state, descriptor, apiCall };
}

function pipelineOptions(farm, api, release, overrides = {}) {
  return {
    jobId: 'job-1',
    apiCall: api.apiCall,
    fetchImpl: farm.fetchImpl,
    sha256: async (bytes) => sha256Hex(bytes),
    createLibraryExact: () => farm.createLibraryExact,
    hostname: 'portal.army.idf',
    clientId: 'worker-a',
    downloadFile: async (file) => release.bytesByPath.get(file.path),
    setTimer: null,
    clearTimer: null,
    retry: FAST_RETRY,
    onProgress: () => {},
    ...overrides,
  };
}

const successStages = (events) => events.filter((event) => event.status === 'success').map((event) => event.stage);

test('a FRESH logical site completes in one automatic run despite eventual consistency', async () => {
  // The exact real-world scenario: libraries and folders are created, and the
  // immediately following reads fail with HTTP 400 + FileNotFound. Previously
  // this required a browser refresh and a second manual run.
  const farm = createFakeSharePoint({ notReadyReads: 3, notReadyShape: 'file' });
  farm.state.folders.set(FRESH.siteRoot, { listItemId: 1 });
  const release = releaseFiles();
  const api = createFakeApi(FRESH, release);

  const result = await runDeploymentPipeline(pipelineOptions(farm, api, release));

  assert.equal(result.ok, true);
  assert.equal(result.finalUrl, FRESH.finalAppUrl);
  assert.ok(api.state.completed, 'the run must report completion');
  assert.equal(api.state.failed, null);

  // Every stage from browser activation to completion must be recorded.
  const stages = successStages(api.state.events);
  for (const expected of [
    STAGE.BROWSER_ACTIVATE, STAGE.TARGET_VALIDATE, STAGE.SHAREPOINT_CONTEXTINFO,
    STAGE.LIBRARY_DISCOVERY, STAGE.CREATE_LIBRARIES, STAGE.LIBRARY_STABILIZE,
    STAGE.CREATE_FOLDERS, STAGE.FOLDER_STABILIZE, STAGE.CREATE_TXT_SEEDS,
    STAGE.FINAL_ASSET_COPY, STAGE.FINAL_ASSET_VERIFY, STAGE.FINAL_INDEX_COMMIT,
    STAGE.FINAL_INDEX_VERIFY, STAGE.FINAL_APP_SMOKE,
  ]) {
    assert.ok(stages.includes(expected), `missing successful stage ${expected}`);
  }

  // All ten TXT seeds created, in the Site Builder locations.
  assert.equal(buildTxtSeedPlan(FRESH).length, 10);
  for (const seed of buildTxtSeedPlan(FRESH)) {
    assert.ok(farm.state.files.has(seed.path), `TXT seed missing: ${seed.path}`);
  }

  // index.html is the last thing written.
  assert.equal(farm.state.uploadSequence.at(-1), `${FRESH.targetDistPath}/index.html`);
  // The run genuinely waited through the not-ready window.
  assert.ok(api.state.events.some((event) => /ממתין/.test(event.message || '')), 'the run should have waited through a not-ready window');
});

test('an EXISTING site update preserves TXT data and does not recreate libraries', async () => {
  const farm = createFakeSharePoint({ notReadyReads: 1 });
  farm.state.folders.set(EXISTING.siteRoot, { listItemId: 1 });
  farm.addLibrary('siteDB', EXISTING.siteDbRoot);
  farm.addLibrary('siteUsersDb', EXISTING.usersDbRoot);
  for (const folder of requiredFolders(EXISTING, ['assets'])) farm.addFolder(folder);

  // Real application data already on the target.
  const realUsers = JSON.stringify([{ id: 7, name: 'existing admin' }]);
  const realTheme = JSON.stringify({ primary: '#123456' });
  farm.addFile(`${EXISTING.siteAssetsRoot}/users_data.txt`, realUsers);
  farm.addFile(`${EXISTING.siteAssetsRoot}/theme_data.txt`, realTheme);
  farm.addFile(`${EXISTING.usersDbRoot}/widgets_data.txt`, JSON.stringify({ w: 1 }));

  const listCountBefore = farm.state.lists.size;
  const release = releaseFiles();
  const api = createFakeApi(EXISTING, release);

  const result = await runDeploymentPipeline(pipelineOptions(farm, api, release));
  assert.equal(result.ok, true);

  // Protected path: existing TXT content is byte-identical afterwards.
  assert.equal(Buffer.from(farm.state.files.get(`${EXISTING.siteAssetsRoot}/users_data.txt`).bytes).toString('utf8'), realUsers);
  assert.equal(Buffer.from(farm.state.files.get(`${EXISTING.siteAssetsRoot}/theme_data.txt`).bytes).toString('utf8'), realTheme);
  assert.equal(farm.state.lists.size, listCountBefore, 'existing libraries must not be recreated');
  assert.equal(result.seeds.preserved, 3);
  assert.equal(result.seeds.created, 7);

  // No TXT data file was ever uploaded for the preserved entries.
  for (const preservedPath of [`${EXISTING.siteAssetsRoot}/users_data.txt`, `${EXISTING.siteAssetsRoot}/theme_data.txt`]) {
    assert.equal(farm.state.uploadSequence.includes(preservedPath), false, `existing TXT was overwritten: ${preservedPath}`);
  }
});

test('deploying target A then target B from the same release leaks no identity', async () => {
  const release = releaseFiles();
  const farm = createFakeSharePoint();
  farm.state.folders.set(EXISTING.siteRoot, { listItemId: 1 });

  for (const identity of [EXISTING, FRESH]) {
    const api = createFakeApi(identity, release);
    // eslint-disable-next-line no-await-in-loop
    const result = await runDeploymentPipeline(pipelineOptions(farm, api, release, { clientId: `worker-${identity.siteDbFolder}` }));
    assert.equal(result.finalUrl, identity.finalAppUrl);
  }

  assert.ok(farm.state.files.has(`${EXISTING.targetDistPath}/index.html`));
  assert.ok(farm.state.files.has(`${FRESH.targetDistPath}/index.html`));
  assert.notEqual(EXISTING.targetDistPath, FRESH.targetDistPath);
});

test('a second worker without the lease cannot deploy the same job', async () => {
  const farm = createFakeSharePoint();
  farm.state.folders.set(FRESH.siteRoot, { listItemId: 1 });
  const release = releaseFiles();
  const api = createFakeApi(FRESH, release);

  // Worker A takes the lease and never releases it.
  await api.apiCall('/api/deployments/job-1/claim', { method: 'POST', body: JSON.stringify({ clientId: 'worker-a' }) });

  await assert.rejects(
    runDeploymentPipeline(pipelineOptions(farm, api, release, { clientId: 'worker-b' })),
    (error) => {
      assert.equal(error.apiCode, 'LEASE_HELD');
      return true;
    },
  );
  assert.equal(farm.state.uploadSequence.length, 0, 'a worker without the lease must not write to SharePoint');
});

test('a run resumes without re-uploading assets already verified at the target', async () => {
  const farm = createFakeSharePoint();
  farm.state.folders.set(FRESH.siteRoot, { listItemId: 1 });
  const release = releaseFiles();
  const api = createFakeApi(FRESH, release);

  // Simulate an interrupted attempt that already provisioned and verified most files.
  for (const spec of requiredLibraries(FRESH)) farm.addLibrary(spec.title, spec.rootFolder);
  for (const folder of requiredFolders(FRESH, ['assets'])) farm.addFolder(folder);
  const resumedPaths = release.uploadOrder.filter((filePath) => filePath !== 'index.html');
  for (const filePath of resumedPaths) {
    farm.state.files.set(`${FRESH.targetDistPath}/${filePath}`, { bytes: release.bytesByPath.get(filePath), contentType: 'application/octet-stream' });
  }
  api.descriptor.resume = { resumeFrom: STAGE.FINAL_ASSET_COPY, completedStages: [STAGE.CREATE_LIBRARIES, STAGE.CREATE_FOLDERS, STAGE.CREATE_TXT_SEEDS], verifiedAssets: resumedPaths };

  const result = await runDeploymentPipeline(pipelineOptions(farm, api, release));
  assert.equal(result.ok, true);
  assert.equal(farm.state.uploadSequence.filter((p) => p.endsWith('index.html')).length, 1);
  assert.equal(
    farm.state.uploadSequence.some((p) => p.endsWith('/app.js')),
    false,
    'an already-verified asset must not be re-uploaded on resume',
  );
});

test('a failure reports a normalized error class and a next action', async () => {
  const farm = createFakeSharePoint();
  farm.state.folders.set(FRESH.siteRoot, { listItemId: 1 });
  const release = releaseFiles();
  const api = createFakeApi(FRESH, release);

  // SharePoint denies every write: a permanent condition that must surface at
  // once rather than being retried to exhaustion.
  const originalFetch = farm.fetchImpl;
  const denyingFarm = {
    ...farm,
    fetchImpl: async (url, init) => {
      if (String(init?.method || 'GET').toUpperCase() === 'POST' && !String(url).includes('contextinfo')) {
        return {
          ok: false, status: 403, headers: { get: () => 'application/json' }, clone() { return this; },
          text: async () => JSON.stringify({ error: { message: { value: 'Access denied. You do not have permission to perform this action.' } } }),
        };
      }
      return originalFetch(url, init);
    },
  };

  await assert.rejects(
    runDeploymentPipeline(pipelineOptions(denyingFarm, api, release)),
    () => true,
  );
  assert.ok(api.state.failed, 'the failure must be reported to the API');
  assert.ok(api.state.failed.errorClass, 'a normalized error class is required');
  assert.ok(api.state.failed.stage, 'the failing stage is required');
  assert.equal(api.state.failed.errorClass, 'PERMISSION_DENIED');
  assert.ok(api.state.failed.nextAction, 'the user must be told what to do next');
  assert.equal(api.state.completed, null);
});

test('the permissions boundary is reported, never silently assumed', async () => {
  const farm = createFakeSharePoint();
  farm.state.folders.set(EXISTING.siteRoot, { listItemId: 1 });
  farm.addLibrary('siteDB', EXISTING.siteDbRoot);
  farm.addLibrary('siteUsersDb', EXISTING.usersDbRoot);
  for (const folder of requiredFolders(EXISTING, ['assets'])) farm.addFolder(folder);
  const release = releaseFiles();
  const api = createFakeApi(EXISTING, release);

  await runDeploymentPipeline(pipelineOptions(farm, api, release));

  const permissions = api.state.events.filter((event) => event.stage === STAGE.PERMISSIONS_SETUP);
  assert.equal(permissions.length, 1);
  assert.equal(permissions[0].status, 'warning', 'a missing permissions marker must be surfaced');
  assert.ok(permissions[0].nextAction, 'the user must be told what to do');
  assert.equal(permissions[0].details.managedByReleaseManager, false);
  // Release Manager must not have written the marker itself.
  assert.equal(farm.state.files.has(`${EXISTING.usersDbRoot}/.permissions-setup.json`), false);
});
