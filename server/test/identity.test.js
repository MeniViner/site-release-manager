const test = require('node:test');
const assert = require('node:assert/strict');
const { createSharePointAccessResolver, hasRole } = require('../src/daily-data/v1/identity.js');

function request(siteIds) {
  return { get: (name) => name === 'x-iisnode-sharepoint-sites' ? siteIds : '' };
}

test('trusted SharePoint access grants only the matching site baseline capabilities', () => {
  const resolver = createSharePointAccessResolver({ enabled: true, headerName: 'x-iisnode-sharepoint-sites' });
  const site = {
    builderSiteId: 'srm-alpha',
    dataAccess: { viewers: [], submitters: [], editors: [], administrators: [], sharePointReadAccess: true, sharePointInteractionAccess: true },
  };
  assert.equal(resolver.allows(request('srm-alpha'), site, 'viewers'), true);
  assert.equal(resolver.allows(request('srm-alpha'), site, 'submitters'), true);
  assert.equal(resolver.allows(request('srm-bravo'), site, 'viewers'), false);
  assert.equal(resolver.allows(request('srm-alpha'), { ...site, builderSiteId: 'srm-bravo' }, 'viewers'), false);
});

test('baseline SharePoint access never escalates to editor or administrator', () => {
  const site = {
    builderSiteId: 'srm-alpha',
    dataAccess: { viewers: [], submitters: [], editors: [], administrators: [], sharePointReadAccess: true, sharePointInteractionAccess: true },
  };
  const req = request('srm-alpha');
  assert.equal(hasRole(site, 'ordinary-user', 'editors', req), false);
  assert.equal(hasRole(site, 'ordinary-user', 'administrators', req), false);
});
