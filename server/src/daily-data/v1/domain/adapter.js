import { SiteDataRepository } from './source/server/src/repository/SiteDataRepository.js';
import { LegacyCompatibilityRepository } from './source/server/src/repository/LegacyCompatibilityRepository.js';
import { SiteBackupRepository } from './source/server/src/repository/SiteBackupRepository.js';
import { inspectSiteProvisioning, provisionSiteDefaults } from './source/server/src/provisioning/siteProvisioning.js';
import * as schemas from './source/server/src/validation/schemas.js';

export async function createDailyDataDomain({ db, collectionPrefix }) {
  const repository = new SiteDataRepository(db, { collectionPrefix });
  const legacyRepository = new LegacyCompatibilityRepository(repository);
  const backupRepository = new SiteBackupRepository(repository, legacyRepository);
  await repository.initIndexes();
  return Object.freeze({
    repository,
    legacyRepository,
    backupRepository,
    inspectSiteProvisioning: (siteId) => inspectSiteProvisioning({ siteId, repository, legacyRepository }),
    provisionSiteDefaults: (options) => provisionSiteDefaults({
      ...options,
      repository,
      legacyRepository,
    }),
    schemas,
  });
}
