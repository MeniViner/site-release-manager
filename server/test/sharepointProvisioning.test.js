/**
 * Provisioning behaviour against a simulated eventually-consistent SharePoint.
 *
 * The headline test is "reaches COMPLETE without a page refresh": it reproduces
 * the real Windows observation where CREATE_LIBRARIES and CREATE_FOLDERS passed
 * but CREATE_TXT_SEEDS failed, and only a browser refresh plus a second manual
 * run succeeded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSharePointClient, SEED_CONTENT_TYPE, ASSET_CONTENT_TYPE, escapeODataPath, assertServerRelativePath } from '../../shared/sharepointClient.js';
import {
  ensureExactLibrary, ensureFolderTree, ensureTxtSeeds, uploadReleaseAssets,
  orderParentFirst, LIBRARY_OUTCOME, PROVISIONING_ERROR, ProvisioningError, finalAppSmoke,
  verifyFinalRuntimeConfig,
} from '../../shared/sharepointProvisioning.js';
import { SP_ERROR } from '../../shared/sharepointErrors.js';
import { buildSiteIdentity, buildTxtSeedPlan, requiredLibraries, requiredFolders } from '../../shared/siteRuntime.js';
import { RUNTIME_BOOTSTRAP_FILE, RUNTIME_CONFIG_FILE, DEPLOYMENT_METADATA_FILE } from '../../shared/universalManifest.js';
import { buildRuntimeBootstrapSource } from '../../shared/runtimeBootstrap.js';
import { createFakeSharePoint, instantRetry, sha256Hex } from './helpers/fakeSharePoint.js';

const IDENTITY = buildSiteIdentity({ host: 'portal.army.idf', siteCode: 'schedule' });
const FRESH = buildSiteIdentity({
  host: 'portal.army.idf', siteCode: 'schedule',
  siteDbFolder: 'siteDBFresh', usersDbFolder: 'siteUsersDBFresh',
});

const sha256 = async (bytes) => sha256Hex(bytes);
const retry = { ...instantRetry, maxAttempts: 12, maxElapsedMs: 10_000 };

function clientFor(farm) {
  return createSharePointClient({
    webUrl: farm.webUrl,
    fetchImpl: farm.fetchImpl,
    getDigest: async () => 'DIGEST,1',
    nowToken: () => 'test',
  });
}

/** Give the fake farm the SharePoint Web root so library creation has a parent. */
function seedWebRoot(farm, identity) {
  farm.state.folders.set(identity.siteRoot, { listItemId: 1 });
}

test('escapeODataPath escapes the characters SharePoint refuses to route', () => {
  assert.equal(escapeODataPath("it's"), "it''s");
  assert.equal(escapeODataPath('a%b#c?d'), 'a%25b%23c%3Fd');
});

test('assertServerRelativePath rejects traversal, relative and illegal paths', () => {
  assert.throws(() => assertServerRelativePath('sites/x'), /server-relative/);
  assert.throws(() => assertServerRelativePath('/sites/x/../y'), /traversal/);
  assert.throws(() => assertServerRelativePath('/sites/x//y'), /empty path segment/);
  assert.throws(() => assertServerRelativePath('/sites/x/a|b'), /does not allow/);
  assert.equal(assertServerRelativePath('/sites/x/siteDB'), '/sites/x/siteDB');
});

test('orderParentFirst creates every parent before its children', () => {
  const ordered = orderParentFirst([
    '/sites/x/siteDB/dist/assets/deep',
    '/sites/x/siteDB/dist',
    '/sites/x/siteDB/dist/assets',
    '/sites/x/siteDB/dist',
  ]);
  assert.deepEqual(ordered, [
    '/sites/x/siteDB/dist',
    '/sites/x/siteDB/dist/assets',
    '/sites/x/siteDB/dist/assets/deep',
  ]);
});

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

test('an existing exact library is reused and never recreated', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, IDENTITY);
  farm.addLibrary('siteDB', IDENTITY.siteDbRoot);
  const client = clientFor(farm);

  const result = await ensureExactLibrary(client, requiredLibraries(IDENTITY)[0], {
    createLibraryExact: () => { throw new Error('must not create an existing library'); },
    retry, signal: undefined,
  });

  assert.equal(result.outcome, LIBRARY_OUTCOME.REUSED);
  assert.equal(result.created, false);
});

test('a missing library is created and stabilized through transient 400 FileNotFound reads', async () => {
  const farm = createFakeSharePoint({ notReadyReads: 3, notReadyShape: 'file' });
  seedWebRoot(farm, FRESH);
  const client = clientFor(farm);

  const result = await ensureExactLibrary(client, requiredLibraries(FRESH)[0], {
    createLibraryExact: farm.createLibraryExact, retry,
  });

  assert.equal(result.outcome, LIBRARY_OUTCOME.CREATED);
  assert.equal(result.library.rootFolder, FRESH.siteDbRoot);
  assert.equal(Number(result.library.baseTemplate), 101);
});

test('a create that reports an error but committed is recovered, not repeated', async () => {
  const farm = createFakeSharePoint({ notReadyReads: 2, libraryCreateReportsError: true });
  seedWebRoot(farm, FRESH);
  const client = clientFor(farm);

  const result = await ensureExactLibrary(client, requiredLibraries(FRESH)[0], {
    createLibraryExact: farm.createLibraryExact, retry,
  });

  assert.equal(result.outcome, LIBRARY_OUTCOME.RECOVERED);
  assert.equal(result.recoveredAfterCreateError, true);
  assert.equal(farm.state.lists.size, 1, 'the library must not be created twice');
});

test('SharePoint auto-suffixing the root folder URL is a hard failure', async () => {
  const farm = createFakeSharePoint({ autoSuffixLibraryUrl: true });
  seedWebRoot(farm, FRESH);
  const client = clientFor(farm);

  await assert.rejects(
    ensureExactLibrary(client, requiredLibraries(FRESH)[0], { createLibraryExact: farm.createLibraryExact, retry }),
    (error) => {
      assert.ok(error instanceof ProvisioningError);
      assert.equal(error.code, PROVISIONING_ERROR.LIBRARY_URL_ALLOCATION_FAILED);
      assert.equal(error.errorClass, SP_ERROR.PATH_COLLISION);
      assert.equal(error.actualRoot, '/sites/schedule/siteDBFresh1');
      return true;
    },
  );
});

test('a same-title list that is not a Document Library fails clearly', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, IDENTITY);
  farm.addLibrary('siteDB', IDENTITY.siteDbRoot, { baseTemplate: 100 });
  const client = clientFor(farm);

  await assert.rejects(
    ensureExactLibrary(client, requiredLibraries(IDENTITY)[0], { createLibraryExact: farm.createLibraryExact, retry }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.LIBRARY_EXISTS_NOT_DOCUMENT_LIBRARY);
      assert.equal(error.errorClass, SP_ERROR.NON_DOCUMENT_LIBRARY);
      return true;
    },
  );
});

test('another list already occupying the target root URL is reported as a collision', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  farm.addLibrary('Some Other Library', FRESH.siteDbRoot);
  const client = clientFor(farm);

  await assert.rejects(
    ensureExactLibrary(client, requiredLibraries(FRESH)[0], { createLibraryExact: farm.createLibraryExact, retry }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.LIBRARY_URL_COLLISION);
      assert.equal(error.occupierTitle, 'Some Other Library');
      return true;
    },
  );
  assert.equal(farm.state.lists.size, 1, 'the conflicting library must never be deleted or replaced');
});

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

for (const shape of ['file', 'directory', 'spexception', '404']) {
  test(`folders stabilize through transient "${shape}" not-ready responses`, async () => {
    const farm = createFakeSharePoint({ notReadyReads: 3, notReadyShape: shape });
    seedWebRoot(farm, FRESH);
    farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
    farm.addLibrary('siteUsersDBFresh', FRESH.usersDbRoot);
    const client = clientFor(farm);

    const folders = requiredFolders(FRESH, ['assets', 'images']);
    const results = await ensureFolderTree(client, folders, {
      retry, libraryRoots: [FRESH.siteDbRoot, FRESH.usersDbRoot],
    });

    assert.equal(results.length, folders.length);
    for (const folder of folders) assert.ok(farm.state.folders.has(folder), `missing ${folder}`);
  });
}

test('a permission failure during folder work surfaces immediately instead of burning the retry budget', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  const client = createSharePointClient({
    webUrl: farm.webUrl,
    fetchImpl: async () => ({
      ok: false, status: 403, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: { message: { value: 'Access denied.' } } }),
      clone() { return this; },
    }),
    getDigest: async () => 'D',
  });

  await assert.rejects(
    ensureFolderTree(client, ['/sites/schedule/siteDBFresh/siteAssets'], { retry }),
    (error) => {
      assert.equal(error.sharePoint?.errorClass || error.errorClass, SP_ERROR.PERMISSION_DENIED);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// TXT seeds — the protected existing-site rule
// ---------------------------------------------------------------------------

test('existing non-empty TXT data is preserved and never overwritten', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, IDENTITY);
  farm.addLibrary('siteDB', IDENTITY.siteDbRoot);
  farm.addLibrary('siteUsersDb', IDENTITY.usersDbRoot);
  farm.addFolder(IDENTITY.siteAssetsRoot);
  const realUserData = JSON.stringify([{ id: 1, name: 'existing admin' }]);
  farm.addFile(`${IDENTITY.siteAssetsRoot}/users_data.txt`, realUserData);
  const client = clientFor(farm);

  const results = await ensureTxtSeeds(client, buildTxtSeedPlan(IDENTITY), { retry, sha256 });

  const users = results.find((entry) => entry.path.endsWith('users_data.txt'));
  assert.equal(users.action, 'preserved');
  assert.equal(
    Buffer.from(farm.state.files.get(`${IDENTITY.siteAssetsRoot}/users_data.txt`).bytes).toString('utf8'),
    realUserData,
    'existing TXT content must be byte-identical after a deployment',
  );
  assert.equal(farm.state.uploadSequence.includes(`${IDENTITY.siteAssetsRoot}/users_data.txt`), false);
});

test('a whitespace-only TXT file is treated as empty and seeded', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, IDENTITY);
  farm.addFolder(IDENTITY.siteAssetsRoot);
  farm.addFolder(IDENTITY.usersDbRoot);
  farm.addFile(`${IDENTITY.siteAssetsRoot}/theme_data.txt`, '   \n  ');
  const client = clientFor(farm);

  const results = await ensureTxtSeeds(client, buildTxtSeedPlan(IDENTITY), { retry, sha256 });
  assert.equal(results.find((entry) => entry.path.endsWith('theme_data.txt')).action, 'created');
});

test('missing TXT seeds are created, read back and SHA-256 verified', async () => {
  const farm = createFakeSharePoint({ notReadyReads: 2 });
  seedWebRoot(farm, FRESH);
  farm.addFolder(FRESH.siteAssetsRoot);
  farm.addFolder(FRESH.usersDbRoot);
  const client = clientFor(farm);

  const plan = buildTxtSeedPlan(FRESH);
  const results = await ensureTxtSeeds(client, plan, { retry, sha256 });

  assert.equal(results.length, plan.length);
  for (const entry of results) {
    assert.equal(entry.action, 'created');
    assert.equal(entry.sha256, sha256Hex(farm.state.files.get(entry.path).bytes));
  }
  assert.ok(plan.some((seed) => seed.fileName === 'boom_data.txt'), 'boom_data.txt must be part of the seed plan');
});

test('a corrupted seed read-back fails the stage instead of being reported successful', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  farm.addFolder(FRESH.siteAssetsRoot);
  farm.addFolder(FRESH.usersDbRoot);
  const originalFetch = farm.fetchImpl;
  let uploaded = false;
  const client = createSharePointClient({
    webUrl: farm.webUrl,
    getDigest: async () => 'D',
    fetchImpl: async (url, init) => {
      if (String(url).includes('/Files/Add')) {
        uploaded = true;
        return originalFetch(url, init);
      }
      // The file is genuinely missing before the upload, and every read-back
      // AFTER the upload returns corrupted bytes.
      if (String(url).includes('/$value')) {
        if (!uploaded) return originalFetch(url, init);
        const corrupted = new TextEncoder().encode('CORRUPTED');
        return { ok: true, status: 200, headers: { get: () => 'text/plain' }, clone() { return this; }, text: async () => 'CORRUPTED', arrayBuffer: async () => Buffer.from(corrupted) };
      }
      return originalFetch(url, init);
    },
  });

  await assert.rejects(
    ensureTxtSeeds(client, buildTxtSeedPlan(FRESH).slice(0, 1), { retry, sha256 }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.SEED_VERIFY_FAILED);
      return true;
    },
  );
});

test('TXT seeds are uploaded with a text content type and assets as binary', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  farm.addFolder(FRESH.siteAssetsRoot);
  farm.addFolder(FRESH.usersDbRoot);
  const client = clientFor(farm);

  await ensureTxtSeeds(client, buildTxtSeedPlan(FRESH).slice(0, 1), { retry, sha256 });
  const seedUpload = farm.state.requests.filter((request) => request.method === 'POST' && request.url.includes('/Files/Add')).at(-1);
  assert.equal(seedUpload.contentType, SEED_CONTENT_TYPE);
});

// ---------------------------------------------------------------------------
// Release assets — index last
// ---------------------------------------------------------------------------

function assetPlan() {
  const files = [
    { path: 'assets/app.js', body: 'console.log("app")' },
    { path: 'assets/app.css', body: 'body{color:red}' },
    { path: 'index.html', body: '<html><head><link href="./assets/app.css"><script src="./assets/app.js"></script></head><body></body></html>' },
  ].map((file) => {
    const bytes = new TextEncoder().encode(file.body);
    return { path: file.path, size: bytes.length, sha256: sha256Hex(bytes), bytes };
  });
  return {
    files: files.map(({ bytes, ...rest }) => rest),
    uploadOrder: [...files.filter((f) => f.path !== 'index.html').map((f) => f.path), 'index.html'],
    bytesByPath: new Map(files.map((file) => [file.path, file.bytes])),
  };
}

test('every asset is uploaded and verified before index.html is committed', async () => {
  const farm = createFakeSharePoint({ notReadyReads: 1 });
  seedWebRoot(farm, FRESH);
  farm.addFolder(FRESH.siteDbRoot);
  farm.addFolder(FRESH.targetDistPath);
  farm.addFolder(`${FRESH.targetDistPath}/assets`);
  const client = clientFor(farm);
  const plan = assetPlan();

  const result = await uploadReleaseAssets(client, plan, {
    retry, sha256, distRoot: FRESH.targetDistPath,
    downloadFile: async (file) => plan.bytesByPath.get(file.path),
  });

  const uploads = farm.state.uploadSequence;
  assert.equal(uploads.at(-1), `${FRESH.targetDistPath}/index.html`, 'index.html must be the last upload');
  assert.equal(uploads.filter((path) => path.endsWith('index.html')).length, 1);
  assert.equal(result.referencesVerified, 2);

  const assetUpload = farm.state.requests.find((request) => request.method === 'POST' && request.url.includes('app.js'));
  assert.equal(assetUpload.contentType, ASSET_CONTENT_TYPE);
});

test('an index reference that is absent from the manifest fails the run', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  farm.addFolder(FRESH.targetDistPath);
  farm.addFolder(`${FRESH.targetDistPath}/assets`);
  const client = clientFor(farm);

  const bytes = new TextEncoder().encode('<html><script src="./assets/ghost.js"></script></html>');
  const plan = {
    files: [{ path: 'index.html', size: bytes.length, sha256: sha256Hex(bytes) }],
    uploadOrder: ['index.html'],
  };

  await assert.rejects(
    uploadReleaseAssets(client, plan, { retry, sha256, distRoot: FRESH.targetDistPath, downloadFile: async () => bytes }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.INDEX_REFERENCE_MISSING);
      return true;
    },
  );
});

test('a size mismatch at the target fails asset verification', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  farm.addFolder(FRESH.targetDistPath);
  farm.addFolder(`${FRESH.targetDistPath}/assets`);
  const client = clientFor(farm);
  const plan = assetPlan();
  // Claim a wrong size for one asset.
  plan.files = plan.files.map((file) => (file.path === 'assets/app.js' ? { ...file, size: file.size + 10 } : file));

  await assert.rejects(
    uploadReleaseAssets(client, plan, {
      retry, sha256, distRoot: FRESH.targetDistPath,
      downloadFile: async (file) => plan.bytesByPath.get(file.path),
    }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.ASSET_VERIFY_FAILED);
      return true;
    },
  );
});

test('already-verified assets are skipped when a run resumes', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  farm.addFolder(FRESH.targetDistPath);
  farm.addFolder(`${FRESH.targetDistPath}/assets`);
  const client = clientFor(farm);
  const plan = assetPlan();
  // A resume only skips files that are genuinely present and verified at the
  // target from the interrupted attempt.
  for (const path of ['assets/app.js', 'assets/app.css']) {
    farm.state.files.set(`${FRESH.targetDistPath}/${path}`, { bytes: plan.bytesByPath.get(path), contentType: 'application/octet-stream' });
  }

  await uploadReleaseAssets(client, plan, {
    retry, sha256, distRoot: FRESH.targetDistPath,
    downloadFile: async (file) => plan.bytesByPath.get(file.path),
    alreadyVerified: new Set(['assets/app.js', 'assets/app.css']),
  });

  assert.equal(farm.state.uploadSequence.length, 1, 'only index.html should be uploaded on resume');
  assert.equal(farm.state.uploadSequence[0], `${FRESH.targetDistPath}/index.html`);
});

// ---------------------------------------------------------------------------
// The headline regression: one automatic run, no browser refresh
// ---------------------------------------------------------------------------

test('a fresh logical site provisions libraries, folders and TXT seeds in ONE run despite eventual consistency', async () => {
  // Reproduces the real Windows observation: CREATE_LIBRARIES and CREATE_FOLDERS
  // passed, CREATE_TXT_SEEDS failed, and only a manual refresh plus a second run
  // succeeded. Here the same farm behaviour must resolve automatically.
  const farm = createFakeSharePoint({ notReadyReads: 4, notReadyShape: 'file' });
  seedWebRoot(farm, FRESH);
  const client = clientFor(farm);
  const stageLog = [];
  const log = async (entry) => { stageLog.push(entry); };

  for (const spec of requiredLibraries(FRESH)) {
    const result = await ensureExactLibrary(client, spec, { createLibraryExact: farm.createLibraryExact, retry, log });
    assert.ok(result.library, `library ${spec.title} was not provisioned`);
    assert.equal(result.library.rootFolder, spec.rootFolder);
  }

  await ensureFolderTree(client, requiredFolders(FRESH, ['assets', 'images']), {
    retry, log, libraryRoots: [FRESH.siteDbRoot, FRESH.usersDbRoot],
  });

  const seeds = await ensureTxtSeeds(client, buildTxtSeedPlan(FRESH), { retry, sha256, log });

  assert.equal(seeds.length, 10);
  assert.ok(seeds.every((entry) => entry.action === 'created'));
  // Proof the transient window was actually exercised rather than skipped.
  assert.ok(
    stageLog.some((entry) => entry.status === 'info' && /ממתין/.test(entry.message)),
    'the run should have waited through at least one not-ready window',
  );

  const smoke = await finalAppSmoke(client, FRESH.targetDistPath, { retry })
    .catch(() => ({ ok: false }));
  assert.equal(smoke.ok, false, 'no app is deployed yet in this provisioning-only scenario');
});

test('target A and target B in the same Web are provisioned independently', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, IDENTITY);
  const client = clientFor(farm);

  for (const identity of [IDENTITY, FRESH]) {
    for (const spec of requiredLibraries(identity)) {
      await ensureExactLibrary(client, spec, { createLibraryExact: farm.createLibraryExact, retry });
    }
    await ensureFolderTree(client, requiredFolders(identity), {
      retry, libraryRoots: [identity.siteDbRoot, identity.usersDbRoot],
    });
    await ensureTxtSeeds(client, buildTxtSeedPlan(identity), { retry, sha256 });
  }

  assert.ok(farm.state.files.has(`${IDENTITY.siteAssetsRoot}/theme_data.txt`));
  assert.ok(farm.state.files.has(`${FRESH.siteAssetsRoot}/theme_data.txt`));
  assert.notEqual(IDENTITY.siteAssetsRoot, FRESH.siteAssetsRoot);
  assert.ok(farm.state.files.has(`${IDENTITY.usersDbRoot}/widgets_data.txt`));
  assert.ok(farm.state.files.has(`${FRESH.usersDbRoot}/widgets_data.txt`));
});

// ---------------------------------------------------------------------------
// Runtime verification transport split
// ---------------------------------------------------------------------------

function runtimeFixture(identity = IDENTITY) {
  const runtimeConfig = {
    schemaVersion: 2,
    storageBackend: identity.storageBackend,
    host: identity.host,
    siteCode: identity.siteCode,
    siteDbFolder: identity.siteDbFolder,
    siteDbRoot: identity.siteDbRoot,
    usersDbFolder: identity.usersDbFolder,
    usersDbRoot: identity.usersDbRoot,
    siteAssetsFolder: identity.siteAssetsFolder,
    siteAssetsRoot: identity.siteAssetsRoot,
    widgetsDbTarget: identity.widgetsDbTarget,
    targetDistPath: identity.targetDistPath,
    finalAppUrl: identity.finalAppUrl,
    deploymentGeneratedBy: 'site-release-manager',
    deploymentJobId: 'job-77',
    releaseId: 'release-77',
    releaseVersion: '2.1.0',
  };
  const deploymentMetadata = {
    kind: 'sitebuilder-deployment',
    schemaVersion: 3,
    generatedBy: 'site-release-manager',
    storageBackend: identity.storageBackend,
    host: identity.host,
    siteCode: identity.siteCode,
    siteDbRoot: identity.siteDbRoot,
    usersDbRoot: identity.usersDbRoot,
    siteAssetsRoot: identity.siteAssetsRoot,
    targetDistPath: identity.targetDistPath,
    finalAppUrl: identity.finalAppUrl,
    deploymentJobId: 'job-77',
    releaseId: 'release-77',
    releaseVersion: '2.1.0',
  };
  const verification = {
    runtimeConfigFile: RUNTIME_CONFIG_FILE,
    deploymentMetadataFile: DEPLOYMENT_METADATA_FILE,
    runtimeBootstrapFile: RUNTIME_BOOTSTRAP_FILE,
    runtimeConfigPath: `${identity.targetDistPath}/${RUNTIME_CONFIG_FILE}`,
    deploymentMetadataPath: `${identity.targetDistPath}/${DEPLOYMENT_METADATA_FILE}`,
    runtimeBootstrapPath: `${identity.targetDistPath}/${RUNTIME_BOOTSTRAP_FILE}`,
    runtimeConfigUrl: `${identity.siteBaseUrl}/${RUNTIME_CONFIG_FILE}`,
    deploymentMetadataUrl: `${identity.siteBaseUrl}/${DEPLOYMENT_METADATA_FILE}`,
    runtimeBootstrapUrl: `${identity.siteBaseUrl}/${RUNTIME_BOOTSTRAP_FILE}`,
    expected: runtimeConfig,
  };
  return { runtimeConfig, deploymentMetadata, verification };
}

/** A farm that has this target's three runtime files deployed. */
function farmWithRuntimeFiles(identity, fixture, overrides = {}) {
  const farm = createFakeSharePoint({ directJsonReturnsHtml: true, ...overrides });
  farm.addFile(`${identity.targetDistPath}/${RUNTIME_CONFIG_FILE}`, JSON.stringify(fixture.runtimeConfig, null, 2));
  farm.addFile(`${identity.targetDistPath}/${DEPLOYMENT_METADATA_FILE}`, JSON.stringify(fixture.deploymentMetadata, null, 2));
  farm.addFile(`${identity.targetDistPath}/${RUNTIME_BOOTSTRAP_FILE}`, buildRuntimeBootstrapSource(fixture.runtimeConfig));
  return farm;
}

test('runtime JSON is verified through REST while the bootstrap is verified through its direct URL', async () => {
  const fixture = runtimeFixture();
  const farm = farmWithRuntimeFiles(IDENTITY, fixture);
  const client = clientFor(farm);

  const result = await verifyFinalRuntimeConfig(client, farm.fetchImpl, fixture.verification, { retry });

  assert.equal(result.ok, true);
  assert.equal(result.bootstrapVerified, true);
  assert.equal(result.jsonTransport, 'sharepoint-rest-$value');
  assert.equal(result.bootstrapTransport, 'direct-browser-url');
  assert.equal(result.deploymentJobId, 'job-77');
  assert.equal(result.releaseVersion, '2.1.0');
  assert.equal(result.targetDistPath, IDENTITY.targetDistPath);

  // No direct request was made for either .json file, and the bootstrap WAS
  // fetched directly.
  assert.deepEqual(farm.state.directJsonHtmlServed, []);
  assert.deepEqual(farm.state.directReads, [`${IDENTITY.targetDistPath}/${RUNTIME_BOOTSTRAP_FILE}`]);
});

test('a direct .json request answered with HTML does not affect the verified result', async () => {
  const fixture = runtimeFixture();
  const farm = farmWithRuntimeFiles(IDENTITY, fixture);
  const client = clientFor(farm);

  // Exactly the Windows symptom, proven against the same farm instance.
  const direct = await farm.fetchImpl(fixture.verification.runtimeConfigUrl, { method: 'GET' });
  assert.equal(direct.status, 200);
  assert.match(await direct.text(), /^<!DOCTYPE html>/i);

  const result = await verifyFinalRuntimeConfig(client, farm.fetchImpl, fixture.verification, { retry });
  assert.equal(result.ok, true);
});

test('HTML returned through REST is never accepted as valid Runtime Config', async () => {
  const fixture = runtimeFixture();
  const farm = farmWithRuntimeFiles(IDENTITY, fixture);
  farm.addFile(
    `${IDENTITY.targetDistPath}/${RUNTIME_CONFIG_FILE}`,
    '<!DOCTYPE html><html><head></head><body>library viewer</body></html>',
  );
  const client = clientFor(farm);

  await assert.rejects(
    verifyFinalRuntimeConfig(client, farm.fetchImpl, fixture.verification, { retry }),
    (error) => {
      assert.ok(error instanceof ProvisioningError);
      assert.equal(error.code, PROVISIONING_ERROR.RUNTIME_CONFIG_INVALID);
      assert.equal(error.errorClass, SP_ERROR.PERMANENT_FAILURE);
      return true;
    },
  );
});

test('a missing bootstrap fails runtime verification', async () => {
  const fixture = runtimeFixture();
  const farm = farmWithRuntimeFiles(IDENTITY, fixture);
  farm.state.files.delete(`${IDENTITY.targetDistPath}/${RUNTIME_BOOTSTRAP_FILE}`);
  const client = clientFor(farm);

  await assert.rejects(
    verifyFinalRuntimeConfig(client, farm.fetchImpl, fixture.verification, { retry }),
    () => true,
  );
});

test('a bootstrap served with a legacy JavaScript content type is accepted', async () => {
  const fixture = runtimeFixture();
  const farm = farmWithRuntimeFiles(IDENTITY, fixture);
  const client = clientFor(farm);
  const legacyFarmFetch = async (url, init) => {
    const clean = String(url).split('?')[0];
    if (!clean.includes('/_api/') && clean.endsWith(RUNTIME_BOOTSTRAP_FILE)) {
      const body = buildRuntimeBootstrapSource(fixture.runtimeConfig);
      return {
        ok: true,
        status: 200,
        // A classic farm may answer with any of these; the MIME type is
        // reported but never required.
        headers: { get: () => 'application/x-javascript; charset=utf-8' },
        text: async () => body,
        arrayBuffer: async () => Buffer.from(body),
        clone() { return this; },
      };
    }
    return farm.fetchImpl(url, init);
  };

  const result = await verifyFinalRuntimeConfig(client, legacyFarmFetch, fixture.verification, { retry });
  assert.equal(result.ok, true);
  assert.equal(result.bootstrapContentType, 'application/x-javascript; charset=utf-8');
});

test('a verification descriptor pointing outside this target is rejected before any read', async () => {
  const fixture = runtimeFixture();
  const farm = farmWithRuntimeFiles(IDENTITY, fixture);
  const client = clientFor(farm);
  const tampered = {
    ...fixture.verification,
    runtimeBootstrapUrl: `https://portal.army.idf/sites/schedule/siteDBOther/dist/${RUNTIME_BOOTSTRAP_FILE}`,
  };

  await assert.rejects(
    verifyFinalRuntimeConfig(client, farm.fetchImpl, tampered, { retry }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.RUNTIME_CONFIG_TARGET_MISMATCH);
      return true;
    },
  );
  assert.deepEqual(farm.state.directReads, []);
});

test('runtime verification requires both an authenticated client and a browser fetch', async () => {
  const fixture = runtimeFixture();
  const farm = farmWithRuntimeFiles(IDENTITY, fixture);
  await assert.rejects(
    verifyFinalRuntimeConfig(null, farm.fetchImpl, fixture.verification, { retry }),
    /authenticated SharePoint client/,
  );
  await assert.rejects(
    verifyFinalRuntimeConfig(clientFor(farm), null, fixture.verification, { retry }),
    /requires fetchImpl/,
  );
});

test('the final app smoke requires a verified bootstrap that index.html actually loads', async () => {
  const fixture = runtimeFixture();
  const farm = farmWithRuntimeFiles(IDENTITY, fixture);
  const client = clientFor(farm);
  const withBootstrap = '<html><head>'
    + `<script src="./${RUNTIME_BOOTSTRAP_FILE}"></script>`
    + '<script type="module" src="./assets/app.js"></script></head><body></body></html>';
  const withoutBootstrap = '<html><head><script type="module" src="./assets/app.js"></script></head><body></body></html>';

  farm.addFile(`${IDENTITY.targetDistPath}/index.html`, withBootstrap);
  const runtimeVerification = await verifyFinalRuntimeConfig(client, farm.fetchImpl, fixture.verification, { retry });
  const good = await finalAppSmoke(client, IDENTITY.targetDistPath, { retry, runtimeVerification });
  assert.equal(good.ok, true);
  assert.equal(good.indexLoadsRuntimeBootstrap, true);
  assert.equal(good.runtimeBootstrapVerified, true);

  farm.addFile(`${IDENTITY.targetDistPath}/index.html`, withoutBootstrap);
  const bad = await finalAppSmoke(client, IDENTITY.targetDistPath, { retry, runtimeVerification });
  assert.equal(bad.ok, false, 'an index that does not load the bootstrap must not pass the smoke');
  assert.equal(bad.indexLoadsRuntimeBootstrap, false);

  // An unverified bootstrap can never pass either.
  const unverified = await finalAppSmoke(client, IDENTITY.targetDistPath, {
    retry,
    runtimeVerification: { ...runtimeVerification, bootstrapVerified: false },
  });
  assert.equal(unverified.ok, false);
});
