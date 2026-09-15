export const BUILDER_GLOBAL_COLLECTIONS = Object.freeze({
  sites: 'sites',
  revisions: 'site_data_revisions',
  auditLogs: 'site_data_audit_logs',
});

export const BUILDER_GLOBAL_INDEXES = Object.freeze([
  { collection: BUILDER_GLOBAL_COLLECTIONS.sites, key: { siteId: 1 }, options: { unique: true } },
  { collection: BUILDER_GLOBAL_COLLECTIONS.sites, key: { siteSlug: 1 }, options: {} },
  { collection: BUILDER_GLOBAL_COLLECTIONS.sites, key: { safeCollectionName: 1 }, options: { unique: true } },
  { collection: BUILDER_GLOBAL_COLLECTIONS.revisions, key: { siteId: 1, documentKey: 1, createdAt: -1 }, options: {} },
  { collection: BUILDER_GLOBAL_COLLECTIONS.auditLogs, key: { siteId: 1, documentKey: 1, createdAt: -1 }, options: {} },
]);

export const BUILDER_PHYSICAL_INDEXES = Object.freeze([
  { key: { siteId: 1, scope: 1, entityId: 1, deletedAt: 1 }, options: {} },
  { key: { siteId: 1, scope: 1, updatedAt: -1 }, options: {} },
  { key: { hash: 1 }, options: {} },
]);

export const mongoIndexName = (key) =>
  Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_');

export async function createIndexesFromDefinitions(collection, definitions) {
  await Promise.all(definitions.map((definition) => collection.createIndex(definition.key, definition.options)));
}
