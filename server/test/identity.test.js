const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { accessForCreator, hasRole } = require('../src/daily-data/v1/identity.js');
const { trustedHeaderName } = require('../src/config.js');

const siteWith = (overrides = {}) => ({
  builderSiteId: 'srm-alpha',
  dataAccess: {
    viewers: [], submitters: [], editors: [], administrators: [],
    sharePointReadAccess: true, sharePointInteractionAccess: true,
    ...overrides,
  },
});

// A request carrying a self-asserted site list. Nothing server-side can populate
// this header, so it must never influence a decision.
const spoofingRequest = { get: (name) => (name === 'x-iisnode-sharepoint-sites' ? 'srm-alpha' : '') };

test('a self-asserted site-access header grants nothing', () => {
  const site = siteWith();
  for (const role of ['viewers', 'submitters', 'editors', 'administrators']) {
    assert.equal(
      hasRole(site, 'ordinary-user', role, spoofingRequest), false,
      `a caller-supplied site list must not grant ${role}`,
    );
  }
});

test('explicit dataAccess lists are the grant path, and roles stay distinct', () => {
  const site = siteWith({ viewers: ['reader'], submitters: ['submitter'], editors: ['editor'], administrators: ['owner'] });

  assert.equal(hasRole(site, 'reader', 'viewers'), true);
  assert.equal(hasRole(site, 'reader', 'submitters'), false, 'a viewer cannot submit');
  assert.equal(hasRole(site, 'reader', 'editors'), false, 'a viewer cannot edit');
  assert.equal(hasRole(site, 'reader', 'administrators'), false);

  assert.equal(hasRole(site, 'submitter', 'submitters'), true);
  assert.equal(hasRole(site, 'submitter', 'editors'), false, 'submit does not imply edit');

  assert.equal(hasRole(site, 'editor', 'editors'), true);
  assert.equal(hasRole(site, 'editor', 'administrators'), false, 'edit does not imply admin');
});

test('administrators inherit the lesser roles but nothing inherits upward', () => {
  const site = siteWith({ administrators: ['owner'] });
  for (const role of ['viewers', 'submitters', 'editors', 'administrators']) {
    assert.equal(hasRole(site, 'owner', role), true, `an administrator must satisfy ${role}`);
  }
  assert.equal(hasRole(site, 'nobody', 'viewers'), false);
});

test('the creator is seeded as a full administrator, so no site is ownerless', () => {
  const access = accessForCreator('domain\\owner');
  for (const role of ['viewers', 'submitters', 'editors', 'administrators']) {
    assert.deepEqual(access[role], ['domain\\owner']);
  }
});

test('a principal cannot reach another site\'s grants', () => {
  const alpha = siteWith({ viewers: ['reader'] });
  const bravo = { builderSiteId: 'srm-bravo', dataAccess: { viewers: ['other'], submitters: [], editors: [], administrators: [] } };
  assert.equal(hasRole(alpha, 'reader', 'viewers'), true);
  assert.equal(hasRole(bravo, 'reader', 'viewers'), false, 'access is per site, never global');
});

test('an absent or blank principal never matches a grant', () => {
  const site = siteWith({ viewers: ['reader'] });
  for (const principal of [undefined, null, '', '   ']) {
    assert.equal(hasRole(site, principal, 'viewers'), false);
  }
});

test('legacy SharePoint access flags no longer grant anything on their own', () => {
  const site = siteWith({ sharePointReadAccess: true, sharePointInteractionAccess: true });
  assert.equal(hasRole(site, 'anyone', 'viewers', spoofingRequest), false);
  assert.equal(hasRole(site, 'anyone', 'submitters', spoofingRequest), false);
});

test('the IIS rewrite header uses the canonical hyphenated HTTP name', () => {
  assert.equal(trustedHeaderName('X-IISNode-Auth-User'), 'x-iisnode-auth-user');
  assert.throws(
    () => trustedHeaderName('x-iisnode-auth_user'),
    /maps to hyphens, not underscores/,
  );
});

test('production rejects development identity headers and accepts only the trusted boundary', () => {
  const script = `
    const { trustedIdentityForRequest } = require('./src/daily-data/v1/identity.js');
    const devOnly = { get: (name) => name === 'x-daily-data-dev-user' ? 'spoofed-user' : '' };
    try {
      trustedIdentityForRequest(devOnly);
      process.exit(2);
    } catch (error) {
      if (error.code !== 'trusted_identity_required') throw error;
    }
    const trusted = { get: (name) => name === 'x-iisnode-auth-user' ? 'DOMAIN\\\\Alice' : '' };
    if (trustedIdentityForRequest(trusted) !== 'domain\\\\alice') process.exit(3);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://sitebuilderhub.idf',
      PUBLIC_DAILY_DATA_API_URL: 'https://sitebuilderhub.idf/api/daily-data/v1',
      MONGO_URI: 'mongodb://127.0.0.1:27018',
      MONGO_DB_NAME: 'test-management',
      BUILDER_DATA_MONGO_DB_NAME: 'test-builder',
      TRUSTED_IDENTITY_ENABLED: 'true',
      TRUSTED_IDENTITY_HEADER: 'x-iisnode-auth-user',
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
