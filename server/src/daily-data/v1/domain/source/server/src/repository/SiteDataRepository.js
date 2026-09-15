import { SAFE_WRITE_CONCERN } from '../db/mongo.js';
import {
  BUILDER_GLOBAL_COLLECTIONS,
  BUILDER_GLOBAL_INDEXES,
  BUILDER_PHYSICAL_INDEXES,
  createIndexesFromDefinitions,
} from '../db/indexDefinitions.js';
import { assertSafeCollectionName, sanitizeSiteCollectionName } from '../utils/collectionNames.js';
import { canonicalStringify, deepMergeJson, sha256OfCanonicalJson } from '../utils/canonicalJson.js';
import { badRequest, conflict, notFound, preconditionRequired } from '../utils/errors.js';

const now = () => new Date();
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isJsonObjectOrArray = (value) => Array.isArray(value) || isObject(value);

export function isSuspiciousEmptyOverwrite(data) {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (isObject(data)) return Object.keys(data).length === 0;
  return true;
}

function documentId(scope, entityId) {
  if (scope === 'backups') return `backup:${entityId}`;
  return `${scope}:${entityId}`;
}

function validateDataDocumentInput({ siteId, scope, entityId, data }) {
  if (!String(siteId || '').trim()) throw badRequest('siteId is required');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(scope || ''))) {
    throw badRequest('scope must contain only letters, numbers, "_" or "-"');
  }
  if (!String(entityId || '').trim() || String(entityId).includes('\0')) {
    throw badRequest('entityId is required and cannot contain null bytes');
  }
  if (!isJsonObjectOrArray(data)) {
    throw badRequest('data must be a JSON object or array');
  }
}

function parseExpectedVersion(value) {
  if (value === undefined || value === null || value === '') {
    throw preconditionRequired();
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw badRequest('expectedVersion must be a non-negative integer');
  }
  return numeric;
}

export class SiteDataRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.collectionPrefix = options.collectionPrefix || process.env.SITE_COLLECTION_PREFIX || 'site_';
  }

  sitesCollection() {
    return this.db.collection(BUILDER_GLOBAL_COLLECTIONS.sites);
  }

  revisionsCollection() {
    return this.db.collection(BUILDER_GLOBAL_COLLECTIONS.revisions);
  }

  auditCollection() {
    return this.db.collection(BUILDER_GLOBAL_COLLECTIONS.auditLogs);
  }

  siteCollection(collectionName) {
    return this.db.collection(assertSafeCollectionName(collectionName));
  }

  async initIndexes() {
    const grouped = new Map();
    for (const definition of BUILDER_GLOBAL_INDEXES) {
      grouped.set(definition.collection, [...(grouped.get(definition.collection) || []), definition]);
    }
    await Promise.all(
      [...grouped.entries()].map(([collectionName, definitions]) =>
        createIndexesFromDefinitions(this.db.collection(collectionName), definitions)),
    );
  }

  async listSites() {
    return this.sitesCollection().find({}).sort({ updatedAt: -1 }).toArray();
  }

  async getSite(siteId) {
    const site = await this.sitesCollection().findOne({ siteId });
    if (!site) throw notFound(`Site "${siteId}" was not found`);
    return site;
  }

  async ensureSite({ siteId, siteSlug = '', displayName = '', status = 'active', publicRead = false, actor = 'system' }) {
    const normalizedSiteId = String(siteId || '').trim();
    if (!normalizedSiteId) throw badRequest('siteId is required');

    const existing = await this.sitesCollection().findOne({ siteId: normalizedSiteId });
    if (existing) return existing;

    const createdAt = now();
    const safeNameSource = siteSlug ? `${siteSlug}:${normalizedSiteId}` : normalizedSiteId;
    const safeCollectionName = sanitizeSiteCollectionName(safeNameSource, {
      prefix: this.collectionPrefix,
    });

    const site = {
      siteId: normalizedSiteId,
      siteSlug: String(siteSlug || normalizedSiteId).trim(),
      safeCollectionName,
      displayName: String(displayName || siteSlug || normalizedSiteId).trim(),
      createdAt,
      updatedAt: createdAt,
      status,
      publicRead: Boolean(publicRead),
      schemaVersion: 1,
      createdBy: actor,
      updatedBy: actor,
    };

    await this.sitesCollection().insertOne(site, { writeConcern: SAFE_WRITE_CONCERN });
    await this.ensureSiteCollectionIndexes(safeCollectionName);
    return site;
  }

  async ensureSiteCollectionIndexes(collectionName) {
    await createIndexesFromDefinitions(this.siteCollection(collectionName), BUILDER_PHYSICAL_INDEXES);
  }

  async resolveSiteCollection(siteId, { createIfMissing = false } = {}) {
    const site = createIfMissing
      ? await this.ensureSite({ siteId })
      : await this.getSite(siteId);
    return {
      site,
      collection: this.siteCollection(site.safeCollectionName),
    };
  }

  async touchSite(siteId, actor = 'system') {
    await this.sitesCollection().updateOne(
      { siteId },
      { $set: { updatedAt: now(), updatedBy: actor } },
      { writeConcern: SAFE_WRITE_CONCERN },
    );
  }

  async listDocuments(siteId, scope) {
    const { collection } = await this.resolveSiteCollection(siteId);
    return collection
      .find({ siteId, scope, deletedAt: null })
      .sort({ updatedAt: 1, entityId: 1 })
      .toArray();
  }

  async getDocument(siteId, scope, entityId, { includeDeleted = false } = {}) {
    const { collection } = await this.resolveSiteCollection(siteId);
    const filter = {
      _id: documentId(scope, entityId),
      siteId,
      scope,
      entityId,
    };
    if (!includeDeleted) filter.deletedAt = null;
    const doc = await collection.findOne(filter);
    if (!doc) throw notFound(`Document "${scope}:${entityId}" was not found`);
    return doc;
  }

  async replaceDocument({
    siteId,
    scope,
    entityId,
    data,
    expectedVersion,
    allowEmptyOverwrite = false,
    actor = 'system',
    metadata = {},
    operation = 'replace',
  }) {
    validateDataDocumentInput({ siteId, scope, entityId, data });
    const resolvedExpectedVersion = parseExpectedVersion(expectedVersion);

    if (isSuspiciousEmptyOverwrite(data) && !allowEmptyOverwrite) {
      throw badRequest('Suspicious empty overwrite rejected. Pass allowEmptyOverwrite=true for intentional resets.');
    }

    const { site, collection } = await this.resolveSiteCollection(siteId, { createIfMissing: true });
    const _id = documentId(scope, entityId);
    const existing = await collection.findOne({ _id, siteId, scope, entityId, deletedAt: null });
    const deletedExisting = existing ? null : await collection.findOne({ _id, siteId, scope, entityId });
    const createdAt = now();
    const hash = sha256OfCanonicalJson(data);

    if (!existing) {
      if (deletedExisting?.deletedAt) {
        if (resolvedExpectedVersion !== 0) {
          await this.writeAuditLog({
            siteId,
            documentKey: _id,
            scope,
            entityId,
            operation,
            result: 'conflict',
            actor,
            metadata: {
              expectedVersion: resolvedExpectedVersion,
              actualVersion: deletedExisting.version,
              reason: 'deleted-document',
              ...metadata,
            },
          });
          throw conflict('Version conflict: document is deleted', {
            expectedVersion: resolvedExpectedVersion,
            actualVersion: deletedExisting.version,
          });
        }

        const nextVersion = deletedExisting.version + 1;
        await this.writeRevision({
          siteId,
          collectionName: site.safeCollectionName,
          documentKey: _id,
          previousData: null,
          nextData: data,
          previousVersion: deletedExisting.version,
          nextVersion,
          operation,
          actor,
        });

        const updateResult = await collection.updateOne(
          { _id, siteId, scope, entityId, version: deletedExisting.version },
          {
            $set: {
              data,
              version: nextVersion,
              hash,
              deletedAt: null,
              updatedAt: createdAt,
              updatedBy: actor,
              metadata,
            },
          },
          { writeConcern: SAFE_WRITE_CONCERN },
        );

        if (updateResult.matchedCount !== 1) {
          await this.writeAuditLog({
            siteId,
            documentKey: _id,
            scope,
            entityId,
            operation,
            result: 'conflict',
            actor,
            metadata: { expectedVersion: 0, reason: 'race-after-deleted-revision', ...metadata },
          });
          throw conflict('Version conflict');
        }

        await this.touchSite(siteId, actor);
        await this.writeAuditLog({
          siteId,
          documentKey: _id,
          scope,
          entityId,
          operation,
          result: 'ok',
          actor,
          metadata: { resurrectedDeletedDocument: true, ...metadata },
        });
        return {
          ...deletedExisting,
          data,
          version: nextVersion,
          hash,
          deletedAt: null,
          updatedAt: createdAt,
          updatedBy: actor,
          metadata,
        };
      }

      if (resolvedExpectedVersion !== 0) {
        await this.writeAuditLog({
          siteId,
          documentKey: _id,
          scope,
          entityId,
          operation,
          result: 'conflict',
          actor,
          metadata: { expectedVersion: resolvedExpectedVersion, reason: 'missing-document', ...metadata },
        });
        throw conflict('Version conflict: document does not exist', { expectedVersion: resolvedExpectedVersion });
      }

      const doc = {
        _id,
        siteId,
        scope,
        entityId,
        data,
        schemaVersion: 1,
        version: 1,
        hash,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
        createdBy: actor,
        updatedBy: actor,
        metadata,
      };

      await this.writeRevision({
        siteId,
        collectionName: site.safeCollectionName,
        documentKey: _id,
        previousData: null,
        nextData: data,
        previousVersion: 0,
        nextVersion: 1,
        operation: 'create',
        actor,
      });
      await collection.insertOne(doc, { writeConcern: SAFE_WRITE_CONCERN });
      await this.touchSite(siteId, actor);
      await this.writeAuditLog({ siteId, documentKey: _id, scope, entityId, operation: 'create', result: 'ok', actor, metadata });
      return doc;
    }

    if (existing.version !== resolvedExpectedVersion) {
      await this.writeAuditLog({
        siteId,
        documentKey: _id,
        scope,
        entityId,
        operation,
        result: 'conflict',
        actor,
        metadata: { expectedVersion: resolvedExpectedVersion, actualVersion: existing.version, ...metadata },
      });
      throw conflict('Version conflict', { expectedVersion: resolvedExpectedVersion, actualVersion: existing.version });
    }

    const nextVersion = existing.version + 1;
    const updatedAt = now();
    await this.writeRevision({
      siteId,
      collectionName: site.safeCollectionName,
      documentKey: _id,
      previousData: existing.data,
      nextData: data,
      previousVersion: existing.version,
      nextVersion,
      operation,
      actor,
    });

    const updateResult = await collection.updateOne(
      { _id, siteId, scope, entityId, version: resolvedExpectedVersion, deletedAt: null },
      {
        $set: {
          data,
          version: nextVersion,
          hash,
          deletedAt: null,
          updatedAt,
          updatedBy: actor,
          metadata,
        },
      },
      { writeConcern: SAFE_WRITE_CONCERN },
    );

    if (updateResult.matchedCount !== 1) {
      await this.writeAuditLog({
        siteId,
        documentKey: _id,
        scope,
        entityId,
        operation,
        result: 'conflict',
        actor,
        metadata: { expectedVersion: resolvedExpectedVersion, reason: 'race-after-revision', ...metadata },
      });
      throw conflict('Version conflict');
    }

    await this.touchSite(siteId, actor);
    await this.writeAuditLog({ siteId, documentKey: _id, scope, entityId, operation, result: 'ok', actor, metadata });
    return {
      ...existing,
      data,
      version: nextVersion,
      hash,
      deletedAt: null,
      updatedAt,
      updatedBy: actor,
      metadata,
    };
  }

  async patchDocument({
    siteId,
    scope,
    entityId,
    patch,
    expectedVersion,
    allowEmptyOverwrite = false,
    actor = 'system',
    metadata = {},
  }) {
    const resolvedExpectedVersion = parseExpectedVersion(expectedVersion);
    const current = await this.getDocument(siteId, scope, entityId);
    const nextData = isObject(current.data) && isObject(patch)
      ? deepMergeJson(current.data, patch)
      : patch;

    return this.replaceDocument({
      siteId,
      scope,
      entityId,
      data: nextData,
      expectedVersion: resolvedExpectedVersion,
      allowEmptyOverwrite,
      actor,
      metadata,
      operation: 'patch',
    });
  }

  async softDeleteDocument({ siteId, scope, entityId, expectedVersion, actor = 'system', metadata = {} }) {
    const resolvedExpectedVersion = parseExpectedVersion(expectedVersion);
    const { site, collection } = await this.resolveSiteCollection(siteId, { createIfMissing: true });
    const _id = documentId(scope, entityId);
    const existing = await collection.findOne({ _id, siteId, scope, entityId, deletedAt: null });
    if (!existing) throw notFound(`Document "${scope}:${entityId}" was not found`);
    if (existing.version !== resolvedExpectedVersion) {
      throw conflict('Version conflict', { expectedVersion: resolvedExpectedVersion, actualVersion: existing.version });
    }

    const nextVersion = existing.version + 1;
    const deletedAt = now();
    await this.writeRevision({
      siteId,
      collectionName: site.safeCollectionName,
      documentKey: _id,
      previousData: existing.data,
      nextData: null,
      previousVersion: existing.version,
      nextVersion,
      operation: 'delete',
      actor,
    });

    const updateResult = await collection.updateOne(
      { _id, siteId, scope, entityId, version: resolvedExpectedVersion, deletedAt: null },
      {
        $set: {
          version: nextVersion,
          deletedAt,
          updatedAt: deletedAt,
          updatedBy: actor,
        },
      },
      { writeConcern: SAFE_WRITE_CONCERN },
    );

    if (updateResult.matchedCount !== 1) {
      throw conflict('Version conflict');
    }

    await this.touchSite(siteId, actor);
    await this.writeAuditLog({ siteId, documentKey: _id, scope, entityId, operation: 'delete', result: 'ok', actor, metadata });
    return {
      ...existing,
      version: nextVersion,
      deletedAt,
      updatedAt: deletedAt,
      updatedBy: actor,
    };
  }

  async batchRead(siteId, items) {
    const results = [];
    for (const item of items) {
      try {
        const doc = await this.getDocument(siteId, item.scope, item.entityId);
        results.push({ ...item, ok: true, document: doc });
      } catch (error) {
        results.push({ ...item, ok: false, error: error.code || 'read_failed', message: error.message });
      }
    }
    return results;
  }

  async batchWrite(siteId, operations, actor = 'system') {
    const results = [];
    for (const operation of operations) {
      try {
        let document;
        if (operation.op === 'put') {
          document = await this.replaceDocument({ siteId, actor, ...operation });
        } else if (operation.op === 'patch') {
          document = await this.patchDocument({ siteId, actor, ...operation, patch: operation.patch ?? operation.data });
        } else {
          document = await this.softDeleteDocument({ siteId, actor, ...operation });
        }
        results.push({ ok: true, op: operation.op, scope: operation.scope, entityId: operation.entityId, document });
      } catch (error) {
        results.push({
          ok: false,
          op: operation.op,
          scope: operation.scope,
          entityId: operation.entityId,
          error: error.code || 'write_failed',
          message: error.message,
        });
      }
    }
    return results;
  }

  async writeRevision({
    siteId,
    collectionName,
    documentKey,
    previousData,
    nextData,
    previousVersion,
    nextVersion,
    operation,
    actor,
  }) {
    await this.revisionsCollection().insertOne(
      {
        siteId,
        collectionName,
        documentKey,
        previousData,
        nextData,
        previousVersion,
        nextVersion,
        operation,
        createdAt: now(),
        actor,
        previousHash: previousData === null ? null : sha256OfCanonicalJson(previousData),
        nextHash: nextData === null ? null : sha256OfCanonicalJson(nextData),
      },
      { writeConcern: SAFE_WRITE_CONCERN },
    );
  }

  async writeAuditLog({
    siteId,
    documentKey,
    scope,
    entityId,
    operation,
    result,
    actor = 'system',
    ip = '',
    userAgent = '',
    metadata = {},
  }) {
    await this.auditCollection().insertOne(
      {
        siteId,
        documentKey,
        scope,
        entityId,
        operation,
        result,
        actor,
        ip,
        userAgent,
        createdAt: now(),
        metadata: {
          ...metadata,
          metadataHash: sha256OfCanonicalJson(metadata || {}),
          metadataBytes: canonicalStringify(metadata || {}).length,
        },
      },
      { writeConcern: SAFE_WRITE_CONCERN },
    );
  }
}

export default SiteDataRepository;
