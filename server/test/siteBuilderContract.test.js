/**
 * Cross-repository contract tests.
 *
 * Site Builder is authoritative. These tests fail loudly when Release Manager's
 * mirrored contracts drift from the Site Builder implementation that is
 * actually on disk, instead of letting the drift surface as a broken Windows
 * deployment.
 *
 * The Site Builder repository is an optional sibling checkout, so the tests
 * that need it skip (rather than fail) when it is absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateUniversalManifest, MANIFEST_FILE, parseIndexReferencesFromHtml } from '../../shared/universalManifest.js';
import { buildSiteIdentity, buildTxtSeedPlan, TXT_DATA_FILES } from '../../shared/siteRuntime.js';

const SITE_BUILDER_ROOT = process.env.SITE_BUILDER_PATH
  || path.resolve(process.cwd(), '..', '..', 'site-builder');

const hasSiteBuilder = fs.existsSync(path.join(SITE_BUILDER_ROOT, 'package.json'));
const distUniversal = path.join(SITE_BUILDER_ROOT, 'dist-universal');
const hasDistUniversal = fs.existsSync(path.join(distUniversal, MANIFEST_FILE));
const descriptorPath = path.join(SITE_BUILDER_ROOT, 'src', 'config', 'sharepointRuntimeDescriptor.js');
const hasDescriptor = fs.existsSync(descriptorPath);

test('Site Builder sibling repository is discoverable for contract checks', (t) => {
  if (!hasSiteBuilder) {
    t.skip(`Site Builder not found at ${SITE_BUILDER_ROOT}; set SITE_BUILDER_PATH to enable contract tests.`);
    return;
  }
  assert.ok(hasSiteBuilder);
});

test('the real dist-universal manifest satisfies the Release Manager contract', (t) => {
  if (!hasDistUniversal) {
    t.skip('site-builder/dist-universal is not present.');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(distUniversal, MANIFEST_FILE), 'utf8'));
  const report = validateUniversalManifest(manifest);
  assert.deepEqual(report.errors, [], `manifest rejected: ${report.errors.join(' | ')}`);
  assert.equal(report.ok, true);
  assert.equal(report.info.buildMode, 'universal');
  assert.equal(report.info.requiresRuntimeConfig, true);
  assert.equal(report.info.entryPoint, 'index.html');
  assert.equal(report.info.commitFile, 'index.html');
  assert.ok(report.info.buildId);
});

test('every manifest file exists on disk with the declared size', (t) => {
  if (!hasDistUniversal) {
    t.skip('site-builder/dist-universal is not present.');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(distUniversal, MANIFEST_FILE), 'utf8'));
  for (const entry of manifest.files) {
    const full = path.join(distUniversal, ...entry.path.split('/'));
    assert.ok(fs.existsSync(full), `manifest lists a missing file: ${entry.path}`);
    assert.equal(fs.statSync(full).size, entry.size, `size mismatch for ${entry.path}`);
  }
});

test('index.html references resolve inside the manifest', (t) => {
  if (!hasDistUniversal) {
    t.skip('site-builder/dist-universal is not present.');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(distUniversal, MANIFEST_FILE), 'utf8'));
  const html = fs.readFileSync(path.join(distUniversal, 'index.html'), 'utf8');
  const declared = new Set(manifest.files.map((entry) => entry.path));
  for (const reference of parseIndexReferencesFromHtml(html)) {
    assert.ok(declared.has(reference), `index.html references ${reference}, which is not in the manifest`);
  }
});

test('Release Manager TXT file registry matches Site Builder FILE_NAMES', (t) => {
  if (!hasDescriptor) {
    t.skip('Site Builder runtime descriptor is not present.');
    return;
  }
  const source = fs.readFileSync(descriptorPath, 'utf8');
  const block = source.match(/const FILE_NAMES = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(block, 'could not locate FILE_NAMES in the Site Builder descriptor');
  const siteBuilderNames = [...block[1].matchAll(/'([^']+\.txt)'/g)].map((match) => match[1]).sort();
  const releaseManagerNames = TXT_DATA_FILES.map((definition) => definition.fileName).sort();
  assert.deepEqual(
    releaseManagerNames,
    siteBuilderNames,
    'Release Manager TXT seed registry has drifted from Site Builder FILE_NAMES',
  );
});

test('Release Manager runtime config is accepted by the real Site Builder descriptor', async (t) => {
  if (!hasDescriptor) {
    t.skip('Site Builder runtime descriptor is not present.');
    return;
  }
  const { createSharePointRuntimeDescriptor } = await import(pathToFileURL(descriptorPath).href);

  const cases = [
    { host: 'portal.army.idf', siteCode: 'schedule' },
    { host: 'portal.army.idf', siteCode: 'schedule', siteDbFolder: 'siteDBFinance', usersDbFolder: 'siteUsersDBFinance' },
    { host: 'mazi.army.idf', siteCode: 'alphateam', siteDbFolder: 'kashrarDB1', usersDbFolder: 'siteUsersDb', widgetsDbTarget: 'site' },
  ];

  for (const input of cases) {
    const identity = buildSiteIdentity(input);
    // The descriptor throws when any derived value disagrees with its own
    // derivation, so a clean call is proof the two implementations agree.
    const descriptor = createSharePointRuntimeDescriptor(identity);
    assert.equal(descriptor.host, identity.host);
    assert.equal(descriptor.siteCode, identity.siteCode);
    assert.equal(descriptor.siteDbRoot, identity.siteDbRoot);
    assert.equal(descriptor.usersDbRoot, identity.usersDbRoot);
    assert.equal(descriptor.siteAssetsRoot, identity.siteAssetsRoot);
    assert.equal(descriptor.imagesRoot, identity.imagesRoot);
    assert.equal(descriptor.targetDistPath, identity.targetDistPath);
    assert.equal(descriptor.finalAppUrl, identity.finalAppUrl);
    assert.equal(descriptor.widgetsDbTarget, identity.widgetsDbTarget);
    assert.equal(descriptor.bootstrapLibrary, identity.bootstrapLibrary);
    assert.equal(descriptor.bootstrapFolder, identity.bootstrapFolder);
  }
});

test('TXT seed paths match the Site Builder descriptor file paths exactly', async (t) => {
  if (!hasDescriptor) {
    t.skip('Site Builder runtime descriptor is not present.');
    return;
  }
  const { createSharePointRuntimeDescriptor } = await import(pathToFileURL(descriptorPath).href);
  const byKey = {
    masterConfig: 'masterConfigFileServerRelativeUrl',
    users: 'usersFileServerRelativeUrl',
    events: 'eventsFileServerRelativeUrl',
    navigation: 'navigationFileServerRelativeUrl',
    siteContent: 'siteContentFileServerRelativeUrl',
    theme: 'themeFileServerRelativeUrl',
    externalLinks: 'externalLinksFileServerRelativeUrl',
    gantt: 'ganttFileServerRelativeUrl',
    boom: 'boomFileServerRelativeUrl',
    widgets: 'widgetsFileServerRelativeUrl',
  };

  for (const input of [
    { host: 'portal.army.idf', siteCode: 'schedule' },
    { host: 'portal.army.idf', siteCode: 'schedule', widgetsDbTarget: 'site' },
    { host: 'portal.army.idf', siteCode: 'schedule', siteDbFolder: 'siteDBFresh', usersDbFolder: 'siteUsersDBFresh' },
  ]) {
    const identity = buildSiteIdentity(input);
    const descriptor = createSharePointRuntimeDescriptor(identity);
    for (const seed of buildTxtSeedPlan(identity)) {
      assert.equal(
        seed.path,
        descriptor[byKey[seed.key]],
        `TXT path drift for ${seed.key} (widgetsDbTarget=${identity.widgetsDbTarget})`,
      );
    }
  }
});
