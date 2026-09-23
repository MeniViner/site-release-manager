/**
 * Provisioning behaviour against a simulated eventually-consistent SharePoint.
 *
 * The headline test is "reaches COMPLETE without a page refresh": it reproduces
 * the real Windows observation where CREATE_LIBRARIES and CREATE_FOLDERS passed
 * but CREATE_TXT_SEEDS failed, and only a browser refresh plus a second manual
 * run succeeded.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSharePointClient, SEED_CONTENT_TYPE, ASSET_CONTENT_TYPE, escapeODataPath, assertServerRelativePath, classifyFolderReadiness } = require("../src/shared/sharepointClient.js");
const { ensureExactLibrary, ensureFolderTree, ensureTxtSeeds, uploadReleaseAssets, orderParentFirst, LIBRARY_OUTCOME, PROVISIONING_ERROR, ProvisioningError, finalAppSmoke, verifyFinalRuntimeConfig } = require("../src/shared/sharepointProvisioning.js");
const { SP_ERROR, classifySharePointError } = require("../src/shared/sharepointErrors.js");
const { userFacingSharePointFailure } = require("../src/shared/userFacingErrors.js");
const { buildSiteIdentity, buildTxtSeedPlan, requiredLibraries, requiredFolders } = require("../src/shared/siteRuntime.js");
const { RUNTIME_BOOTSTRAP_FILE, RUNTIME_CONFIG_FILE, DEPLOYMENT_METADATA_FILE } = require("../src/shared/universalManifest.js");
const { buildRuntimeBootstrapSource } = require("../src/shared/runtimeBootstrap.js");
const { createFakeSharePoint, folderProbeFixture, instantRetry, sha256Hex } = require("./helpers/fakeSharePoint.js");
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

for (const shape of ['file', 'directory', '404']) {
  test(`folders stabilize through transient "${shape}" not-ready responses`, async () => {
    const farm = createFakeSharePoint({ notReadyReads: 3, notReadyShape: shape });
    seedWebRoot(farm, FRESH);
    farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
    farm.addLibrary('siteUsersDBFresh', FRESH.usersDbRoot);
    const client = clientFor(farm);

    const folders = requiredFolders(FRESH, ['assets', 'images']);
    const results = await ensureFolderTree(client, folders, {
      retry, libraries: [...farm.state.lists.values()],
    });

    assert.equal(results.length, folders.length);
    for (const folder of folders) assert.ok(farm.state.folders.has(folder), `missing ${folder}`);
  });
}

test('an unclassified transient discovery response never triggers a speculative create', async () => {
  const farm = createFakeSharePoint({ notReadyShape: 'spexception' });
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const path = `${FRESH.siteDbRoot}/unknown`;

  await assert.rejects(
    ensureFolderTree(clientFor(farm), [path], {
      retry: { ...retry, maxAttempts: 3 },
      libraries: [library],
      createFolderExact: farm.createFolderExact,
    }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.FOLDER_NOT_STABLE);
      return true;
    },
  );
  assert.equal(farm.state.folderCreateCalls.length, 0, 'unknown state must remain read-only');
});

test('transient discovery waits for a definitive missing answer before creating once', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const path = `${FRESH.siteDbRoot}/eventually missing`;
  const original = farm.fetchImpl;
  let ambiguousReads = 0;
  const client = createSharePointClient({
    webUrl: farm.webUrl,
    getDigest: async () => 'D',
    fetchImpl: async (url, init) => {
      if (String(url).includes('/ListItemAllFields') && ambiguousReads < 2) {
        ambiguousReads += 1;
        return {
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ error: { code: '-1, Microsoft.SharePoint.SPException', message: { value: 'The farm is busy.' } } }),
        };
      }
      return original(url, init);
    },
  });

  const [result] = await ensureFolderTree(client, [path], {
    retry,
    libraries: [library],
    createFolderExact: farm.createFolderExact,
  });
  assert.equal(ambiguousReads, 2);
  assert.equal(farm.state.folderCreateCalls.length, 1);
  assert.equal(result.reason, 'LIST_BACKED_FOLDER_READY');
});

test('child readiness requires exact positive list, folder-object and parent-enumeration evidence', () => {
  const ready = folderProbeFixture();
  assert.deepEqual(classifyFolderReadiness(ready), {
    ready: true,
    exists: true,
    reason: 'LIST_BACKED_FOLDER_READY',
    expectedPath: ready.expectedPath,
    actualPath: ready.expectedPath,
    parentPath: ready.expectedParentPath,
    libraryId: ready.expectedLibraryId,
    listItemId: 17,
  });

  const cases = [
    ['missing list-item ID', { listItemId: null }, 'FOLDER_LIST_ITEM_ID_UNCONFIRMED', false],
    ['missing object type', { fileSystemObjectType: 'unconfirmed' }, 'FOLDER_OBJECT_TYPE_UNCONFIRMED', false],
    ['wrong object type', { fileSystemObjectType: 0 }, 'FOLDER_NAME_COLLISION', true],
    ['wrong FileRef', { fileRef: `${ready.expectedPath}-wrong` }, 'FOLDER_PATH_MISMATCH', true],
    ['wrong FolderRef', { folderRef: `${ready.expectedPath}-wrong` }, 'FOLDER_PATH_MISMATCH', true],
    ['wrong folder object path', { folderObjectPath: `${ready.expectedPath}-wrong` }, 'FOLDER_PATH_MISMATCH', true],
    ['wrong list', { listId: 'other-list' }, 'FOLDER_OWNER_LIBRARY_MISMATCH', true],
    ['wrong parent entry path', { parentEntryPath: `${ready.expectedPath}-wrong` }, 'FOLDER_PARENT_ENUMERATION_MISMATCH', false],
    ['wrong parent list item', { parentListItemId: 99 }, 'FOLDER_PARENT_ENUMERATION_MISMATCH', true],
    ['wrong parent list', { parentListId: 'other-list' }, 'FOLDER_OWNER_LIBRARY_MISMATCH', true],
  ];
  for (const [label, overrides, reason, contradiction] of cases) {
    const outcome = classifyFolderReadiness(folderProbeFixture(overrides));
    assert.equal(outcome.ready, false, label);
    assert.equal(outcome.reason, reason, label);
    assert.equal(Boolean(outcome.contradiction), contradiction, label);
  }
});

test('explicit Exists:false remains missing even when another endpoint returns metadata', () => {
  const outcome = classifyFolderReadiness(folderProbeFixture({ folderExists: false }));
  assert.equal(outcome.ready, false);
  assert.equal(outcome.exists, false);
  assert.equal(outcome.contradiction, true);
  assert.equal(outcome.reason, 'FOLDER_NOT_FOUND');
});

test('an explicit null OData record is not mistaken for list-item metadata', () => {
  const fixture = folderProbeFixture();
  const outcome = classifyFolderReadiness({
    ...fixture,
    listItem: { d: null },
  });
  assert.equal(outcome.ready, false);
  assert.equal(outcome.exists, true);
  assert.equal(outcome.reason, 'FOLDER_OBJECT_VISIBLE_WAITING_FOR_LIST_ITEM');
});

test('HTTP 200 with null metadata remains unknown and cannot authorize creation', () => {
  const fixture = folderProbeFixture();
  const outcome = classifyFolderReadiness({
    ...fixture,
    listItem: { d: null },
    folder: { d: null },
  });
  assert.equal(outcome.ready, false);
  assert.equal(outcome.exists, false);
  assert.equal(outcome.unknown, true);
  assert.equal(outcome.reason, 'FOLDER_METADATA_UNRECOGNIZED');
});

for (const odataMode of ['verbose', 'minimal']) {
  test(`folder probes parse ${odataMode} envelopes and verify real parent membership`, async () => {
    const farm = createFakeSharePoint({ odataMode });
    seedWebRoot(farm, FRESH);
    const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
    const path = `${FRESH.siteDbRoot}/תיקייה עם רווחים`;
    farm.addVisibleManualFolder(path);
    const outcome = await clientFor(farm).probeFolder(path, {
      libraryTitle: library.title,
      libraryId: library.id,
      parentPath: FRESH.siteDbRoot,
    });
    assert.equal(outcome.ready, true);
    assert.equal(outcome.listItemId > 0, true);
    assert.equal(outcome.libraryId, library.id);
  });
}

test('read-only diagnostics distinguish a visible manual folder from an incomplete app-created child', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const manual = `${FRESH.siteDbRoot}/ידני`;
  const incomplete = `${FRESH.siteDbRoot}/יישום חלקי`;
  farm.addVisibleManualFolder(manual);
  farm.addIncompleteAppFolder(incomplete);
  const client = clientFor(farm);
  const options = { libraryTitle: library.title, libraryId: library.id, parentPath: FRESH.siteDbRoot };

  assert.match((await client.probeFolder(manual, options)).reason, /READY/);
  assert.equal((await client.probeFolder(incomplete, options)).reason, 'FOLDER_LIST_ITEM_ID_UNCONFIRMED');
  assert.equal(farm.state.folderCreateCalls.length, 0, 'diagnostic probes must remain read-only');
});

test('401 and 403 from parent enumeration classify as authorization failures', async () => {
  for (const status of [401, 403]) {
    const farm = createFakeSharePoint();
    seedWebRoot(farm, FRESH);
    const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
    const path = `${FRESH.siteDbRoot}/protected`;
    farm.addFolder(path);
    const original = farm.fetchImpl;
    const client = createSharePointClient({
      webUrl: farm.webUrl,
      getDigest: async () => 'D',
      fetchImpl: async (url, init) => {
        if (String(url).includes('/Folders?')) {
          return {
            ok: false,
            status,
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify({ error: { message: { value: status === 401 ? 'Sign in required.' : 'Access denied.' } } }),
          };
        }
        return original(url, init);
      },
    });
    const outcome = await client.probeFolder(path, {
      libraryTitle: library.title,
      libraryId: library.id,
      parentPath: FRESH.siteDbRoot,
    });
    assert.equal(outcome.reason, 'FOLDER_PROBE_AUTHORIZATION_FAILED');
    assert.equal(outcome.status, status);
    assert.equal(outcome.errorClass, status === 401 ? SP_ERROR.AUTH_FAILURE : SP_ERROR.PERMISSION_DENIED);
  }
});

test('parent-enumeration fallback verifies membership and surfaces fallback 403', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const path = `${FRESH.siteDbRoot}/fallback child`;
  farm.addFolder(path);
  const original = farm.fetchImpl;
  const advancedRejected = async (url, init) => {
    if (String(url).includes('/Folders?') && String(url).includes('ListItemAllFields')) {
      return {
        ok: false,
        status: 400,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ error: { code: '-1, Microsoft.SharePoint.SPException', message: { value: 'Unsupported expand.' } } }),
      };
    }
    return original(url, init);
  };
  const options = { libraryTitle: library.title, libraryId: library.id, parentPath: FRESH.siteDbRoot };
  const fallbackClient = createSharePointClient({ webUrl: farm.webUrl, fetchImpl: advancedRejected, getDigest: async () => 'D' });
  assert.equal((await fallbackClient.probeFolder(path, options)).ready, true);

  const deniedClient = createSharePointClient({
    webUrl: farm.webUrl,
    getDigest: async () => 'D',
    fetchImpl: async (url, init) => {
      if (String(url).includes('/Folders?') && !String(url).includes('ListItemAllFields')) {
        return {
          ok: false,
          status: 403,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ error: { message: { value: 'Access denied.' } } }),
        };
      }
      return advancedRejected(url, init);
    },
  });
  const denied = await deniedClient.probeFolder(path, options);
  assert.equal(denied.reason, 'FOLDER_PROBE_AUTHORIZATION_FAILED');
  assert.equal(denied.errorClass, SP_ERROR.PERMISSION_DENIED);
});

test('historical incomplete folders poll then require reconciliation without mutation', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const path = `${FRESH.siteDbRoot}/historical incomplete`;
  farm.addIncompleteAppFolder(path);

  await assert.rejects(
    ensureFolderTree(clientFor(farm), [path], {
      retry: { ...retry, maxAttempts: 3 },
      libraries: [library],
      createFolderExact: farm.createFolderExact,
    }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.FOLDER_RECONCILIATION_REQUIRED);
      assert.equal(error.reason, 'FOLDER_LIST_ITEM_ID_UNCONFIRMED');
      assert.equal(error.destructiveRepairAllowed, false);
      assert.equal(error.mutationAttempted, false);
      return true;
    },
  );
  assert.equal(farm.state.folderCreateCalls.length, 0);
});

test('folder authorization classification surfaces immediately without mutation', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const path = `${FRESH.siteDbRoot}/protected`;
  const client = {
    probeFolder: async () => ({
      ready: false,
      exists: false,
      authorization: true,
      reason: 'FOLDER_PROBE_AUTHORIZATION_FAILED',
      status: 403,
      errorClass: SP_ERROR.PERMISSION_DENIED,
    }),
  };

  await assert.rejects(
    ensureFolderTree(client, [path], {
      retry,
      libraries: [library],
      createFolderExact: farm.createFolderExact,
    }),
    (error) => {
      assert.equal(error.code, PROVISIONING_ERROR.FOLDER_PROBE_AUTHORIZATION_FAILED);
      assert.equal(error.errorClass, SP_ERROR.PERMISSION_DENIED);
      return true;
    },
  );
  assert.equal(farm.state.folderCreateCalls.length, 0);
});

test('library-bound folder creation preserves exact Hebrew names, parents and list identity', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const left = `${FRESH.siteDbRoot}/אב`;
  const right = `${FRESH.siteDbRoot}/אם`;
  farm.addFolder(left);
  farm.addFolder(right);
  const children = [`${left}/שם זהה`, `${right}/שם זהה`];

  const results = await ensureFolderTree(clientFor(farm), children, {
    retry,
    libraries: [library],
    createFolderExact: farm.createFolderExact,
  });

  assert.equal(results.every((entry) => entry.created), true);
  assert.deepEqual(farm.state.folderCreateCalls.map(({ libraryId, parentPath, leafName, folderPath }) => ({
    libraryId, parentPath, leafName, folderPath,
  })), [
    { libraryId: library.id, parentPath: left, leafName: 'שם זהה', folderPath: children[0] },
    { libraryId: library.id, parentPath: right, leafName: 'שם זהה', folderPath: children[1] },
  ]);
  assert.equal([...farm.state.folders.keys()].some((path) => /שם זהה\d+$/.test(path)), false, 'no suffix may be adopted');
});

test('an ambiguous folder create is never repeated and recovers only from exact verified state', async () => {
  const farm = createFakeSharePoint({ folderCreateReportsError: true, notReadyReads: 2 });
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const path = `${FRESH.siteDbRoot}/נוצר למרות שגיאה`;

  const [result] = await ensureFolderTree(clientFor(farm), [path], {
    retry,
    libraries: [library],
    createFolderExact: farm.createFolderExact,
  });

  assert.equal(farm.state.folderCreateCalls.length, 1);
  assert.equal(result.recoveredAfterCreateError, true);
  assert.equal(result.created, false);
  assert.equal(result.reason, 'LIST_BACKED_FOLDER_READY');
});

test('a parent-missing 409 repairs the verified parent before one child retry', async () => {
  const farm = createFakeSharePoint();
  seedWebRoot(farm, FRESH);
  const library = farm.addLibrary('siteDBFresh', FRESH.siteDbRoot);
  const parent = `${FRESH.siteDbRoot}/parent`;
  const child = `${parent}/child`;
  farm.addFolder(parent);
  let calls = 0;

  const [result] = await ensureFolderTree(clientFor(farm), [child], {
    retry,
    libraries: [library],
    createFolderExact: async (input) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('The parent folder does not exist yet.');
        error.errorClass = SP_ERROR.MISSING;
        throw error;
      }
      return farm.createFolderExact(input);
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.repairedParent, true);
  assert.equal(result.reason, 'LIST_BACKED_FOLDER_READY');
});

test('a contextual SharePoint 409 identifies a missing parent rather than an existing child', () => {
  const error = classifySharePointError({
    httpStatus: 409,
    operation: 'create-folder:/sites/schedule/siteDB/parent/child',
    body: { error: { message: { value: 'The parent folder does not exist.' } } },
  });
  assert.equal(error.errorClass, SP_ERROR.MISSING);
});

test('historical-folder reconciliation errors provide a Hebrew corrective action', () => {
  const safe = userFacingSharePointFailure({
    code: PROVISIONING_ERROR.FOLDER_RECONCILIATION_REQUIRED,
    errorClass: SP_ERROR.PERMANENT_FAILURE,
  });
  assert.match(safe.message, /תיקייה היסטורית/);
  assert.match(safe.nextAction, /ידנית/);
});

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
    ensureFolderTree(client, ['/sites/schedule/siteDBFresh/siteAssets'], {
      retry,
      libraries: [{ id: 'list-denied', title: 'siteDBFresh', rootFolder: FRESH.siteDbRoot }],
    }),
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
    retry, log, libraries: [...farm.state.lists.values()],
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
      retry, libraries: [...farm.state.lists.values()],
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
    siteRoot: identity.siteRoot,
    siteApiRoot: identity.siteApiRoot,
    siteDbFolder: identity.siteDbFolder,
    siteDbRoot: identity.siteDbRoot,
    usersDbFolder: identity.usersDbFolder,
    usersDbRoot: identity.usersDbRoot,
    siteAssetsFolder: identity.siteAssetsFolder,
    siteAssetsRoot: identity.siteAssetsRoot,
    imagesFolder: identity.imagesFolder,
    imagesRoot: identity.imagesRoot,
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
    siteRoot: identity.siteRoot,
    siteApiRoot: identity.siteApiRoot,
    siteDbRoot: identity.siteDbRoot,
    usersDbRoot: identity.usersDbRoot,
    siteAssetsRoot: identity.siteAssetsRoot,
    imagesRoot: identity.imagesRoot,
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
    runtimeBootstrapUrl: new URL(RUNTIME_BOOTSTRAP_FILE, identity.finalAppUrl).toString(),
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
