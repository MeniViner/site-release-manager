import { cloneJson, sha256OfCanonicalJson } from '../utils/canonicalJson.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import {
  describeLegacyMapping,
  getLegacyListMetaEntityId,
  getLegacyMapping,
  getLegacyMetaEntityId,
  normalizeLegacyKey,
} from './legacyMappings.js';
import { isSuspiciousEmptyOverwrite } from './SiteDataRepository.js';

const LEGACY_META_SCOPE = 'legacyMeta';
const UNKNOWN_LEGACY_SCOPE = 'legacy';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function readItemId(item, itemIdField, index) {
  const candidate = isObject(item) ? item[itemIdField] : null;
  const value = String(candidate ?? '').trim();
  return value || `legacy_item_${index + 1}`;
}

function sortDocsByOrder(docs, order = []) {
  const orderIndex = new Map(order.map((id, index) => [String(id), index]));
  return [...docs].sort((a, b) => {
    const aIndex = orderIndex.has(String(a.entityId)) ? orderIndex.get(String(a.entityId)) : Number.MAX_SAFE_INTEGER;
    const bIndex = orderIndex.has(String(b.entityId)) ? orderIndex.get(String(b.entityId)) : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return String(a.entityId).localeCompare(String(b.entityId));
  });
}

export class LegacyCompatibilityRepository {
  constructor(siteDataRepository) {
    this.repository = siteDataRepository;
  }

  async readLegacyObject(siteId, key, { allowMissing = false } = {}) {
    const normalizedKey = normalizeLegacyKey(key);
    const mapping = getLegacyMapping(normalizedKey);
    const snapshot = await this.readLegacySnapshot(siteId, normalizedKey, mapping, { allowMissing });

    if (!snapshot.exists) {
      if (!allowMissing) throw notFound(`Legacy object "${normalizedKey}" was not found`);
      return {
        key: normalizedKey,
        mapping,
        data: null,
        version: 0,
        hash: null,
        documents: [],
        missing: true,
      };
    }

    return {
      key: normalizedKey,
      mapping,
      data: snapshot.data,
      version: snapshot.version,
      hash: snapshot.hash,
      documents: snapshot.documents,
      missing: false,
    };
  }

  async writeLegacyObject({
    siteId,
    key,
    data,
    expectedVersion,
    allowEmptyOverwrite = false,
    actor = 'system',
    metadata = {},
  }) {
    const normalizedKey = normalizeLegacyKey(key);
    if (!normalizedKey) throw badRequest('Legacy key is required');
    if (isSuspiciousEmptyOverwrite(data) && !allowEmptyOverwrite) {
      throw badRequest('Suspicious empty overwrite rejected. Pass allowEmptyOverwrite=true for intentional resets.');
    }

    const mapping = getLegacyMapping(normalizedKey);
    const current = await this.readLegacySnapshot(siteId, normalizedKey, mapping, { allowMissing: true });
    const expected = expectedVersion === undefined || expectedVersion === null ? 0 : Number(expectedVersion);

    if (current.version !== expected) {
      throw conflict('Legacy object version conflict', {
        key: normalizedKey,
        expectedVersion: expected,
        actualVersion: current.version,
      });
    }

    let documents;
    if (mapping.unknown || mapping.mode === 'singleton') {
      documents = [await this.writeSingleton(
        siteId,
        mapping,
        data,
        allowEmptyOverwrite,
        actor,
        metadata,
        current.dataDocuments[0] || null,
      )];
    } else {
      documents = await this.writeList(
        siteId,
        normalizedKey,
        mapping,
        data,
        allowEmptyOverwrite,
        actor,
        metadata,
        {
          currentDocs: current.dataDocuments,
          currentMeta: current.listMeta || null,
        },
      );
    }

    const manifestData = {
      key: normalizedKey,
      mappingKey: mapping.key,
      fileName: mapping.fileName,
      mode: mapping.mode,
      normalizedAs: describeLegacyMapping(mapping),
      hash: sha256OfCanonicalJson(data),
      documentKeys: documents.map((doc) => doc._id),
    };

    const nextManifest = await this.writeManifestDocument({
      siteId,
      normalizedKey,
      data: manifestData,
      currentManifest: current.manifest,
      desiredVersion: current.version + 1,
      actor,
      metadata: { legacyKey: normalizedKey, ...metadata },
    });

    return {
      key: normalizedKey,
      mapping,
      data,
      version: nextManifest.version,
      hash: sha256OfCanonicalJson(data),
      documents: [...documents, nextManifest],
      missing: false,
    };
  }

  async writeSingleton(siteId, mapping, data, allowEmptyOverwrite, actor, metadata, currentDoc = null) {
    const scope = mapping.unknown ? UNKNOWN_LEGACY_SCOPE : mapping.scope;
    const entityId = mapping.unknown ? mapping.entityId : mapping.entityId;
    return this.repository.replaceDocument({
      siteId,
      scope,
      entityId,
      data,
      expectedVersion: currentDoc?.version ?? 0,
      allowEmptyOverwrite,
      actor,
      metadata: { legacyFileName: mapping.fileName, ...metadata },
      operation: 'legacy-write',
    });
  }

  async writeList(siteId, normalizedKey, mapping, data, allowEmptyOverwrite, actor, metadata, current = {}) {
    const list = mapping.mode === 'list-with-settings'
      ? (Array.isArray(data?.[mapping.listProperty]) ? data[mapping.listProperty] : [])
      : (Array.isArray(data) ? data : []);

    if (!Array.isArray(list)) {
      throw badRequest(`Legacy mapping ${mapping.fileName} expects an array`);
    }

    const currentDocs = Array.isArray(current.currentDocs) ? current.currentDocs : [];
    const currentByEntityId = new Map(
      currentDocs
        .map((doc) => [String(doc.entityId), doc]),
    );

    const nextIds = list.map((item, index) => readItemId(item, mapping.itemIdField, index));
    const nextIdSet = new Set(nextIds);
    const written = [];

    for (let index = 0; index < list.length; index += 1) {
      const entityId = nextIds[index];
      const existing = currentByEntityId.get(entityId);
      const doc = await this.repository.replaceDocument({
        siteId,
        scope: mapping.scope,
        entityId,
        data: cloneJson(list[index]),
        expectedVersion: existing?.version ?? 0,
        allowEmptyOverwrite,
        actor,
        metadata: { legacyKey: normalizedKey, legacyFileName: mapping.fileName, ...metadata },
        operation: 'legacy-write',
      });
      written.push(doc);
    }

    for (const doc of currentDocs) {
      if (String(doc.entityId).startsWith('__legacy_meta_')) continue;
      if (!nextIdSet.has(String(doc.entityId))) {
        const deleted = await this.repository.softDeleteDocument({
          siteId,
          scope: mapping.scope,
          entityId: doc.entityId,
          expectedVersion: doc.version,
          actor,
          metadata: { legacyKey: normalizedKey, legacyFileName: mapping.fileName, ...metadata },
        });
        written.push(deleted);
      }
    }

    const metaEntityId = getLegacyListMetaEntityId(normalizedKey);
    const existingMeta = current.currentMeta || null;
    const settings = mapping.mode === 'list-with-settings'
      ? Object.entries(data || {}).reduce((acc, [key, value]) => {
          if (key !== mapping.listProperty) acc[key] = value;
          return acc;
        }, {})
      : {};

    const metaDoc = await this.repository.replaceDocument({
      siteId,
      scope: mapping.scope,
      entityId: metaEntityId,
      data: {
        key: normalizedKey,
        order: nextIds,
        settings,
      },
      expectedVersion: existingMeta?.version ?? 0,
      allowEmptyOverwrite: true,
      actor,
      metadata: { legacyKey: normalizedKey, legacyFileName: mapping.fileName, ...metadata },
      operation: 'legacy-meta-write',
    });

    return [...written, metaDoc];
  }

  async writeManifestDocument({
    siteId,
    normalizedKey,
    data,
    currentManifest = null,
    desiredVersion,
    actor,
    metadata,
  }) {
    const entityId = getLegacyMetaEntityId(normalizedKey);
    if (currentManifest) {
      return this.repository.replaceDocument({
        siteId,
        scope: LEGACY_META_SCOPE,
        entityId,
        data,
        expectedVersion: currentManifest.version,
        allowEmptyOverwrite: true,
        actor,
        metadata,
        operation: 'legacy-write',
      });
    }

    let manifest = await this.repository.replaceDocument({
      siteId,
      scope: LEGACY_META_SCOPE,
      entityId,
      data,
      expectedVersion: 0,
      allowEmptyOverwrite: true,
      actor,
      metadata: {
        ...metadata,
        adoptedLegacyVersion: Math.max(0, Number(desiredVersion || 1) - 1),
      },
      operation: 'legacy-manifest-adopt',
    });

    while (manifest.version < desiredVersion) {
      manifest = await this.repository.replaceDocument({
        siteId,
        scope: LEGACY_META_SCOPE,
        entityId,
        data,
        expectedVersion: manifest.version,
        allowEmptyOverwrite: true,
        actor,
        metadata,
        operation: 'legacy-write',
      });
    }

    return manifest;
  }

  async readLegacySnapshot(siteId, normalizedKey, mapping, { allowMissing = false } = {}) {
    const missing = () => ({
      exists: false,
      data: null,
      version: 0,
      hash: null,
      documents: [],
      dataDocuments: [],
      listMeta: null,
      manifest: null,
    });

    const manifest = await this.readManifestIfExists(siteId, normalizedKey);

    if (mapping.unknown || mapping.mode === 'singleton') {
      const scope = mapping.unknown ? UNKNOWN_LEGACY_SCOPE : mapping.scope;
      const entityId = mapping.unknown ? mapping.entityId : mapping.entityId;
      const doc = await this.readDocIfExists(siteId, scope, entityId);
      if (!doc) {
        if (allowMissing) return missing();
        throw notFound(`Legacy object "${normalizedKey}" was not found`);
      }
      const data = doc.data;
      return {
        exists: true,
        data,
        version: manifest?.version ?? doc.version,
        hash: sha256OfCanonicalJson(data),
        documents: [doc, manifest].filter(Boolean),
        dataDocuments: [doc],
        listMeta: null,
        manifest,
      };
    }

    const allDocs = await this.repository.listDocuments(siteId, mapping.scope);
    const docs = allDocs.filter((doc) => !String(doc.entityId).startsWith('__legacy_meta_'));
    const meta = allDocs.find((doc) => doc.entityId === getLegacyListMetaEntityId(normalizedKey))
      || await this.readListMetaIfExists(siteId, normalizedKey);
    if (!manifest && !meta && docs.length === 0) {
      if (allowMissing) return missing();
      throw notFound(`Legacy object "${normalizedKey}" was not found`);
    }
    const orderedData = sortDocsByOrder(docs, meta?.data?.order || []).map((doc) => doc.data);

    const data = mapping.mode === 'list-with-settings'
      ? {
          ...(isObject(meta?.data?.settings) ? meta.data.settings : {}),
          [mapping.listProperty]: orderedData,
        }
      : orderedData;

    return {
      exists: true,
      data,
      version: manifest?.version ?? meta?.version ?? Math.max(0, ...docs.map((doc) => doc.version || 0)),
      hash: sha256OfCanonicalJson(data),
      documents: [...docs, meta, manifest].filter(Boolean),
      dataDocuments: docs,
      listMeta: meta || null,
      manifest,
    };
  }

  async readManifestIfExists(siteId, key) {
    return this.readDocIfExists(siteId, LEGACY_META_SCOPE, getLegacyMetaEntityId(key));
  }

  async readListMetaIfExists(siteId, key) {
    const mapping = getLegacyMapping(key);
    if (mapping.mode !== 'list' && mapping.mode !== 'list-with-settings') return null;
    return this.readDocIfExists(siteId, mapping.scope, getLegacyListMetaEntityId(key));
  }

  async readDocIfExists(siteId, scope, entityId) {
    try {
      return await this.repository.getDocument(siteId, scope, entityId);
    } catch (error) {
      if (error.statusCode === 404 || error.code === 'not_found') return null;
      throw error;
    }
  }
}

export default LegacyCompatibilityRepository;
