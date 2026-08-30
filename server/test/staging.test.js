/**
 * Fresh-staging guarantees.
 *
 * These tests use the real Site Builder dist-universal when it is available, so
 * they exercise the actual artifact shape rather than a hand-made fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createStaging, writeTargetOverlay, regenerateManifest, verifyStaging,
  buildUploadOrder, destroyStaging, REGENERATED_FILES, StagingError,
} from '../src/services/stagingService.js';
import { buildSiteIdentity } from '../../shared/siteRuntime.js';
import { RUNTIME_CONFIG_FILE, DEPLOYMENT_METADATA_FILE, MANIFEST_FILE, validateUniversalManifest } from '../../shared/universalManifest.js';
import { hashDirectory } from '../src/utils/files.js';

const SITE_BUILDER_ROOT = process.env.SITE_BUILDER_PATH || path.resolve(process.cwd(), '..', '..', 'site-builder');
const REAL_DIST = path.join(SITE_BUILDER_ROOT, 'dist-universal');
const hasRealDist = fs.existsSync(path.join(REAL_DIST, 'index.html'));

const RELEASE = { _id: 'release-1', version: '1.4.0', sha256: 'deadbeef' };

/** A small synthetic Universal artifact for the tests that do not need the real one. */
function makeArtifact() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-artifact-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("universal build")');
  fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{margin:0}');
  fs.writeFileSync(path.join(root, 'index.html'), '<html><head><link href="./assets/app.css"><script src="./assets/app.js"></script></head><body></body></html>');
  return root;
}

function stage(sourceDist, site, jobId) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), `srm-staging-${jobId}-`));
  const identity = buildSiteIdentity(site);
  const staging = createStaging({ releaseDistDir: sourceDist, stagingRoot });
  writeTargetOverlay({ distDir: staging.distDir, identity, release: RELEASE, jobId, deployedAt: '2026-08-31T00:00:00.000Z' });
  const manifest = regenerateManifest({ distDir: staging.distDir, release: RELEASE, identity, jobId, sourceProof: { buildId: 'source-build-id', generatedAt: '2026-08-18T10:34:32.820Z', schemaVersion: 4, storageCompatibility: ['txt', 'mongo'] } });
  verifyStaging({ distDir: staging.distDir, manifest });
  return { stagingRoot, distDir: staging.distDir, manifest, identity };
}

test('the stored release artifact is never mutated by a deployment', () => {
  const source = makeArtifact();
  try {
    const before = hashDirectory(source);
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      assert.equal(hashDirectory(source), before, 'the immutable release directory changed during staging');
      assert.equal(fs.existsSync(path.join(source, RUNTIME_CONFIG_FILE)), false);
      assert.equal(fs.existsSync(path.join(source, MANIFEST_FILE)), false);
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('target B never inherits target A runtime identity', () => {
  const source = makeArtifact();
  const jobs = [];
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    jobs.push(a.stagingRoot);
    const b = stage(source, {
      host: 'mazi.army.idf', siteCode: 'finance',
      siteDbFolder: 'siteDBFinance', usersDbFolder: 'siteUsersDBFinance', widgetsDbTarget: 'site',
    }, 'job-b');
    jobs.push(b.stagingRoot);

    const configA = JSON.parse(fs.readFileSync(path.join(a.distDir, RUNTIME_CONFIG_FILE), 'utf8'));
    const configB = JSON.parse(fs.readFileSync(path.join(b.distDir, RUNTIME_CONFIG_FILE), 'utf8'));

    assert.equal(configA.targetDistPath, '/sites/schedule/siteDB/dist');
    assert.equal(configB.targetDistPath, '/sites/finance/siteDBFinance/dist');
    assert.equal(configA.widgetsDbTarget, 'users');
    assert.equal(configB.widgetsDbTarget, 'site');

    // No value from A may appear anywhere in B's staged overlay.
    const bOverlay = [
      fs.readFileSync(path.join(b.distDir, RUNTIME_CONFIG_FILE), 'utf8'),
      fs.readFileSync(path.join(b.distDir, DEPLOYMENT_METADATA_FILE), 'utf8'),
      fs.readFileSync(path.join(b.distDir, MANIFEST_FILE), 'utf8'),
    ].join('\n');
    for (const leak of ['/sites/schedule', 'portal.army.idf', 'job-a']) {
      assert.equal(bOverlay.includes(leak), false, `target B overlay leaked "${leak}" from target A`);
    }

    // The shared application bundle must be byte-identical between targets.
    assert.equal(
      fs.readFileSync(path.join(a.distDir, 'assets', 'app.js'), 'utf8'),
      fs.readFileSync(path.join(b.distDir, 'assets', 'app.js'), 'utf8'),
    );
  } finally {
    for (const root of jobs) destroyStaging(root);
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('a target overlay left in the source artifact is stripped defensively', () => {
  const source = makeArtifact();
  try {
    fs.writeFileSync(path.join(source, RUNTIME_CONFIG_FILE), JSON.stringify({ host: 'contaminated.host', siteCode: 'other' }));
    fs.writeFileSync(path.join(source, DEPLOYMENT_METADATA_FILE), JSON.stringify({ siteCode: 'other' }));
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      const config = JSON.parse(fs.readFileSync(path.join(a.distDir, RUNTIME_CONFIG_FILE), 'utf8'));
      assert.equal(config.host, 'portal.army.idf');
      assert.equal(config.siteCode, 'schedule');
      assert.equal(fs.readFileSync(path.join(a.distDir, RUNTIME_CONFIG_FILE), 'utf8').includes('contaminated.host'), false);
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('the regenerated manifest includes the overlay and commits index.html last', () => {
  const source = makeArtifact();
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      const paths = a.manifest.files.map((file) => file.path);
      assert.ok(paths.includes(RUNTIME_CONFIG_FILE));
      assert.ok(paths.includes(DEPLOYMENT_METADATA_FILE));
      assert.equal(paths.includes(MANIFEST_FILE), false, 'the manifest must not list itself');
      const order = buildUploadOrder(a.manifest);
      assert.equal(order.at(-1), 'index.html');
      assert.equal(order.filter((entry) => entry === 'index.html').length, 1);
      assert.equal(a.manifest.sourceBuild.buildId, 'source-build-id', 'source provenance must be preserved');
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('staging verification catches a tampered staged file', () => {
  const source = makeArtifact();
  try {
    const a = stage(source, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-a');
    try {
      fs.writeFileSync(path.join(a.distDir, 'assets', 'app.js'), 'tampered');
      assert.throws(
        () => verifyStaging({ distDir: a.distDir, manifest: a.manifest }),
        (error) => {
          assert.ok(error instanceof StagingError);
          assert.ok(error.problems.some((problem) => problem.includes('app.js')));
          return true;
        },
      );
    } finally { destroyStaging(a.stagingRoot); }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});

test('every regenerated file name is excluded from the staging copy', () => {
  assert.deepEqual([...REGENERATED_FILES].sort(), [DEPLOYMENT_METADATA_FILE, MANIFEST_FILE, RUNTIME_CONFIG_FILE].sort());
});

test('the real Site Builder dist-universal stages and re-verifies cleanly', (t) => {
  if (!hasRealDist) { t.skip('site-builder/dist-universal is not present.'); return; }
  const a = stage(REAL_DIST, { host: 'portal.army.idf', siteCode: 'schedule' }, 'job-real');
  try {
    const report = validateUniversalManifest(a.manifest, { allowTargetOverlay: true });
    assert.deepEqual(report.errors, [], `regenerated manifest is invalid: ${report.errors.join(' | ')}`);
    assert.ok(a.manifest.files.length > 40);
    assert.ok(a.manifest.indexReferences.length > 0);
    const order = buildUploadOrder(a.manifest);
    assert.equal(order.at(-1), 'index.html');
  } finally { destroyStaging(a.stagingRoot); }
});
