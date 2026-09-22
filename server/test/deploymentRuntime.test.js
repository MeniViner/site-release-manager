/**
 * Per-target runtime overlay.
 *
 * Uses node:test to match the rest of the suite (the project has no vitest
 * dependency, so the previous vitest-based version could never run).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSiteRuntime, buildDeploymentDescriptor } = require("../src/services/deploymentService.js");
const { SiteIdentityError } = require("../src/shared/siteRuntime.js");
const RELEASE_A = { _id: 'release-a', version: '1.2.3' };
const RELEASE_B = { _id: 'release-b', version: '2.0.0' };

test('uses the standard TXT SharePoint folders by default', () => {
  const runtime = buildSiteRuntime(
    { host: 'portal.army.idf', siteCode: 'alpha' },
    RELEASE_A, 'job-a', '2026-08-10T12:00:00.000Z',
  );
  assert.equal(runtime.siteDbRoot, '/sites/alpha/siteDB');
  assert.equal(runtime.siteApiRoot, '/sites/alpha');
  assert.equal(runtime.usersDbRoot, '/sites/alpha/siteUsersDb');
  assert.equal(runtime.siteAssetsRoot, '/sites/alpha/siteDB/siteAssets');
  assert.equal(runtime.imagesRoot, '/sites/alpha/siteDB/images');
  assert.equal(runtime.targetDistPath, '/sites/alpha/siteDB/dist');
  assert.notEqual(runtime.siteApiRoot, runtime.siteDbRoot);
  assert.notEqual(runtime.imagesRoot, runtime.siteAssetsRoot);
  assert.equal(runtime.finalAppUrl, 'https://portal.army.idf/sites/alpha/siteDB/dist/index.html');
  assert.equal(runtime.storageBackend, 'txt');
  assert.equal(runtime.widgetsDbTarget, 'users');
  assert.equal(runtime.bootstrapLibrary, 'SiteAssets');
  assert.equal(runtime.bootstrapFolder, 'sitebuilder-bootstrap');
});

test('preserves non-default existing SharePoint library names', () => {
  const runtime = buildSiteRuntime(
    {
      host: 'portal.army.idf', siteCode: 'alphateam',
      siteDbFolder: 'kashrarDB1', usersDbFolder: 'siteUsersDb',
      siteAssetsFolder: 'siteAssets', imagesFolder: 'images', widgetsDbTarget: 'site',
    },
    RELEASE_B, 'job-b', '2026-08-10T12:00:00.000Z',
  );
  assert.equal(runtime.siteDbRoot, '/sites/alphateam/kashrarDB1');
  assert.equal(runtime.targetDistPath, '/sites/alphateam/kashrarDB1/dist');
  assert.equal(runtime.finalAppUrl, 'https://portal.army.idf/sites/alphateam/kashrarDB1/dist/index.html');
  assert.equal(runtime.widgetsDbTarget, 'site');
});

test('preserves Hebrew and spaces in exact custom library names', () => {
  const runtime = buildSiteRuntime(
    {
      host: 'portal.army.idf',
      siteCode: 'alphateam',
      siteDbFolder: 'נתוני מבצעים',
      usersDbFolder: 'משתמשים פעילים',
    },
    RELEASE_B, 'job-hebrew', '2026-08-10T12:00:00.000Z',
  );
  assert.equal(runtime.siteDbRoot, '/sites/alphateam/נתוני מבצעים');
  assert.equal(runtime.usersDbRoot, '/sites/alphateam/משתמשים פעילים');
});

test('rejects SharePoint-invalid characters while preserving Unicode folder names', () => {
  for (const siteDbFolder of ['bad?name', 'bad\\name', 'bad\u0000name', '.hidden', 'trailing.']) {
    assert.throws(
      () => buildSiteRuntime({
        host: 'portal.army.idf',
        siteCode: 'alpha',
        siteDbFolder,
        usersDbFolder: 'משתמשים תקינים',
      }, RELEASE_A, 'job-invalid-folder', 'now'),
      /single SharePoint folder name|cannot start or end/,
    );
  }
});

test('deployment verification expects every separated runtime identity root', () => {
  const site = {
    _id: 'site-a',
    name: 'Alpha',
    host: 'portal.army.idf',
    siteCode: 'alpha',
    siteDbFolder: 'Alpha Data',
    usersDbFolder: 'Alpha Users',
  };
  const descriptor = buildDeploymentDescriptor({
    job: { _id: 'job-a', state: 'READY_FOR_SHAREPOINT', type: 'UPDATE' },
    site,
    release: RELEASE_A,
    manifest: {
      files: [
        { path: 'assets/app.js', size: 1, sha256: 'a'.repeat(64) },
        { path: 'index.html', size: 1, sha256: 'b'.repeat(64) },
      ],
      uploadOrder: ['assets/app.js', 'index.html'],
    },
    uploadOrder: ['assets/app.js', 'index.html'],
  });
  const expected = descriptor.runtimeVerification.expected;
  for (const field of ['siteRoot', 'siteApiRoot', 'siteDbRoot', 'usersDbRoot', 'siteAssetsRoot', 'imagesRoot', 'targetDistPath']) {
    assert.equal(expected[field], descriptor.site[field], `${field} is absent from production runtime verification`);
  }
});

test('two logical targets in the same SharePoint Web stay fully independent', () => {
  const base = { host: 'portal.army.idf', siteCode: 'schedule' };
  const a = buildSiteRuntime(base, RELEASE_A, 'job-a', '2026-08-10T12:00:00.000Z');
  const b = buildSiteRuntime(
    { ...base, siteDbFolder: 'siteDBFinance', usersDbFolder: 'siteUsersDBFinance' },
    RELEASE_A, 'job-b', '2026-08-10T12:00:00.000Z',
  );
  assert.equal(a.siteCode, b.siteCode);
  assert.notEqual(a.siteDbRoot, b.siteDbRoot);
  assert.notEqual(a.usersDbRoot, b.usersDbRoot);
  assert.notEqual(a.targetDistPath, b.targetDistPath);
  assert.notEqual(a.finalAppUrl, b.finalAppUrl);
});

test('an invalid target identity is rejected instead of silently defaulted', () => {
  assert.throws(() => buildSiteRuntime({ host: '', siteCode: 'alpha' }, RELEASE_A, 'j', 'now'), SiteIdentityError);
  assert.throws(() => buildSiteRuntime({ host: 'portal.army.idf', siteCode: 'A B' }, RELEASE_A, 'j', 'now'), SiteIdentityError);
  assert.throws(
    () => buildSiteRuntime({ host: 'portal.army.idf', siteCode: 'alpha', siteDbFolder: 'a/b' }, RELEASE_A, 'j', 'now'),
    SiteIdentityError,
  );
});
