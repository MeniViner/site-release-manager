import test from 'node:test';
import assert from 'node:assert/strict';

import { createTxtBackup, BACKUP_OUTCOME } from '../../shared/sharepointProvisioning.js';
import { createSharePointClient } from '../../shared/sharepointClient.js';
import { buildSiteIdentity, buildTxtSeedPlan, requiredFolders, requiredLibraries } from '../../shared/siteRuntime.js';
import { createFakeSharePoint, instantRetry, sha256Hex } from './helpers/fakeSharePoint.js';

const RETRY = { ...instantRetry, maxAttempts: 6, maxElapsedMs: 2000 };
const FIXED_NOW = new Date('2026-08-31T11:09:26.000Z');

function prepareTarget(identity) {
  const farm = createFakeSharePoint();
  farm.state.folders.set(identity.siteRoot, { listItemId: 1 });
  for (const library of requiredLibraries(identity)) farm.addLibrary(library.title, library.rootFolder);
  for (const folder of requiredFolders(identity)) farm.addFolder(folder);
  return farm;
}

function backupOptions(farm, identity) {
  return {
    sourceFiles: buildTxtSeedPlan(identity),
    siteAssetsRoot: identity.siteAssetsRoot,
    host: identity.host,
    libraryRoots: requiredLibraries(identity).map((library) => library.rootFolder),
    sha256: async (bytes) => sha256Hex(bytes),
    retry: RETRY,
    dateNow: () => FIXED_NOW,
  };
}

function backupClient(farm, identity, fetchImpl = farm.fetchImpl) {
  return createSharePointClient({
    webUrl: identity.sharePointSiteUrl,
    fetchImpl,
    getDigest: async () => 'DIGEST,1',
    nowToken: () => 'backup-test',
  });
}

test('an existing TXT target copies exactly the canonical plan and verifies every byte', async () => {
  const identity = buildSiteIdentity({
    host: 'portal.army.idf',
    siteCode: 'schedule',
    siteDbFolder: 'siteDB1',
    usersDbFolder: 'siteUsersDb1',
  });
  const farm = prepareTarget(identity);
  const before = new Map();
  for (const [index, source] of buildTxtSeedPlan(identity).entries()) {
    const content = `real-data-${index}-${source.fileName}`;
    farm.addFile(source.path, content);
    before.set(source.path, content);
  }

  const backup = await createTxtBackup(backupClient(farm, identity), backupOptions(farm, identity));

  assert.equal(backup.outcome, BACKUP_OUTCOME.PASSED);
  assert.match(backup.backupPath, /\/siteAssets\/Backups\/backup-2026-08-31T11-09-26$/);
  assert.equal(backup.copiedFiles.length, 10);
  assert.equal(backup.skippedFiles.length, 0);
  assert.equal(backup.failedFiles.length, 0);
  assert.equal(backup.verificationStatus, 'PASSED');
  assert.ok(backup.totalSizeBytes > 0);
  for (const source of buildTxtSeedPlan(identity)) {
    const sourceText = Buffer.from(farm.state.files.get(source.path).bytes).toString('utf8');
    const copiedText = Buffer.from(farm.state.files.get(`${backup.backupPath}/${source.fileName}`).bytes).toString('utf8');
    assert.equal(sourceText, before.get(source.path), `source mutated: ${source.path}`);
    assert.equal(copiedText, before.get(source.path), `backup mismatch: ${source.fileName}`);
  }
  assert.ok(backup.copiedFiles.some((file) => file.sourcePath === `${identity.usersDbRoot}/widgets_data.txt`));
});

test('widgetsDbTarget=site places widgets_data.txt in the canonical site-assets source', async () => {
  const identity = buildSiteIdentity({
    host: 'portal.army.idf',
    siteCode: 'schedule',
    siteDbFolder: 'siteDBWidgets',
    usersDbFolder: 'siteUsersDbWidgets',
    widgetsDbTarget: 'site',
  });
  const farm = prepareTarget(identity);
  for (const source of buildTxtSeedPlan(identity)) farm.addFile(source.path, source.fileName);

  const backup = await createTxtBackup(backupClient(farm, identity), backupOptions(farm, identity));
  const widgets = backup.copiedFiles.find((file) => file.fileName === 'widgets_data.txt');
  assert.equal(widgets.sourcePath, `${identity.siteAssetsRoot}/widgets_data.txt`);
  assert.equal(widgets.verified, true);
});

test('a missing canonical source is recorded as PARTIAL without changing the readable source', async () => {
  const identity = buildSiteIdentity({
    host: 'portal.army.idf',
    siteCode: 'schedule',
    siteDbFolder: 'siteDBPartial',
    usersDbFolder: 'siteUsersDbPartial',
  });
  const farm = prepareTarget(identity);
  const [onlySource] = buildTxtSeedPlan(identity);
  farm.addFile(onlySource.path, 'preserve-me');

  const backup = await createTxtBackup(backupClient(farm, identity), backupOptions(farm, identity));

  assert.equal(backup.outcome, BACKUP_OUTCOME.PARTIAL);
  assert.equal(backup.copiedFiles.length, 1);
  assert.equal(backup.skippedFiles.length, 9);
  assert.equal(backup.failedFiles.length, 0);
  assert.equal(Buffer.from(farm.state.files.get(onlySource.path).bytes).toString('utf8'), 'preserve-me');
});

test('a genuinely fresh logical target skips without creating an empty backup folder', async () => {
  const identity = buildSiteIdentity({
    host: 'portal.army.idf',
    siteCode: 'schedule',
    siteDbFolder: 'siteDBFreshBackup',
    usersDbFolder: 'siteUsersDbFreshBackup',
  });
  const farm = prepareTarget(identity);

  const backup = await createTxtBackup(backupClient(farm, identity), backupOptions(farm, identity));

  assert.equal(backup.outcome, BACKUP_OUTCOME.SKIPPED_FRESH_TARGET);
  assert.equal(backup.backupPath, '');
  assert.equal([...farm.state.folders.keys()].some((folder) => folder.includes('/Backups/backup-')), false);
});

test('an existing backup name is never reused or overwritten', async () => {
  const identity = buildSiteIdentity({
    host: 'portal.army.idf',
    siteCode: 'schedule',
    siteDbFolder: 'siteDBUnique',
    usersDbFolder: 'siteUsersDbUnique',
  });
  const farm = prepareTarget(identity);
  for (const source of buildTxtSeedPlan(identity)) farm.addFile(source.path, source.fileName);
  const backupRoot = `${identity.siteAssetsRoot}/Backups`;
  const oldPath = `${backupRoot}/backup-2026-08-31T11-09-26`;
  farm.addFolder(backupRoot);
  farm.addFolder(oldPath);
  farm.addFile(`${oldPath}/users_data.txt`, 'older-backup');

  const backup = await createTxtBackup(backupClient(farm, identity), backupOptions(farm, identity));

  assert.equal(backup.backupPath, `${backupRoot}/backup-2026-08-31T11-09-27`);
  assert.equal(Buffer.from(farm.state.files.get(`${oldPath}/users_data.txt`).bytes).toString('utf8'), 'older-backup');
});

test('one copy failure produces PARTIAL while the remaining files and all sources are preserved', async () => {
  const identity = buildSiteIdentity({
    host: 'portal.army.idf',
    siteCode: 'schedule',
    siteDbFolder: 'siteDBCopyFailure',
    usersDbFolder: 'siteUsersDbCopyFailure',
  });
  const farm = prepareTarget(identity);
  const sourceBodies = new Map();
  for (const source of buildTxtSeedPlan(identity)) {
    const body = `source-${source.fileName}`;
    sourceBodies.set(source.path, body);
    farm.addFile(source.path, body);
  }
  const fetchImpl = async (url, init) => {
    const isFailingBackupUpload = String(url).includes('/Backups/')
      && String(url).includes('theme_data.txt')
      && String(init?.method || 'GET').toUpperCase() === 'POST';
    if (isFailingBackupUpload) {
      return {
        ok: false,
        status: 500,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ error: { message: { value: 'Temporary SharePoint error.' } } }),
      };
    }
    return farm.fetchImpl(url, init);
  };

  const backup = await createTxtBackup(
    backupClient(farm, identity, fetchImpl),
    backupOptions(farm, identity),
  );

  assert.equal(backup.outcome, BACKUP_OUTCOME.PARTIAL);
  assert.equal(backup.copiedFiles.length, 9);
  assert.equal(backup.failedFiles.length, 1);
  assert.equal(backup.failedFiles[0].fileName, 'theme_data.txt');
  for (const [sourcePath, body] of sourceBodies) {
    assert.equal(Buffer.from(farm.state.files.get(sourcePath).bytes).toString('utf8'), body);
  }
});
