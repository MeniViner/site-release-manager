import { buildCanonicalLegacySeedEntries } from '../../../src/config/siteSeedDefaults.js';

const isNotFound = (error) => error?.statusCode === 404 || error?.code === 'not_found';

function toProvisionItem(entry, snapshot = null) {
  const version = Number(snapshot?.version);
  return {
    key: entry.key,
    fileName: entry.fileName,
    label: entry.label,
    exists: Boolean(snapshot && snapshot.missing !== true),
    missing: !snapshot || snapshot.missing === true,
    version: Number.isInteger(version) && version >= 0 ? version : 0,
  };
}

export async function inspectSiteProvisioning({ siteId, repository, legacyRepository, today = new Date() }) {
  const seedEntries = buildCanonicalLegacySeedEntries({ today });
  let site = null;

  try {
    site = await repository.getSite(siteId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  if (!site) {
    const items = seedEntries.map((entry) => toProvisionItem(entry));
    return {
      site: null,
      siteExists: false,
      provisioned: false,
      totalDefaults: items.length,
      existingDefaults: 0,
      missingDefaults: items.length,
      items,
    };
  }

  const snapshots = await Promise.all(
    seedEntries.map((entry) => legacyRepository.readLegacyObject(siteId, entry.fileName, { allowMissing: true })),
  );
  const items = seedEntries.map((entry, index) => toProvisionItem(entry, snapshots[index]));
  const missingDefaults = items.filter((item) => item.missing).length;

  return {
    site,
    siteExists: true,
    provisioned: missingDefaults === 0,
    totalDefaults: items.length,
    existingDefaults: items.length - missingDefaults,
    missingDefaults,
    items,
  };
}

export async function provisionSiteDefaults({
  siteId,
  repository,
  legacyRepository,
  actor = 'api',
  siteSlug,
  displayName,
  status,
  publicRead,
  today = new Date(),
} = {}) {
  await repository.initIndexes();
  const before = await inspectSiteProvisioning({ siteId, repository, legacyRepository, today });
  const site = await repository.ensureSite({
    siteId,
    siteSlug,
    displayName,
    ...(status ? { status } : {}),
    ...(publicRead !== undefined ? { publicRead } : {}),
    actor,
  });

  const created = [];
  const skipped = [];
  const seedEntries = buildCanonicalLegacySeedEntries({ today });

  for (const entry of seedEntries) {
    const existing = before.items.find((item) => item.fileName === entry.fileName);
    if (existing && !existing.missing) {
      skipped.push(entry.fileName);
      continue;
    }
    await legacyRepository.writeLegacyObject({
      siteId,
      key: entry.fileName,
      data: entry.data,
      expectedVersion: 0,
      allowEmptyOverwrite: false,
      actor,
      metadata: {
        provisioning: 'canonical-defaults',
        seedKey: entry.key,
      },
    });
    created.push(entry.fileName);
  }

  const provisionStatus = await inspectSiteProvisioning({ siteId, repository, legacyRepository, today });
  return {
    site,
    siteCreated: before.siteExists === false,
    createdCount: created.length,
    skippedCount: skipped.length,
    created,
    skipped,
    provisionStatus,
  };
}
