const { getBuilderDataDb } = require('../../db.js');
const { createDailyDataDomain } = require('./domain/domain.js');

let domainPromise;

function getDailyDataDomain() {
  if (!domainPromise) {
    domainPromise = createDailyDataDomain({
      db: getBuilderDataDb(),
      collectionPrefix: 'site_',
    });
  }
  return domainPromise;
}

async function provisionSite(site, actor = 'release-manager') {
  const domain = await getDailyDataDomain();
  const result = await domain.provisionSiteDefaults({
    siteId: site.builderSiteId,
    siteSlug: site.siteCode,
    displayName: site.name,
    actor,
  });
  const status = result.provisionStatus;
  if (!status?.siteExists || !status.provisioned || status.missingDefaults !== 0) {
    throw Object.assign(new Error('Embedded Site Builder provisioning did not create every required default.'), {
      statusCode: 502,
      code: 'DAILY_DATA_PROVISIONING_INCOMPLETE',
    });
  }
  return {
    siteCreated: result.siteCreated,
    createdCount: result.createdCount,
    skippedCount: result.skippedCount,
    provisionStatus: status,
  };
}

module.exports = {
  getDailyDataDomain,
  provisionSite,
};
