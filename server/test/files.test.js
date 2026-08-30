import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  distExclusionReason,
  findDistRoot,
  isSafeRelativePath,
  safeResolve,
} from '../src/utils/files.js';

test('accepts regular dist paths', () => {
  assert.equal(isSafeRelativePath('assets/index-123.js'), true);
  assert.equal(distExclusionReason('assets/index-123.js'), '');
});

test('rejects traversal and absolute paths', () => {
  assert.equal(isSafeRelativePath('../secret.txt'), false);
  assert.equal(isSafeRelativePath('/etc/passwd'), false);
  assert.equal(isSafeRelativePath('C:/secret.txt'), false);
});

test('safeResolve stays under the root', () => {
  const root = path.resolve('/tmp/build');
  assert.equal(safeResolve(root, 'assets/app.js'), path.join(root, 'assets', 'app.js'));
  assert.throws(() => safeResolve(root, '../app.js'));
});

test('per-target overlay files are excluded from universal releases', () => {
  assert.ok(distExclusionReason('sitebuilder-runtime-config.json'));
  assert.ok(distExclusionReason('sitebuilder-deployment.json'));
  assert.equal(distExclusionReason('index.html'), '');
});

test('the Site Builder source manifest is preserved, not stripped', () => {
  // sharepoint-deploy-manifest.json is the proof that an artifact is a genuine
  // Universal build. Stripping it at ingest would destroy that provenance, so
  // it must survive into the stored release.
  assert.equal(distExclusionReason('sharepoint-deploy-manifest.json'), '');
});

test('findDistRoot accepts dist directly or one project level above it', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-dist-test-'));
  try {
    const dist = path.join(temp, 'site-builder', 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    assert.equal(findDistRoot(path.join(temp, 'site-builder')), dist);
    assert.equal(findDistRoot(temp), dist);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
