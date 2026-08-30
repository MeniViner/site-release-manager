/**
 * Universal artifact ingestion.
 *
 * The two rules being pinned here:
 *  - a PROVEN Universal build is not rejected for SharePoint-looking strings
 *    inside minified bundles;
 *  - an UNPROVEN artifact carrying target identity is rejected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateUniversalArtifact, readUniversalProof, verifyStoredReleaseIntegrity, ReleaseValidationError, findTargetIdentityLeaks } from '../src/services/releaseValidation.js';
import { collectFiles } from '../src/utils/files.js';
import { MANIFEST_FILE, RUNTIME_CONFIG_FILE } from '../../shared/universalManifest.js';

function artifact({ withManifest = true, manifestOverrides = {}, bundleBody = 'console.log("universal")', extraFiles = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-validate-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), bundleBody);
  fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{margin:0}');
  fs.writeFileSync(path.join(root, 'index.html'), '<html><head><link href="./assets/app.css"><script src="./assets/app.js"></script></head><body></body></html>');
  for (const [name, body] of Object.entries(extraFiles)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  if (withManifest) {
    const files = collectFiles(root);
    const baseFiles = files.map(({ path: filePath, size, sha256 }) => ({ path: filePath, size, sha256 }));
    const manifest = {
      kind: 'sitebuilder-release-manifest',
      schemaVersion: 4,
      buildId: 'build-abc',
      buildMode: 'universal',
      artifactKind: 'site-builder-universal-frontend',
      generatedAt: new Date().toISOString(),
      storageCompatibility: ['txt', 'mongo'],
      requiresRuntimeConfig: true,
      preservesRuntimeConfig: true,
      manifestFile: MANIFEST_FILE,
      entryPoint: 'index.html',
      commitFile: 'index.html',
      fileCount: files.length,
      requiredFolders: ['assets'],
      indexReferences: ['assets/app.css', 'assets/app.js'],
      files: baseFiles,
      ...manifestOverrides,
    };
    if (typeof manifestOverrides.files === 'function') manifest.files = manifestOverrides.files(baseFiles);
    if (manifestOverrides.fileCount === undefined) manifest.fileCount = manifest.files.length;
    fs.writeFileSync(path.join(root, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  }
  return root;
}

const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

test('a well-formed Universal artifact is accepted', () => {
  const root = artifact();
  try {
    const result = validateUniversalArtifact(root);
    assert.equal(result.proof.verified, true);
    assert.equal(result.proof.info.buildId, 'build-abc');
    assert.deepEqual(result.warnings, []);
  } finally { cleanup(root); }
});

test('a Legacy artifact with no build manifest is rejected', () => {
  const root = artifact({ withManifest: false });
  try {
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error instanceof ReleaseValidationError);
      assert.ok(error.errors.some((problem) => problem.includes('not present in the artifact')));
      return true;
    });
  } finally { cleanup(root); }
});

test('a manifest that is not a universal build is rejected', () => {
  const root = artifact({ manifestOverrides: { buildMode: 'legacy', artifactKind: 'site-builder-legacy-frontend', requiresRuntimeConfig: false } });
  try {
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error.errors.some((problem) => problem.includes('buildMode must be "universal"')));
      assert.ok(error.errors.some((problem) => problem.includes('requiresRuntimeConfig must be true')));
      return true;
    });
  } finally { cleanup(root); }
});

test('an unsupported manifest schema version is rejected', () => {
  const root = artifact({ manifestOverrides: { schemaVersion: 99 } });
  try {
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error.errors.some((problem) => problem.includes('schemaVersion 99 is not supported')));
      return true;
    });
  } finally { cleanup(root); }
});

test('an empty buildId is rejected', () => {
  const root = artifact({ manifestOverrides: { buildId: '   ' } });
  try {
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error.errors.some((problem) => problem.includes('buildId is missing')));
      return true;
    });
  } finally { cleanup(root); }
});

test('a hash mismatch between the manifest and the files on disk is rejected', () => {
  const root = artifact();
  try {
    // Change a file after the manifest was written.
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("tampered")');
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error.errors.some((problem) => problem.includes('sha256 mismatch for assets/app.js') || problem.includes('size mismatch for assets/app.js')));
      return true;
    });
  } finally { cleanup(root); }
});

test('an index.html reference that is absent from the artifact is rejected', () => {
  const root = artifact();
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<html><script src="./assets/ghost.js"></script></html>');
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error.errors.some((problem) => problem.includes('ghost.js')));
      return true;
    });
  } finally { cleanup(root); }
});

test('an artifact carrying a per-target overlay is rejected', () => {
  const root = artifact({ extraFiles: { [RUNTIME_CONFIG_FILE]: '{"host":"portal.army.idf"}' } });
  try {
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error.errors.some((problem) => problem.includes(RUNTIME_CONFIG_FILE)));
      return true;
    });
  } finally { cleanup(root); }
});

test('compiled-in target identity WITHOUT a valid manifest is rejected', () => {
  const root = artifact({ withManifest: false, bundleBody: 'const base="/sites/alphateam/siteDB/dist";' });
  try {
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error.errors.some((problem) => problem.includes('compiled-in SharePoint target identity')));
      return true;
    });
  } finally { cleanup(root); }
});

test('SharePoint-looking strings in a PROVEN universal bundle are diagnostics, not a rejection', () => {
  // This is the exact false-positive the mission forbids: a legitimate build
  // whose minified JavaScript happens to contain a SharePoint-shaped path.
  const root = artifact({ bundleBody: 'const sample="/sites/alphateam/siteDB/dist";console.log(sample)' });
  try {
    const result = validateUniversalArtifact(root);
    assert.equal(result.proof.verified, true);
    assert.ok(result.identityHits.length > 0);
    assert.equal(result.warnings.length, 1);
    assert.ok(/do not block the release/.test(result.warnings[0]));
  } finally { cleanup(root); }
});

test('a manifest that lists itself is rejected', () => {
  const root = artifact({
    manifestOverrides: { files: (files) => [...files, { path: MANIFEST_FILE, size: 10, sha256: 'a'.repeat(64) }] },
  });
  try {
    assert.throws(() => validateUniversalArtifact(root), (error) => {
      assert.ok(error.errors.some((problem) => problem.includes('can never contain its own hash')));
      return true;
    });
  } finally { cleanup(root); }
});

test('a stored release that changed on disk is detected before deployment', () => {
  const root = artifact();
  try {
    const release = { distDir: root, version: '1.0.0' };
    assert.equal(verifyStoredReleaseIntegrity(release).fileCount > 0, true);
    fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{margin:99px}');
    assert.throws(() => verifyStoredReleaseIntegrity(release), (error) => {
      assert.equal(error.statusCode, 409);
      assert.ok(error.mismatches.length > 0);
      return true;
    });
  } finally { cleanup(root); }
});

test('identity scanning finds absolute and relative target paths', () => {
  const root = artifact({ withManifest: false, bundleBody: 'a="https://portal.army.idf/sites/alphateam/siteDB/dist";' });
  try {
    const hits = findTargetIdentityLeaks(root);
    assert.ok(hits.length > 0);
    assert.ok(hits[0].match.includes('/sites/alphateam/siteDB/dist'));
  } finally { cleanup(root); }
});

test('a corrupt manifest reports why rather than crashing', () => {
  const root = artifact({ withManifest: false });
  try {
    fs.writeFileSync(path.join(root, MANIFEST_FILE), '{ not json');
    const proof = readUniversalProof(root);
    assert.equal(proof.verified, false);
    assert.equal(proof.reason, 'source-manifest-invalid');
  } finally { cleanup(root); }
});
