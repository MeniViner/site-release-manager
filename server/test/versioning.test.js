import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReleaseVersions, parseReleaseVersion } from '../src/utils/versioning.js';

test('parses semantic release versions', () => {
  assert.deepEqual(parseReleaseVersion('0.2.4'), { major: 0, minor: 2, patch: 4, normalized: '0.2.4' });
  assert.deepEqual(parseReleaseVersion('v1.5.9'), { major: 1, minor: 5, patch: 9, normalized: '1.5.9' });
  assert.equal(parseReleaseVersion('release-1'), null);
});

test('suggests hotfix, minor and major versions', () => {
  assert.deepEqual(nextReleaseVersions('0.2.4'), {
    baseVersion: '0.2.4', hotfix: '0.2.5', minor: '0.3.0', major: '1.0.0', recommended: '0.2.5',
  });
});

test('uses 0.1.0 as the first recommended release', () => {
  assert.equal(nextReleaseVersions('').recommended, '0.1.0');
});
