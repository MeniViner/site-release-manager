/**
 * Per-target runtime overlay.
 *
 * Uses node:test to match the rest of the suite (the project has no vitest
 * dependency, so the previous vitest-based version could never run).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteRuntime } from '../src/services/deploymentService.js';
import { SiteIdentityError } from '../../shared/siteRuntime.js';

const RELEASE_A = { _id: 'release-a', version: '1.2.3' };
const RELEASE_B = { _id: 'release-b', version: '2.0.0' };

test('uses the standard TXT SharePoint folders by default', () => {
  const runtime = buildSiteRuntime(
    { host: 'portal.army.idf', siteCode: 'alpha' },
    RELEASE_A, 'job-a', '2026-08-10T12:00:00.000Z',
  );
  assert.equal(runtime.siteDbRoot, '/sites/alpha/siteDB');
  assert.equal(runtime.usersDbRoot, '/sites/alpha/siteUsersDb');
  assert.equal(runtime.siteAssetsRoot, '/sites/alpha/siteDB/siteAssets');
  assert.equal(runtime.imagesRoot, '/sites/alpha/siteDB/images');
  assert.equal(runtime.targetDistPath, '/sites/alpha/siteDB/dist');
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
  // The two data libraries must never collapse onto one.
  assert.throws(
    () => buildSiteRuntime({ host: 'portal.army.idf', siteCode: 'alpha', siteDbFolder: 'shared', usersDbFolder: 'shared' }, RELEASE_A, 'j', 'now'),
    SiteIdentityError,
  );
});
