const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBackendDeploymentPlan,
  buildMongoSharePointPlan,
} = require("../src/services/deploymentProfiles.js");
const { normalizeBackend, releaseSupportsBackend } = require("../src/utils/backendMode.js");

const universalRelease = {
  version: '1.2.3',
  universalProof: { storageCompatibility: ['txt', 'mongo'] },
};

test('backend validation accepts only the two operational modes', () => {
  assert.equal(normalizeBackend('TXT'), 'txt');
  assert.equal(normalizeBackend('mongo'), 'mongo');
  assert.throws(() => normalizeBackend('mixed'), (error) => error.code === 'INVALID_BACKEND');
});

test('old or incompatible releases fail closed for a requested backend', () => {
  assert.equal(releaseSupportsBackend(universalRelease, 'mongo'), true);
  assert.equal(releaseSupportsBackend({ universalProof: {} }, 'txt'), false);
});

test('TXT profile preserves the canonical libraries, folders and ten seeds', () => {
  const plan = buildBackendDeploymentPlan({
    host: 'portal.army.idf',
    siteCode: 'schedule',
    storageBackend: 'txt',
  }, universalRelease, ['assets']);
  assert.equal(plan.libraries.length, 2);
  assert.equal(plan.seedFiles.length, 10);
  assert.equal(plan.permissionsMarker, '/sites/schedule/siteUsersDb/.permissions-setup.json');
  assert.deepEqual(plan.folders, [
    '/sites/schedule/siteDB/siteAssets',
    '/sites/schedule/siteDB/images',
    '/sites/schedule/siteDB/dist',
    '/sites/schedule/siteDB/dist/assets',
  ]);
});

test('Mongo profile cannot emit TXT seeds, users library or permissions marker', () => {
  const site = {
    host: 'portal.army.idf',
    siteCode: 'schedule-mongo',
    storageBackend: 'mongo',
    builderSiteId: 'schedule-rehearsal',
  };
  const plan = buildBackendDeploymentPlan(site, universalRelease, ['assets']);
  assert.equal(plan.identity.siteId, 'schedule-rehearsal');
  assert.deepEqual(plan.seedFiles, []);
  assert.equal(plan.permissionsMarker, null);
  assert.equal(plan.capabilities.txtSeeds, false);
  assert.equal(plan.capabilities.txtBackup, false);
  assert.deepEqual(plan.libraries.map((item) => item.role), ['frontend']);
  assert.ok(plan.folders.every((folder) => !folder.includes('siteUsersDb')));
  assert.deepEqual(buildMongoSharePointPlan(plan.identity).seedFiles, []);
});
