var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/adapter.js
var adapter_exports = {};
__export(adapter_exports, {
  createDailyDataDomain: () => createDailyDataDomain
});
module.exports = __toCommonJS(adapter_exports);

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/db/mongo.js
var import_mongodb = require("mongodb");
var SAFE_WRITE_CONCERN = Object.freeze({ w: "majority", j: true });
var REQUIRED_BUILDER_COLLECTIONS = Object.freeze([
  "sites",
  "site_data_revisions",
  "site_data_audit_logs"
]);

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/db/indexDefinitions.js
var BUILDER_GLOBAL_COLLECTIONS = Object.freeze({
  sites: "sites",
  revisions: "site_data_revisions",
  auditLogs: "site_data_audit_logs"
});
var BUILDER_GLOBAL_INDEXES = Object.freeze([
  { collection: BUILDER_GLOBAL_COLLECTIONS.sites, key: { siteId: 1 }, options: { unique: true } },
  { collection: BUILDER_GLOBAL_COLLECTIONS.sites, key: { siteSlug: 1 }, options: {} },
  { collection: BUILDER_GLOBAL_COLLECTIONS.sites, key: { safeCollectionName: 1 }, options: { unique: true } },
  { collection: BUILDER_GLOBAL_COLLECTIONS.revisions, key: { siteId: 1, documentKey: 1, createdAt: -1 }, options: {} },
  { collection: BUILDER_GLOBAL_COLLECTIONS.auditLogs, key: { siteId: 1, documentKey: 1, createdAt: -1 }, options: {} }
]);
var BUILDER_PHYSICAL_INDEXES = Object.freeze([
  { key: { siteId: 1, scope: 1, entityId: 1, deletedAt: 1 }, options: {} },
  { key: { siteId: 1, scope: 1, updatedAt: -1 }, options: {} },
  { key: { hash: 1 }, options: {} }
]);
async function createIndexesFromDefinitions(collection, definitions) {
  await Promise.all(definitions.map((definition) => collection.createIndex(definition.key, definition.options)));
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/utils/collectionNames.js
var import_crypto = __toESM(require("crypto"));
var DEFAULT_PREFIX = "site_";
var DEFAULT_MAX_LENGTH = 96;
var hash = (value, length = 10) => import_crypto.default.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, length);
var sanitizePrefix = (value) => {
  const cleaned = String(value || DEFAULT_PREFIX).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned ? `${cleaned.replace(/_?$/u, "")}_` : DEFAULT_PREFIX;
};
function sanitizeSiteCollectionName(siteIdOrSlug, options = {}) {
  const prefix = sanitizePrefix(options.prefix || process.env.SITE_COLLECTION_PREFIX || DEFAULT_PREFIX);
  const maxLength = Math.max(32, Number(options.maxLength || DEFAULT_MAX_LENGTH));
  const hashLength = Math.max(6, Math.min(24, Number(options.hashLength || 10)));
  const raw = String(siteIdOrSlug ?? "").trim();
  const stableHash = hash(raw, hashLength);
  const lowered = raw.toLowerCase();
  let base = lowered.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[/\\\s.]+/g, "_").replace(/[^a-z0-9_-]+/g, "_").replace(/-+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!base || base === "system") {
    base = "site";
  }
  if (base.startsWith("system_")) {
    base = `site_${base}`;
  }
  const suffix = `_${stableHash}`;
  const maxBaseLength = Math.max(4, maxLength - prefix.length - suffix.length);
  const truncatedBase = base.slice(0, maxBaseLength).replace(/^_+|_+$/g, "") || "site";
  return `${prefix}${truncatedBase}${suffix}`.replace(/_+/g, "_").slice(0, maxLength);
}
function assertSafeCollectionName(collectionName) {
  const value = String(collectionName ?? "");
  if (!/^[a-z0-9_][a-z0-9_-]*$/u.test(value)) {
    throw new Error(`Unsafe MongoDB collection name: ${value}`);
  }
  if (value.startsWith("system.")) {
    throw new Error(`Unsafe MongoDB collection name: ${value}`);
  }
  if (value.length > DEFAULT_MAX_LENGTH) {
    throw new Error(`MongoDB collection name is too long: ${value.length}`);
  }
  return value;
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/utils/canonicalJson.js
var import_crypto2 = __toESM(require("crypto"));
var isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainObject(value)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}
function sha256OfCanonicalJson(value) {
  return import_crypto2.default.createHash("sha256").update(canonicalStringify(value)).digest("hex");
}
function cloneJson(value) {
  if (value === void 0) return void 0;
  return JSON.parse(JSON.stringify(value));
}
function deepMergeJson(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return cloneJson(patch);
  }
  const next = cloneJson(base);
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null) {
      next[key] = null;
      return;
    }
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = deepMergeJson(next[key], value);
      return;
    }
    next[key] = cloneJson(value);
  });
  return next;
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/utils/errors.js
var ApiError = class extends Error {
  constructor(statusCode, code, message, details = void 0) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
};
var badRequest = (message, details) => new ApiError(400, "bad_request", message, details);
var notFound = (message = "Not found") => new ApiError(404, "not_found", message);
var conflict = (message = "Conflict", details) => new ApiError(409, "conflict", message, details);
var preconditionRequired = (message = "expectedVersion or If-Match is required") => new ApiError(428, "precondition_required", message);

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/repository/SiteDataRepository.js
var now = () => /* @__PURE__ */ new Date();
var isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var isJsonObjectOrArray = (value) => Array.isArray(value) || isObject(value);
function isSuspiciousEmptyOverwrite(data) {
  if (data === null || data === void 0) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (isObject(data)) return Object.keys(data).length === 0;
  return true;
}
function documentId(scope, entityId) {
  if (scope === "backups") return `backup:${entityId}`;
  return `${scope}:${entityId}`;
}
function validateDataDocumentInput({ siteId, scope, entityId, data }) {
  if (!String(siteId || "").trim()) throw badRequest("siteId is required");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(scope || ""))) {
    throw badRequest('scope must contain only letters, numbers, "_" or "-"');
  }
  if (!String(entityId || "").trim() || String(entityId).includes("\0")) {
    throw badRequest("entityId is required and cannot contain null bytes");
  }
  if (!isJsonObjectOrArray(data)) {
    throw badRequest("data must be a JSON object or array");
  }
}
function parseExpectedVersion(value) {
  if (value === void 0 || value === null || value === "") {
    throw preconditionRequired();
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw badRequest("expectedVersion must be a non-negative integer");
  }
  return numeric;
}
var SiteDataRepository = class {
  constructor(db, options = {}) {
    this.db = db;
    this.collectionPrefix = options.collectionPrefix || process.env.SITE_COLLECTION_PREFIX || "site_";
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
    const grouped = /* @__PURE__ */ new Map();
    for (const definition of BUILDER_GLOBAL_INDEXES) {
      grouped.set(definition.collection, [...grouped.get(definition.collection) || [], definition]);
    }
    await Promise.all(
      [...grouped.entries()].map(([collectionName, definitions]) => createIndexesFromDefinitions(this.db.collection(collectionName), definitions))
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
  async ensureSite({ siteId, siteSlug = "", displayName = "", status = "active", publicRead = false, actor = "system" }) {
    const normalizedSiteId = String(siteId || "").trim();
    if (!normalizedSiteId) throw badRequest("siteId is required");
    const existing = await this.sitesCollection().findOne({ siteId: normalizedSiteId });
    if (existing) return existing;
    const createdAt = now();
    const safeNameSource = siteSlug ? `${siteSlug}:${normalizedSiteId}` : normalizedSiteId;
    const safeCollectionName = sanitizeSiteCollectionName(safeNameSource, {
      prefix: this.collectionPrefix
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
      updatedBy: actor
    };
    await this.sitesCollection().insertOne(site, { writeConcern: SAFE_WRITE_CONCERN });
    await this.ensureSiteCollectionIndexes(safeCollectionName);
    return site;
  }
  async ensureSiteCollectionIndexes(collectionName) {
    await createIndexesFromDefinitions(this.siteCollection(collectionName), BUILDER_PHYSICAL_INDEXES);
  }
  async resolveSiteCollection(siteId, { createIfMissing = false } = {}) {
    const site = createIfMissing ? await this.ensureSite({ siteId }) : await this.getSite(siteId);
    return {
      site,
      collection: this.siteCollection(site.safeCollectionName)
    };
  }
  async touchSite(siteId, actor = "system") {
    await this.sitesCollection().updateOne(
      { siteId },
      { $set: { updatedAt: now(), updatedBy: actor } },
      { writeConcern: SAFE_WRITE_CONCERN }
    );
  }
  async listDocuments(siteId, scope) {
    const { collection } = await this.resolveSiteCollection(siteId);
    return collection.find({ siteId, scope, deletedAt: null }).sort({ updatedAt: 1, entityId: 1 }).toArray();
  }
  async getDocument(siteId, scope, entityId, { includeDeleted = false } = {}) {
    const { collection } = await this.resolveSiteCollection(siteId);
    const filter = {
      _id: documentId(scope, entityId),
      siteId,
      scope,
      entityId
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
    actor = "system",
    metadata = {},
    operation = "replace"
  }) {
    validateDataDocumentInput({ siteId, scope, entityId, data });
    const resolvedExpectedVersion = parseExpectedVersion(expectedVersion);
    if (isSuspiciousEmptyOverwrite(data) && !allowEmptyOverwrite) {
      throw badRequest("Suspicious empty overwrite rejected. Pass allowEmptyOverwrite=true for intentional resets.");
    }
    const { site, collection } = await this.resolveSiteCollection(siteId, { createIfMissing: true });
    const _id = documentId(scope, entityId);
    const existing = await collection.findOne({ _id, siteId, scope, entityId, deletedAt: null });
    const deletedExisting = existing ? null : await collection.findOne({ _id, siteId, scope, entityId });
    const createdAt = now();
    const hash2 = sha256OfCanonicalJson(data);
    if (!existing) {
      if (deletedExisting?.deletedAt) {
        if (resolvedExpectedVersion !== 0) {
          await this.writeAuditLog({
            siteId,
            documentKey: _id,
            scope,
            entityId,
            operation,
            result: "conflict",
            actor,
            metadata: {
              expectedVersion: resolvedExpectedVersion,
              actualVersion: deletedExisting.version,
              reason: "deleted-document",
              ...metadata
            }
          });
          throw conflict("Version conflict: document is deleted", {
            expectedVersion: resolvedExpectedVersion,
            actualVersion: deletedExisting.version
          });
        }
        const nextVersion2 = deletedExisting.version + 1;
        await this.writeRevision({
          siteId,
          collectionName: site.safeCollectionName,
          documentKey: _id,
          previousData: null,
          nextData: data,
          previousVersion: deletedExisting.version,
          nextVersion: nextVersion2,
          operation,
          actor
        });
        const updateResult2 = await collection.updateOne(
          { _id, siteId, scope, entityId, version: deletedExisting.version },
          {
            $set: {
              data,
              version: nextVersion2,
              hash: hash2,
              deletedAt: null,
              updatedAt: createdAt,
              updatedBy: actor,
              metadata
            }
          },
          { writeConcern: SAFE_WRITE_CONCERN }
        );
        if (updateResult2.matchedCount !== 1) {
          await this.writeAuditLog({
            siteId,
            documentKey: _id,
            scope,
            entityId,
            operation,
            result: "conflict",
            actor,
            metadata: { expectedVersion: 0, reason: "race-after-deleted-revision", ...metadata }
          });
          throw conflict("Version conflict");
        }
        await this.touchSite(siteId, actor);
        await this.writeAuditLog({
          siteId,
          documentKey: _id,
          scope,
          entityId,
          operation,
          result: "ok",
          actor,
          metadata: { resurrectedDeletedDocument: true, ...metadata }
        });
        return {
          ...deletedExisting,
          data,
          version: nextVersion2,
          hash: hash2,
          deletedAt: null,
          updatedAt: createdAt,
          updatedBy: actor,
          metadata
        };
      }
      if (resolvedExpectedVersion !== 0) {
        await this.writeAuditLog({
          siteId,
          documentKey: _id,
          scope,
          entityId,
          operation,
          result: "conflict",
          actor,
          metadata: { expectedVersion: resolvedExpectedVersion, reason: "missing-document", ...metadata }
        });
        throw conflict("Version conflict: document does not exist", { expectedVersion: resolvedExpectedVersion });
      }
      const doc = {
        _id,
        siteId,
        scope,
        entityId,
        data,
        schemaVersion: 1,
        version: 1,
        hash: hash2,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
        createdBy: actor,
        updatedBy: actor,
        metadata
      };
      await this.writeRevision({
        siteId,
        collectionName: site.safeCollectionName,
        documentKey: _id,
        previousData: null,
        nextData: data,
        previousVersion: 0,
        nextVersion: 1,
        operation: "create",
        actor
      });
      await collection.insertOne(doc, { writeConcern: SAFE_WRITE_CONCERN });
      await this.touchSite(siteId, actor);
      await this.writeAuditLog({ siteId, documentKey: _id, scope, entityId, operation: "create", result: "ok", actor, metadata });
      return doc;
    }
    if (existing.version !== resolvedExpectedVersion) {
      await this.writeAuditLog({
        siteId,
        documentKey: _id,
        scope,
        entityId,
        operation,
        result: "conflict",
        actor,
        metadata: { expectedVersion: resolvedExpectedVersion, actualVersion: existing.version, ...metadata }
      });
      throw conflict("Version conflict", { expectedVersion: resolvedExpectedVersion, actualVersion: existing.version });
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
      actor
    });
    const updateResult = await collection.updateOne(
      { _id, siteId, scope, entityId, version: resolvedExpectedVersion, deletedAt: null },
      {
        $set: {
          data,
          version: nextVersion,
          hash: hash2,
          deletedAt: null,
          updatedAt,
          updatedBy: actor,
          metadata
        }
      },
      { writeConcern: SAFE_WRITE_CONCERN }
    );
    if (updateResult.matchedCount !== 1) {
      await this.writeAuditLog({
        siteId,
        documentKey: _id,
        scope,
        entityId,
        operation,
        result: "conflict",
        actor,
        metadata: { expectedVersion: resolvedExpectedVersion, reason: "race-after-revision", ...metadata }
      });
      throw conflict("Version conflict");
    }
    await this.touchSite(siteId, actor);
    await this.writeAuditLog({ siteId, documentKey: _id, scope, entityId, operation, result: "ok", actor, metadata });
    return {
      ...existing,
      data,
      version: nextVersion,
      hash: hash2,
      deletedAt: null,
      updatedAt,
      updatedBy: actor,
      metadata
    };
  }
  async patchDocument({
    siteId,
    scope,
    entityId,
    patch,
    expectedVersion,
    allowEmptyOverwrite = false,
    actor = "system",
    metadata = {}
  }) {
    const resolvedExpectedVersion = parseExpectedVersion(expectedVersion);
    const current = await this.getDocument(siteId, scope, entityId);
    const nextData = isObject(current.data) && isObject(patch) ? deepMergeJson(current.data, patch) : patch;
    return this.replaceDocument({
      siteId,
      scope,
      entityId,
      data: nextData,
      expectedVersion: resolvedExpectedVersion,
      allowEmptyOverwrite,
      actor,
      metadata,
      operation: "patch"
    });
  }
  async softDeleteDocument({ siteId, scope, entityId, expectedVersion, actor = "system", metadata = {} }) {
    const resolvedExpectedVersion = parseExpectedVersion(expectedVersion);
    const { site, collection } = await this.resolveSiteCollection(siteId, { createIfMissing: true });
    const _id = documentId(scope, entityId);
    const existing = await collection.findOne({ _id, siteId, scope, entityId, deletedAt: null });
    if (!existing) throw notFound(`Document "${scope}:${entityId}" was not found`);
    if (existing.version !== resolvedExpectedVersion) {
      throw conflict("Version conflict", { expectedVersion: resolvedExpectedVersion, actualVersion: existing.version });
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
      operation: "delete",
      actor
    });
    const updateResult = await collection.updateOne(
      { _id, siteId, scope, entityId, version: resolvedExpectedVersion, deletedAt: null },
      {
        $set: {
          version: nextVersion,
          deletedAt,
          updatedAt: deletedAt,
          updatedBy: actor
        }
      },
      { writeConcern: SAFE_WRITE_CONCERN }
    );
    if (updateResult.matchedCount !== 1) {
      throw conflict("Version conflict");
    }
    await this.touchSite(siteId, actor);
    await this.writeAuditLog({ siteId, documentKey: _id, scope, entityId, operation: "delete", result: "ok", actor, metadata });
    return {
      ...existing,
      version: nextVersion,
      deletedAt,
      updatedAt: deletedAt,
      updatedBy: actor
    };
  }
  async batchRead(siteId, items) {
    const results = [];
    for (const item of items) {
      try {
        const doc = await this.getDocument(siteId, item.scope, item.entityId);
        results.push({ ...item, ok: true, document: doc });
      } catch (error) {
        results.push({ ...item, ok: false, error: error.code || "read_failed", message: error.message });
      }
    }
    return results;
  }
  async batchWrite(siteId, operations, actor = "system") {
    const results = [];
    for (const operation of operations) {
      try {
        let document;
        if (operation.op === "put") {
          document = await this.replaceDocument({ siteId, actor, ...operation });
        } else if (operation.op === "patch") {
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
          error: error.code || "write_failed",
          message: error.message
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
    actor
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
        nextHash: nextData === null ? null : sha256OfCanonicalJson(nextData)
      },
      { writeConcern: SAFE_WRITE_CONCERN }
    );
  }
  async writeAuditLog({
    siteId,
    documentKey,
    scope,
    entityId,
    operation,
    result,
    actor = "system",
    ip = "",
    userAgent = "",
    metadata = {}
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
          metadataBytes: canonicalStringify(metadata || {}).length
        }
      },
      { writeConcern: SAFE_WRITE_CONCERN }
    );
  }
};

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/repository/legacyMappings.js
var import_crypto3 = __toESM(require("crypto"));
var normalizeSlashes = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/");
var LEGACY_MAPPINGS = Object.freeze([
  {
    key: "masterConfig",
    fileName: "bihs_master_config_v1.txt",
    scope: "config",
    entityId: "master",
    mode: "singleton"
  },
  {
    key: "users",
    fileName: "users_data.txt",
    scope: "admins",
    mode: "list",
    itemIdField: "id",
    rootType: "array"
  },
  {
    key: "events",
    fileName: "events_data.txt",
    scope: "events",
    mode: "list-with-settings",
    itemIdField: "id",
    listProperty: "events",
    rootType: "object"
  },
  {
    key: "navigation",
    fileName: "nav_data.txt",
    scope: "navigation",
    mode: "list",
    itemIdField: "id",
    rootType: "array"
  },
  {
    key: "siteContent",
    fileName: "site_content_data.txt",
    scope: "content",
    entityId: "site",
    mode: "singleton"
  },
  {
    key: "theme",
    fileName: "theme_data.txt",
    scope: "design",
    entityId: "theme",
    mode: "singleton"
  },
  {
    key: "widgets",
    fileName: "widgets_data.txt",
    scope: "widgets",
    entityId: "config",
    mode: "singleton",
    reason: "widgets_data.txt is a mixed object with multiple nested lists and active item settings"
  },
  {
    key: "externalLinks",
    fileName: "external_links_data.txt",
    scope: "externalLinks",
    mode: "list",
    itemIdField: "id",
    rootType: "array"
  },
  {
    key: "gantt",
    fileName: "gantt_data.txt",
    scope: "gantt",
    entityId: "settings",
    mode: "singleton"
  },
  {
    key: "boom",
    fileName: "boom_data.txt",
    scope: "boom",
    entityId: "settings",
    mode: "singleton",
    optionalWhenMissing: true
  }
]);
function normalizeLegacyKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    try {
      return normalizeSlashes(new URL(raw).pathname).replace(/^\/+/, "");
    } catch {
      return normalizeSlashes(raw).replace(/^\/+/, "");
    }
  }
  return normalizeSlashes(raw).replace(/^\/+/, "");
}
function getLegacyMapping(key) {
  const normalized = normalizeLegacyKey(key);
  const fileName = normalized.split("/").pop()?.toLowerCase() || normalized.toLowerCase();
  return LEGACY_MAPPINGS.find((mapping) => mapping.fileName.toLowerCase() === fileName) || {
    key: "unknown",
    fileName,
    scope: "legacy",
    entityId: normalized,
    mode: "singleton",
    unknown: true
  };
}
function getLegacyMetaEntityId(key) {
  return normalizeLegacyKey(key);
}
function getLegacyListMetaEntityId(key) {
  const normalized = normalizeLegacyKey(key);
  const suffix = import_crypto3.default.createHash("sha1").update(normalized).digest("hex").slice(0, 10);
  return `__legacy_meta_${suffix}`;
}
function describeLegacyMapping(mapping) {
  if (mapping.unknown) {
    return "unknown legacy key stored as singleton in legacy scope";
  }
  if (mapping.mode === "list") {
    return `${mapping.fileName} list items stored as ${mapping.scope} documents`;
  }
  if (mapping.mode === "list-with-settings") {
    return `${mapping.fileName} list items stored as ${mapping.scope} documents with a settings meta document`;
  }
  return `${mapping.fileName} stored as singleton ${mapping.scope}:${mapping.entityId}`;
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/repository/LegacyCompatibilityRepository.js
var LEGACY_META_SCOPE = "legacyMeta";
var UNKNOWN_LEGACY_SCOPE = "legacy";
var isObject2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function readItemId(item, itemIdField, index) {
  const candidate = isObject2(item) ? item[itemIdField] : null;
  const value = String(candidate ?? "").trim();
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
var LegacyCompatibilityRepository = class {
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
        missing: true
      };
    }
    return {
      key: normalizedKey,
      mapping,
      data: snapshot.data,
      version: snapshot.version,
      hash: snapshot.hash,
      documents: snapshot.documents,
      missing: false
    };
  }
  async writeLegacyObject({
    siteId,
    key,
    data,
    expectedVersion,
    allowEmptyOverwrite = false,
    actor = "system",
    metadata = {}
  }) {
    const normalizedKey = normalizeLegacyKey(key);
    if (!normalizedKey) throw badRequest("Legacy key is required");
    if (isSuspiciousEmptyOverwrite(data) && !allowEmptyOverwrite) {
      throw badRequest("Suspicious empty overwrite rejected. Pass allowEmptyOverwrite=true for intentional resets.");
    }
    const mapping = getLegacyMapping(normalizedKey);
    const current = await this.readLegacySnapshot(siteId, normalizedKey, mapping, { allowMissing: true });
    const expected = expectedVersion === void 0 || expectedVersion === null ? 0 : Number(expectedVersion);
    if (current.version !== expected) {
      throw conflict("Legacy object version conflict", {
        key: normalizedKey,
        expectedVersion: expected,
        actualVersion: current.version
      });
    }
    let documents;
    if (mapping.unknown || mapping.mode === "singleton") {
      documents = [await this.writeSingleton(
        siteId,
        mapping,
        data,
        allowEmptyOverwrite,
        actor,
        metadata,
        current.dataDocuments[0] || null
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
          currentMeta: current.listMeta || null
        }
      );
    }
    const manifestData = {
      key: normalizedKey,
      mappingKey: mapping.key,
      fileName: mapping.fileName,
      mode: mapping.mode,
      normalizedAs: describeLegacyMapping(mapping),
      hash: sha256OfCanonicalJson(data),
      documentKeys: documents.map((doc) => doc._id)
    };
    const nextManifest = await this.writeManifestDocument({
      siteId,
      normalizedKey,
      data: manifestData,
      currentManifest: current.manifest,
      desiredVersion: current.version + 1,
      actor,
      metadata: { legacyKey: normalizedKey, ...metadata }
    });
    return {
      key: normalizedKey,
      mapping,
      data,
      version: nextManifest.version,
      hash: sha256OfCanonicalJson(data),
      documents: [...documents, nextManifest],
      missing: false
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
      operation: "legacy-write"
    });
  }
  async writeList(siteId, normalizedKey, mapping, data, allowEmptyOverwrite, actor, metadata, current = {}) {
    const list = mapping.mode === "list-with-settings" ? Array.isArray(data?.[mapping.listProperty]) ? data[mapping.listProperty] : [] : Array.isArray(data) ? data : [];
    if (!Array.isArray(list)) {
      throw badRequest(`Legacy mapping ${mapping.fileName} expects an array`);
    }
    const currentDocs = Array.isArray(current.currentDocs) ? current.currentDocs : [];
    const currentByEntityId = new Map(
      currentDocs.map((doc) => [String(doc.entityId), doc])
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
        operation: "legacy-write"
      });
      written.push(doc);
    }
    for (const doc of currentDocs) {
      if (String(doc.entityId).startsWith("__legacy_meta_")) continue;
      if (!nextIdSet.has(String(doc.entityId))) {
        const deleted = await this.repository.softDeleteDocument({
          siteId,
          scope: mapping.scope,
          entityId: doc.entityId,
          expectedVersion: doc.version,
          actor,
          metadata: { legacyKey: normalizedKey, legacyFileName: mapping.fileName, ...metadata }
        });
        written.push(deleted);
      }
    }
    const metaEntityId = getLegacyListMetaEntityId(normalizedKey);
    const existingMeta = current.currentMeta || null;
    const settings = mapping.mode === "list-with-settings" ? Object.entries(data || {}).reduce((acc, [key, value]) => {
      if (key !== mapping.listProperty) acc[key] = value;
      return acc;
    }, {}) : {};
    const metaDoc = await this.repository.replaceDocument({
      siteId,
      scope: mapping.scope,
      entityId: metaEntityId,
      data: {
        key: normalizedKey,
        order: nextIds,
        settings
      },
      expectedVersion: existingMeta?.version ?? 0,
      allowEmptyOverwrite: true,
      actor,
      metadata: { legacyKey: normalizedKey, legacyFileName: mapping.fileName, ...metadata },
      operation: "legacy-meta-write"
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
    metadata
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
        operation: "legacy-write"
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
        adoptedLegacyVersion: Math.max(0, Number(desiredVersion || 1) - 1)
      },
      operation: "legacy-manifest-adopt"
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
        operation: "legacy-write"
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
      manifest: null
    });
    const manifest = await this.readManifestIfExists(siteId, normalizedKey);
    if (mapping.unknown || mapping.mode === "singleton") {
      const scope = mapping.unknown ? UNKNOWN_LEGACY_SCOPE : mapping.scope;
      const entityId = mapping.unknown ? mapping.entityId : mapping.entityId;
      const doc = await this.readDocIfExists(siteId, scope, entityId);
      if (!doc) {
        if (allowMissing) return missing();
        throw notFound(`Legacy object "${normalizedKey}" was not found`);
      }
      const data2 = doc.data;
      return {
        exists: true,
        data: data2,
        version: manifest?.version ?? doc.version,
        hash: sha256OfCanonicalJson(data2),
        documents: [doc, manifest].filter(Boolean),
        dataDocuments: [doc],
        listMeta: null,
        manifest
      };
    }
    const allDocs = await this.repository.listDocuments(siteId, mapping.scope);
    const docs = allDocs.filter((doc) => !String(doc.entityId).startsWith("__legacy_meta_"));
    const meta = allDocs.find((doc) => doc.entityId === getLegacyListMetaEntityId(normalizedKey)) || await this.readListMetaIfExists(siteId, normalizedKey);
    if (!manifest && !meta && docs.length === 0) {
      if (allowMissing) return missing();
      throw notFound(`Legacy object "${normalizedKey}" was not found`);
    }
    const orderedData = sortDocsByOrder(docs, meta?.data?.order || []).map((doc) => doc.data);
    const data = mapping.mode === "list-with-settings" ? {
      ...isObject2(meta?.data?.settings) ? meta.data.settings : {},
      [mapping.listProperty]: orderedData
    } : orderedData;
    return {
      exists: true,
      data,
      version: manifest?.version ?? meta?.version ?? Math.max(0, ...docs.map((doc) => doc.version || 0)),
      hash: sha256OfCanonicalJson(data),
      documents: [...docs, meta, manifest].filter(Boolean),
      dataDocuments: docs,
      listMeta: meta || null,
      manifest
    };
  }
  async readManifestIfExists(siteId, key) {
    return this.readDocIfExists(siteId, LEGACY_META_SCOPE, getLegacyMetaEntityId(key));
  }
  async readListMetaIfExists(siteId, key) {
    const mapping = getLegacyMapping(key);
    if (mapping.mode !== "list" && mapping.mode !== "list-with-settings") return null;
    return this.readDocIfExists(siteId, mapping.scope, getLegacyListMetaEntityId(key));
  }
  async readDocIfExists(siteId, scope, entityId) {
    try {
      return await this.repository.getDocument(siteId, scope, entityId);
    } catch (error) {
      if (error.statusCode === 404 || error.code === "not_found") return null;
      throw error;
    }
  }
};

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/repository/SiteBackupRepository.js
var BACKUP_SCOPE = "backups";
var BACKUP_SOURCE = "admin-backup-management";
var MAX_BACKUP_DOCUMENT_BYTES = 8 * 1024 * 1024;
var BACKUP_PACKAGE_KIND = "bihs-backup-package";
var textEncoder = new TextEncoder();
var LEGACY_FILE_NAMES = new Set(LEGACY_MAPPINGS.map((mapping) => mapping.fileName));
var EXPECTED_LEGACY_FILE_NAMES = LEGACY_MAPPINGS.map((mapping) => mapping.fileName);
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var isObject3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var cloneJson2 = (value) => JSON.parse(JSON.stringify(value));
function byteLength(value) {
  return textEncoder.encode(JSON.stringify(value)).length;
}
function sanitizeBackupId(value = "") {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9_.:-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 160);
}
function sanitizeRestoreUnitToken(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}
function buildRestoreUnitId(entry = {}, backupId = "") {
  const fileName = sanitizeRestoreUnitToken(entry.fileName || entry.name || "");
  const scope = sanitizeRestoreUnitToken(entry.scope || "");
  const entityId = sanitizeRestoreUnitToken(entry.entityId || "");
  const mappingKey = sanitizeRestoreUnitToken(entry.mappingKey || "");
  const normalizedBackupId = sanitizeRestoreUnitToken(backupId || "");
  const baseParts = [normalizedBackupId || "backup", fileName || "file", scope || "scope", entityId || "entity", mappingKey || "key"];
  return `ru-${baseParts.join("-")}`;
}
function createBackupId(createdAt = nowIso()) {
  return `backup-${createdAt.replace(/[:.]/g, "-")}`;
}
function normalizeFile(file, index) {
  if (!isObject3(file)) throw badRequest(`Backup file at index ${index} must be an object.`);
  const name = String(file.name || "").trim();
  if (!name) throw badRequest(`Backup file at index ${index} is missing name.`);
  if (typeof file.text !== "string") throw badRequest(`Backup file "${name}" is missing text.`);
  return {
    ...file,
    name,
    text: file.text,
    sizeBytes: Number.isFinite(Number(file.sizeBytes)) ? Number(file.sizeBytes) : textEncoder.encode(file.text).length
  };
}
function normalizeBackupPackage(candidate, { fallbackId = "", createdAt = nowIso() } = {}) {
  if (!isObject3(candidate)) throw badRequest("Backup package must be a JSON object.");
  const sourceFiles = Array.isArray(candidate.files) ? candidate.files : [];
  if (sourceFiles.length === 0) throw badRequest("Backup package must include at least one file.");
  const files = sourceFiles.map(normalizeFile);
  const id = sanitizeBackupId(candidate.id || candidate.backup?.id || fallbackId || createBackupId(createdAt));
  if (!id) throw badRequest("Backup package id is invalid.");
  return {
    ...cloneJson2(candidate),
    kind: candidate.kind || BACKUP_PACKAGE_KIND,
    version: candidate.version || "1.0.0",
    id,
    exportedAt: typeof candidate.exportedAt === "string" ? candidate.exportedAt : createdAt,
    source: typeof candidate.source === "string" ? candidate.source : BACKUP_SOURCE,
    backup: {
      ...isObject3(candidate.backup) ? cloneJson2(candidate.backup) : {},
      id,
      name: typeof candidate.backup?.name === "string" ? candidate.backup.name : "",
      timeCreated: typeof candidate.backup?.timeCreated === "string" ? candidate.backup.timeCreated : createdAt,
      timeLastModified: typeof candidate.backup?.timeLastModified === "string" ? candidate.backup.timeLastModified : createdAt
    },
    files,
    meta: isObject3(candidate.meta) ? cloneJson2(candidate.meta) : {}
  };
}
function parseFileJson(file) {
  try {
    return JSON.parse(file.text);
  } catch (error) {
    throw badRequest(`Backup file "${file.name}" is not valid JSON: ${error.message}`);
  }
}
function isNotFoundError(error) {
  return error?.statusCode === 404 || error?.code === "not_found";
}
function countLegacyRecords(mapping, data) {
  if (mapping.mode === "list") {
    return Array.isArray(data) ? data.length : 0;
  }
  if (mapping.mode === "list-with-settings") {
    return Array.isArray(data?.[mapping.listProperty]) ? data[mapping.listProperty].length : 0;
  }
  if (Array.isArray(data)) return data.length;
  if (isObject3(data)) return Object.keys(data).length > 0 ? 1 : 0;
  return data === null || data === void 0 ? 0 : 1;
}
function validateLegacyPayload(mapping, data, fileName) {
  if (!mapping) throw badRequest(`Backup file "${fileName}" has no supported restore destination.`);
  if (data === null) {
    throw badRequest(`Backup file "${fileName}" contains null instead of a restorable ${mapping.mode} payload.`);
  }
  if (mapping.mode === "list" && !Array.isArray(data)) {
    throw badRequest(`Backup file "${fileName}" must contain a JSON array.`);
  }
  if (mapping.mode === "list-with-settings" && (!isObject3(data) || !Array.isArray(data[mapping.listProperty]))) {
    throw badRequest(`Backup file "${fileName}" must contain an "${mapping.listProperty}" array.`);
  }
  if (mapping.mode === "singleton" && !isObject3(data)) {
    throw badRequest(`Backup file "${fileName}" must contain a JSON object.`);
  }
}
function hasLegacySettings(mapping, data) {
  if (mapping.mode !== "list-with-settings" || !isObject3(data)) return false;
  return Object.keys(data).some((key) => key !== mapping.listProperty);
}
function isEmptyLegacyData(mapping, data) {
  if (mapping.mode === "list") {
    return !Array.isArray(data) || data.length === 0;
  }
  if (mapping.mode === "list-with-settings") {
    return countLegacyRecords(mapping, data) === 0 && !hasLegacySettings(mapping, data);
  }
  if (Array.isArray(data)) return data.length === 0;
  if (isObject3(data)) return Object.keys(data).length === 0;
  return data === null || data === void 0 || data === "";
}
function fallbackTextForMissingFile() {
  return "null";
}
function backupFileStatusFromEntry(entry = {}) {
  if (entry.invalid) return "invalid";
  if (entry.missing) return "missing";
  if (entry.restoreStatus) return entry.restoreStatus;
  if (entry.status) return entry.status;
  if (entry.empty) return "empty";
  return "hasData";
}
function isEntryRestorable(entry = {}) {
  const status = backupFileStatusFromEntry(entry);
  return entry.willRestore !== false && entry.restoreAction !== "skipped" && status !== "missing" && status !== "invalid";
}
function inferEntryFromFile(file) {
  const mapping = LEGACY_MAPPINGS.find((item) => item.fileName === file.name);
  const status = backupFileStatusFromEntry(file);
  const willRestore = LEGACY_FILE_NAMES.has(file.name) && isEntryRestorable(file);
  return {
    fileName: file.name,
    scope: file.scope || mapping?.scope || "",
    entityId: file.entityId || mapping?.entityId || "",
    mappingKey: file.mappingKey || mapping?.key || "",
    status,
    restoreStatus: status,
    restoreAction: willRestore ? "will_restore" : "skipped",
    willRestore,
    empty: Boolean(file.empty) || status === "empty",
    missing: Boolean(file.missing) || status === "missing",
    invalid: Boolean(file.invalid) || status === "invalid",
    recordCount: (() => {
      if (!mapping || typeof file.text !== "string") {
        return Number.isFinite(Number(file.recordCount)) ? Number(file.recordCount) : 0;
      }
      try {
        return countLegacyRecords(mapping, JSON.parse(file.text));
      } catch {
        return Number.isFinite(Number(file.recordCount)) ? Number(file.recordCount) : 0;
      }
    })(),
    documentCount: Number.isFinite(Number(file.documentCount)) ? Number(file.documentCount) : 0,
    version: Number.isFinite(Number(file.version)) ? Number(file.version) : void 0,
    hash: typeof file.hash === "string" ? file.hash : "",
    source: typeof file.source === "string" ? file.source : "",
    sizeBytes: Number(file.sizeBytes) || textEncoder.encode(file.text || "").length
  };
}
function restoreEntriesFromPackage(backupPackage, { backupId = "" } = {}) {
  const files = Array.isArray(backupPackage?.files) ? backupPackage.files : [];
  const filesByName = new Map(files.map((file) => [file.name, file]));
  const sourceEntries = Array.isArray(backupPackage?.meta?.restoreEntries) ? backupPackage.meta.restoreEntries : [];
  if (sourceEntries.length > 0) {
    return sourceEntries.map((entry) => {
      const sourceEntry = isObject3(entry) ? entry : {};
      const fileName = String(sourceEntry.fileName || sourceEntry.name || "").trim();
      const file = filesByName.get(fileName) || {};
      const inferredEntry = inferEntryFromFile({
        ...file,
        ...sourceEntry,
        name: fileName || file.name
      });
      const summarized = summarizeEntry({
        ...inferredEntry,
        ...cloneJson2(sourceEntry),
        fileName: fileName || file.name,
        name: fileName || file.name,
        sizeBytes: Number(sourceEntry.sizeBytes || file.sizeBytes || 0),
        backupId
      });
      return {
        ...cloneJson2(sourceEntry),
        ...summarized
      };
    }).filter((entry) => entry.fileName);
  }
  return files.map((file) => summarizeEntry({
    ...inferEntryFromFile(file),
    backupId,
    fileName: file.name,
    name: file.name,
    sizeBytes: Number(file.sizeBytes || 0)
  }));
}
function summarizeEntry(entry) {
  const backupId = String(entry.backupId || "").trim();
  return {
    fileName: entry.fileName,
    name: entry.fileName,
    scope: entry.scope || "",
    entityId: entry.entityId || "",
    mappingKey: entry.mappingKey || "",
    status: entry.status || backupFileStatusFromEntry(entry),
    restoreStatus: entry.restoreStatus || entry.status || backupFileStatusFromEntry(entry),
    restoreAction: entry.restoreAction || (entry.willRestore === false ? "skipped" : "will_restore"),
    willRestore: entry.willRestore !== false,
    empty: Boolean(entry.empty),
    missing: Boolean(entry.missing),
    invalid: Boolean(entry.invalid),
    recordCount: Number(entry.recordCount || 0),
    documentCount: Number(entry.documentCount || 0),
    version: entry.version,
    hash: entry.hash || "",
    source: entry.source || "",
    sizeBytes: Number(entry.sizeBytes || 0),
    restoreUnitId: typeof entry.restoreUnitId === "string" && entry.restoreUnitId.trim() ? entry.restoreUnitId : buildRestoreUnitId(entry, backupId)
  };
}
function buildRestoreIndexes(entries) {
  const legacyObjects = {};
  const scopes = {};
  entries.forEach((entry) => {
    const summary = summarizeEntry(entry);
    legacyObjects[entry.fileName] = summary;
    if (entry.scope) scopes[entry.scope] = summary;
  });
  return { legacyObjects, scopes };
}
function summarizePackage(backupPackage) {
  const files = Array.isArray(backupPackage.files) ? backupPackage.files : [];
  const fileNames = files.map((file) => file.name);
  const restoreEntries = restoreEntriesFromPackage(backupPackage, { backupId: backupPackage?.id });
  return {
    fileCount: files.length,
    fileNames,
    files: restoreEntries,
    totalSizeBytes: files.reduce((sum, file) => sum + (Number(file.sizeBytes) || 0), 0),
    hasMasterConfig: fileNames.includes("bihs_master_config_v1.txt"),
    restorableFiles: restoreEntries.filter((entry) => LEGACY_FILE_NAMES.has(entry.fileName) && isEntryRestorable(entry)).map((entry) => entry.fileName),
    expectedFiles: EXPECTED_LEGACY_FILE_NAMES,
    missingExpectedFiles: EXPECTED_LEGACY_FILE_NAMES.filter((fileName) => !restoreEntries.some((entry) => entry.fileName === fileName && entry.status !== "missing"))
  };
}
function ensureSizeWithinLimit(data, maxDocumentBytes) {
  const sizeBytes = byteLength(data);
  if (sizeBytes > maxDocumentBytes) {
    throw badRequest(
      `Backup package is too large for single-document Mongo storage (${sizeBytes} bytes, limit ${maxDocumentBytes} bytes). Future chunked backup support is required for this backup.`,
      { sizeBytes, maxDocumentBytes }
    );
  }
  return sizeBytes;
}
function toBackupListItem(document) {
  const data = document.data || {};
  const summary = data.summary || {};
  const backupId = data.backupId || document.entityId;
  const createdAt = data.createdAt || document.createdAt?.toISOString?.() || "";
  const updatedAt = document.updatedAt?.toISOString?.() || createdAt;
  return {
    id: backupId,
    name: data.name || "",
    description: data.description || "",
    source: data.source || BACKUP_SOURCE,
    storageBackend: data.storageBackend || "mongo",
    serverRelativeUrl: `mongo-backup:${backupId}`,
    url: "",
    timeCreated: createdAt,
    timeLastModified: updatedAt,
    createdAt,
    createdBy: data.createdBy || document.createdBy || "",
    fileCount: Number(summary.fileCount || 0),
    totalSizeBytes: Number(data.sizeBytes || summary.totalSizeBytes || 0),
    summary,
    files: Array.isArray(summary.files) ? summary.files : [],
    version: document.version,
    entityId: document.entityId
  };
}
function toFullBackup(document) {
  const item = toBackupListItem(document);
  return {
    ...item,
    data: document.data,
    snapshot: document.data?.snapshot || null,
    backupPackage: document.data?.snapshot || null,
    document: {
      _id: document._id,
      siteId: document.siteId,
      scope: document.scope,
      entityId: document.entityId,
      version: document.version,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      deletedAt: document.deletedAt
    }
  };
}
var SiteBackupRepository = class {
  constructor(siteDataRepository, legacyRepository, options = {}) {
    this.repository = siteDataRepository;
    this.legacyRepository = legacyRepository;
    this.maxDocumentBytes = Number(options.maxDocumentBytes || MAX_BACKUP_DOCUMENT_BYTES);
  }
  shouldCaptureCurrentSiteSnapshot(backupPackage) {
    if (backupPackage?.meta?.captureStrategy === "server-full-site") return true;
    if (backupPackage?.meta?.fullSiteSnapshot === true) return true;
    if (backupPackage?.meta?.importedAt) return false;
    const files = Array.isArray(backupPackage?.files) ? backupPackage.files : [];
    return backupPackage?.source === BACKUP_SOURCE && files.length === 1 && files[0]?.name === "bihs_master_config_v1.txt";
  }
  async buildCurrentSiteSnapshotPackage({ siteId, basePackage, createdAt, actor }) {
    if (!this.legacyRepository) {
      throw badRequest("legacyRepository is required to capture a full site backup snapshot.");
    }
    const requestFilesByName = new Map(
      (Array.isArray(basePackage.files) ? basePackage.files : []).map((file) => [file.name, file])
    );
    const files = [];
    const restoreEntries = [];
    for (const mapping of LEGACY_MAPPINGS) {
      const requestFile = requestFilesByName.get(mapping.fileName);
      let data = null;
      let snapshot = null;
      let source = "mongo-live";
      let status = "missing";
      let willRestore = false;
      try {
        snapshot = await this.legacyRepository.readLegacyObject(siteId, mapping.fileName);
        data = cloneJson2(snapshot.data);
        status = isEmptyLegacyData(mapping, data) ? "empty" : "hasData";
        willRestore = true;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        if (requestFile && typeof requestFile.text === "string" && requestFile.text.trim()) {
          data = parseFileJson(requestFile);
          source = "request-payload";
          status = isEmptyLegacyData(mapping, data) ? "empty" : "hasData";
          willRestore = true;
        }
      }
      const text2 = willRestore ? JSON.stringify(data, null, 2) : fallbackTextForMissingFile(mapping);
      const sizeBytes = textEncoder.encode(text2).length;
      const entry = summarizeEntry({
        fileName: mapping.fileName,
        name: mapping.fileName,
        scope: mapping.scope,
        entityId: mapping.entityId || "",
        mappingKey: mapping.key,
        status,
        restoreStatus: status,
        restoreAction: willRestore ? "will_restore" : "skipped",
        willRestore,
        empty: status === "empty",
        missing: status === "missing",
        invalid: false,
        recordCount: willRestore ? countLegacyRecords(mapping, data) : 0,
        documentCount: snapshot?.documents?.length || 0,
        version: snapshot?.version,
        hash: snapshot?.hash || "",
        source,
        sizeBytes,
        backupId: basePackage.id
      });
      files.push({
        name: mapping.fileName,
        label: requestFile?.label || "",
        targetServerRelativeUrl: requestFile?.targetServerRelativeUrl || "",
        timeCreated: createdAt,
        timeLastModified: createdAt,
        text: text2,
        sizeBytes,
        scope: entry.scope,
        entityId: entry.entityId,
        mappingKey: entry.mappingKey,
        status: entry.status,
        restoreStatus: entry.restoreStatus,
        restoreAction: entry.restoreAction,
        willRestore: entry.willRestore,
        empty: entry.empty,
        missing: entry.missing,
        invalid: entry.invalid,
        recordCount: entry.recordCount,
        documentCount: entry.documentCount,
        version: entry.version,
        hash: entry.hash,
        source: entry.source
      });
      restoreEntries.push(entry);
    }
    const indexes = buildRestoreIndexes(restoreEntries);
    return normalizeBackupPackage({
      ...cloneJson2(basePackage),
      source: BACKUP_SOURCE,
      backup: {
        ...isObject3(basePackage.backup) ? cloneJson2(basePackage.backup) : {},
        id: basePackage.id,
        timeCreated: basePackage.backup?.timeCreated || createdAt,
        timeLastModified: createdAt
      },
      files,
      exportedAt: basePackage.exportedAt || createdAt,
      meta: {
        ...isObject3(basePackage.meta) ? cloneJson2(basePackage.meta) : {},
        siteId,
        captureStrategy: "server-full-site",
        capturedAt: createdAt,
        capturedBy: actor,
        expectedLegacyFiles: EXPECTED_LEGACY_FILE_NAMES,
        restoreEntries: restoreEntries.map(summarizeEntry),
        legacyObjects: indexes.legacyObjects,
        scopes: indexes.scopes
      }
    }, { fallbackId: basePackage.id, createdAt });
  }
  async listBackups(siteId) {
    const documents = await this.repository.listDocuments(siteId, BACKUP_SCOPE);
    return documents.map(toBackupListItem).sort((a, b) => Date.parse(b.timeLastModified || b.timeCreated || "") - Date.parse(a.timeLastModified || a.timeCreated || ""));
  }
  async getBackup(siteId, backupId) {
    const document = await this.repository.getDocument(siteId, BACKUP_SCOPE, backupId);
    return toFullBackup(document);
  }
  async createBackup({
    siteId,
    backupPackage,
    name = "",
    description = "",
    actor = "api",
    metadata = {}
  }) {
    const createdAt = nowIso();
    const requestedPackage = normalizeBackupPackage(backupPackage, { createdAt });
    const normalizedPackage = this.shouldCaptureCurrentSiteSnapshot(requestedPackage) ? await this.buildCurrentSiteSnapshotPackage({
      siteId,
      basePackage: requestedPackage,
      createdAt,
      actor
    }) : requestedPackage;
    const backupId = normalizedPackage.id;
    const summary = summarizePackage(normalizedPackage);
    const data = {
      backupId,
      name: String(name || normalizedPackage.backup?.name || `backup-${createdAt}`).trim(),
      description: String(description || "").trim(),
      createdAt,
      createdBy: actor,
      source: BACKUP_SOURCE,
      summary,
      snapshot: normalizedPackage,
      sizeBytes: 0,
      storageBackend: "mongo",
      siteId
    };
    data.sizeBytes = ensureSizeWithinLimit(data, this.maxDocumentBytes);
    const document = await this.repository.replaceDocument({
      siteId,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      data,
      expectedVersion: 0,
      allowEmptyOverwrite: false,
      actor,
      metadata: { ...metadata, backupId },
      operation: "admin-backup-create"
    });
    await this.repository.writeAuditLog({
      siteId,
      documentKey: document._id,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      operation: "admin-backup-create",
      result: "ok",
      actor,
      metadata: { ...metadata, backupId, sizeBytes: data.sizeBytes }
    });
    return toFullBackup(document);
  }
  async deleteBackup({ siteId, backupId, expectedVersion = void 0, actor = "api", metadata = {} }) {
    const current = await this.repository.getDocument(siteId, BACKUP_SCOPE, backupId);
    const document = await this.repository.softDeleteDocument({
      siteId,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      expectedVersion: expectedVersion ?? current.version,
      actor,
      metadata: { ...metadata, backupId }
    });
    await this.repository.writeAuditLog({
      siteId,
      documentKey: document._id,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      operation: "admin-backup-delete",
      result: "ok",
      actor,
      metadata: { ...metadata, backupId }
    });
    return toFullBackup(document);
  }
  async restoreBackup({
    siteId,
    backupId,
    allowSiteIdMismatch = false,
    expectedBackupVersion,
    selectedRestoreUnitIds,
    preRestoreBackupId,
    actor = "api",
    metadata = {}
  }) {
    if (!this.legacyRepository) {
      throw new Error("legacyRepository is required for backup restore.");
    }
    const backup = await this.getBackup(siteId, backupId);
    if (expectedBackupVersion !== void 0 && Number(backup.version) !== Number(expectedBackupVersion)) {
      throw badRequest("Backup was modified since preview was generated. Reload the preview and retry.", {
        expectedBackupVersion,
        currentBackupVersion: backup.version
      });
    }
    const backupPackage = normalizeBackupPackage(backup.backupPackage, { fallbackId: backupId });
    const packageSiteId = String(backupPackage.meta?.siteId || backup.data?.siteId || "").trim();
    if (packageSiteId && packageSiteId !== siteId && !allowSiteIdMismatch) {
      throw badRequest("Backup siteId does not match restore target siteId.", {
        backupSiteId: packageSiteId,
        targetSiteId: siteId
      });
    }
    const restoreEntries = restoreEntriesFromPackage(backupPackage, { backupId });
    const restoreEntryById = /* @__PURE__ */ new Map();
    for (const entry of restoreEntries) {
      if (!entry.fileName) {
        throw badRequest("Restore entries are missing file names.");
      }
      const restoreUnitId = String(entry.restoreUnitId || "").trim();
      if (!restoreUnitId) {
        throw badRequest("Restore entries are missing stable identifiers.", { fileName: entry.fileName });
      }
      if (restoreEntryById.has(restoreUnitId)) {
        throw badRequest("Backup restore entries contain duplicate identifiers.", {
          restoreUnitId
        });
      }
      restoreEntryById.set(restoreUnitId, entry);
    }
    const requestedRestoreUnitIds = selectedRestoreUnitIds === void 0 ? null : selectedRestoreUnitIds.map((entryId) => String(entryId || "").trim()).filter(Boolean);
    if (requestedRestoreUnitIds !== null && requestedRestoreUnitIds.length === 0) {
      throw badRequest("Restore selection cannot be empty. Select at least one restore item.");
    }
    const duplicateSelectionIds = [];
    const seenSelectionIds = /* @__PURE__ */ new Set();
    for (const restoreUnitId of requestedRestoreUnitIds || []) {
      if (seenSelectionIds.has(restoreUnitId)) {
        duplicateSelectionIds.push(restoreUnitId);
      }
      seenSelectionIds.add(restoreUnitId);
    }
    if (duplicateSelectionIds.length > 0) {
      throw badRequest("Restore selection contains duplicate items.", {
        duplicateRestoreUnitIds: duplicateSelectionIds
      });
    }
    const unknownSelectionIds = (requestedRestoreUnitIds || []).filter((restoreUnitId) => !restoreEntryById.has(restoreUnitId));
    if (unknownSelectionIds.length > 0) {
      throw badRequest("One or more selected restore units were not found in this backup.", {
        restoreUnitIds: unknownSelectionIds
      });
    }
    const selectedEntries = requestedRestoreUnitIds === null ? Array.from(restoreEntryById.values()).filter((entry) => LEGACY_FILE_NAMES.has(entry.fileName) && isEntryRestorable(entry)) : requestedRestoreUnitIds.map((restoreUnitId) => {
      const entry = restoreEntryById.get(restoreUnitId);
      if (!isEntryRestorable(entry)) {
        throw badRequest("One or more selected restore units are not restorable.", {
          restoreUnitId,
          restoreAction: entry?.restoreAction,
          status: entry?.status
        });
      }
      return entry;
    });
    if (selectedEntries.length === 0) {
      throw badRequest("Backup package does not contain restorable Site Builder files.");
    }
    const filesByName = new Map(backupPackage.files.map((file) => [file.name, file]));
    const selectedRestoreUnitSet = new Set(selectedEntries.map((entry) => entry.restoreUnitId));
    const filesToRestore = selectedEntries.filter((entry) => LEGACY_FILE_NAMES.has(entry.fileName)).map((entry) => ({
      entry,
      file: filesByName.get(entry.fileName)
    }));
    filesToRestore.forEach(({ entry, file }) => {
      if (!file) {
        throw badRequest(`Selected restore payload "${entry.fileName}" is missing.`);
      }
      const data = parseFileJson(file);
      const mapping = LEGACY_MAPPINGS.find((candidate) => candidate.fileName === entry.fileName);
      validateLegacyPayload(mapping, data, entry.fileName);
      entry.recordCount = countLegacyRecords(mapping, data);
    });
    const restored = [];
    const failed = [];
    const notSelectedEntries = restoreEntries.filter((entry) => !selectedRestoreUnitSet.has(entry.restoreUnitId));
    const notSelected = notSelectedEntries.map((entry) => ({
      restoreUnitId: entry.restoreUnitId,
      fileName: entry.fileName,
      scope: entry.scope,
      entityId: entry.entityId,
      status: entry.status,
      restoreAction: entry.restoreAction,
      selected: false,
      outcome: "not_selected",
      reason: "not_selected",
      empty: Boolean(entry.empty),
      missing: Boolean(entry.missing),
      invalid: Boolean(entry.invalid)
    }));
    for (const { entry, file } of filesToRestore) {
      try {
        const data = parseFileJson(file);
        let expectedVersion = 0;
        try {
          const current = await this.legacyRepository.readLegacyObject(siteId, file.name);
          expectedVersion = current.version;
        } catch (error) {
          if (error.statusCode !== 404 && error.code !== "not_found") throw error;
        }
        const result = await this.legacyRepository.writeLegacyObject({
          siteId,
          key: file.name,
          data,
          expectedVersion,
          allowEmptyOverwrite: true,
          actor,
          metadata: { ...metadata, backupId, restore: true }
        });
        restored.push({
          restoreUnitId: entry.restoreUnitId,
          fileName: entry.fileName,
          scope: entry.scope,
          entityId: entry.entityId,
          status: entry.status,
          restoreAction: entry.restoreAction,
          recordCount: Number(entry.recordCount || 0),
          key: result.key,
          version: result.version,
          documents: result.documents.length,
          selected: true,
          outcome: "restored",
          clearOrReplace: Boolean(entry.empty)
        });
      } catch (restoreError) {
        failed.push({
          restoreUnitId: entry.restoreUnitId,
          fileName: entry.fileName,
          scope: entry.scope,
          entityId: entry.entityId,
          restoreAction: entry.restoreAction,
          status: entry.status,
          recordCount: Number(entry.recordCount || 0),
          selected: true,
          outcome: "failed",
          message: restoreError?.message || "Restore entry failed."
        });
      }
    }
    const restoredItemCount = restored.length;
    const failedItemCount = failed.length;
    const restoreStatus = failedItemCount > 0 ? restoredItemCount > 0 ? "partial" : "failed" : "completed";
    const selectedRecordCount = selectedEntries.reduce((sum, entry) => sum + (Number(entry.recordCount) || 0), 0);
    const clearOrReplaceActions = restored.filter((entry) => entry.clearOrReplace).map((entry) => ({
      restoreUnitId: entry.restoreUnitId,
      fileName: entry.fileName,
      scope: entry.scope,
      entityId: entry.entityId,
      status: entry.status,
      restoreAction: entry.restoreAction
    }));
    const selectedRestoreUnitIdsOut = requestedRestoreUnitIds === null ? selectedEntries.map((entry) => entry.restoreUnitId) : requestedRestoreUnitIds;
    await this.repository.writeAuditLog({
      siteId,
      documentKey: `backup:${backupId}`,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      operation: "admin-backup-restore",
      result: restoreStatus === "completed" ? "ok" : "partial",
      actor,
      metadata: {
        ...metadata,
        backupId,
        restoreStatus,
        selectedRestoreUnitIds: selectedRestoreUnitIdsOut,
        selectedItems: selectedEntries.map((entry) => ({
          restoreUnitId: entry.restoreUnitId,
          fileName: entry.fileName,
          scope: entry.scope,
          entityId: entry.entityId,
          status: entry.status,
          restoreAction: entry.restoreAction,
          recordCount: Number(entry.recordCount || 0)
        })),
        notSelectedItems: notSelectedEntries.map((entry) => ({
          restoreUnitId: entry.restoreUnitId,
          fileName: entry.fileName,
          scope: entry.scope,
          entityId: entry.entityId,
          status: entry.status,
          restoreAction: entry.restoreAction
        })),
        selectedItemCount: selectedEntries.length,
        restoredItemCount,
        skippedItemCount: notSelected.length,
        failedItemCount,
        selectedRecordCount,
        expectedBackupVersion,
        preRestoreBackupId,
        perItem: [
          ...restored.map((item) => ({
            restoreUnitId: item.restoreUnitId,
            fileName: item.fileName,
            scope: item.scope,
            entityId: item.entityId,
            recordCount: item.recordCount,
            outcome: item.outcome,
            status: item.status,
            restoreAction: item.restoreAction
          })),
          ...notSelected.map((item) => ({
            restoreUnitId: item.restoreUnitId,
            fileName: item.fileName,
            scope: item.scope,
            entityId: item.entityId,
            outcome: item.outcome,
            status: item.status,
            restoreAction: item.restoreAction,
            reason: item.reason
          })),
          ...failed.map((item) => ({
            restoreUnitId: item.restoreUnitId,
            fileName: item.fileName,
            scope: item.scope,
            entityId: item.entityId,
            recordCount: item.recordCount,
            outcome: item.outcome,
            status: item.status,
            restoreAction: item.restoreAction,
            message: item.message
          }))
        ]
      }
    });
    return {
      backup,
      restoreStatus,
      preRestoreBackupId,
      selectedRestoreUnitIds: selectedRestoreUnitIdsOut,
      selectedRestoreUnitCount: selectedRestoreUnitIdsOut.length,
      selectedItemCount: selectedEntries.length,
      selectedRecordCount,
      restoredItemCount,
      failedItemCount,
      skippedItemCount: notSelected.length,
      skippedRecordCount: notSelected.reduce((sum, entry) => sum + (Number(entry.recordCount) || 0), 0),
      notSelectedItems: notSelected,
      clearOrReplaceActions,
      restored,
      failed,
      restoredEntries: restored,
      restoredRecordCount: restored.reduce((sum, entry) => sum + (Number(entry.recordCount) || 0), 0),
      restoredFiles: restoredItemCount,
      failedFiles: failedItemCount,
      selectedRestoreUnits: selectedRestoreUnitIdsOut,
      notSelectedRestoreUnits: notSelected.map((entry) => entry.restoreUnitId)
    };
  }
};

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/borderStyles.js
var DEFAULT_BORDER_TARGETS = {
  commander: true,
  widget: true,
  search: true,
  topNav: false,
  sideNav: false,
  flipCards: true,
  extLinks: false,
  hqDash: false
};

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/colorValidation.js
var LEGACY_EVENT_COLORS = Object.freeze({
  red: "#ef4444",
  gray: "#6b7280"
});

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/smartText.js
var SMART_TEXT_TOKEN_TYPES = Object.freeze({
  text: "text",
  link: "link",
  break: "break"
});
var SMART_LINK_TYPES = Object.freeze({
  url: "url",
  email: "email",
  personalNumber: "personalNumber",
  phone: "phone"
});
var SMART_TEXT_MARKS = Object.freeze({
  bold: "bold",
  italic: "italic",
  underline: "underline"
});
var KNOWN_MARKS = new Set(Object.values(SMART_TEXT_MARKS));

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/widgetDisplay.js
var DEFAULT_ACTIVE_WIDGETS = ["events", "countdown", "polls"];
var DEFAULT_WIDGET_SETTINGS = {
  alerts: { itemsPerView: 3, autoScroll: true, intervalMs: 5e3 },
  outstanding: { itemsPerView: 1, autoScroll: true, intervalMs: 5e3 },
  news: { itemsPerView: 3, autoScroll: true, intervalMs: 5e3 },
  phonebook: { itemsPerView: 4, autoScroll: true, intervalMs: 5e3 },
  shuttles: { itemsPerView: 3, autoScroll: true, intervalMs: 5e3 },
  polls: { itemsPerView: 4, autoScroll: true, intervalMs: 5e3 },
  celebrations: { itemsPerView: 1, autoScroll: true, intervalMs: 5e3 },
  heritage: { itemsPerView: 1, autoScroll: true, intervalMs: 7e3 },
  tips: { itemsPerView: 1, autoScroll: true, intervalMs: 6e3 }
};
function mergeWidgetSettings(rawSettings = {}) {
  const merged = {};
  Object.entries(DEFAULT_WIDGET_SETTINGS).forEach(([key, defaults]) => {
    const candidate = rawSettings?.[key] || {};
    merged[key] = {
      ...defaults,
      ...candidate,
      itemsPerView: Math.max(1, Number(candidate.itemsPerView ?? defaults.itemsPerView) || defaults.itemsPerView),
      autoScroll: candidate.autoScroll ?? defaults.autoScroll,
      intervalMs: Math.max(2e3, Number(candidate.intervalMs ?? defaults.intervalMs) || defaults.intervalMs)
    };
  });
  return merged;
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/navigationModel.js
var NAVIGATION_TARGET_MODES = Object.freeze({
  MANUAL: "manual",
  SHAREPOINT_AUTO: "sharepoint-auto"
});
var NAVIGATION_TARGET_KINDS = Object.freeze({
  URL: "url",
  LIBRARY: "library",
  FOLDER: "folder"
});
var NAVIGATION_MAX_LEVEL = 3;
var NAVIGATION_MAX_FOLDER_DEPTH = NAVIGATION_MAX_LEVEL - 1;
var KNOWN_TARGET_BINDING_KEYS = Object.freeze([
  "version",
  "mode",
  "targetKind",
  "state",
  "serverRelativeUrl",
  "listId",
  "libraryTitle",
  "libraryRootServerRelativeUrl",
  "parentServerRelativeUrl",
  "physicalName",
  "provisionKey"
]);
var KNOWN_TARGET_BINDING_KEY_SET = new Set(KNOWN_TARGET_BINDING_KEYS);

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/imageGallery.js
var IMAGE_GALLERY_STYLES = Object.freeze([
  {
    value: "magal-strips",
    label: "\u05E8\u05E6\u05D5\u05E2\u05D5\u05EA \u05D1\u05EA\u05E0\u05D5\u05E2\u05D4",
    description: "\u05E9\u05D5\u05E8\u05D5\u05EA \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05D6\u05D5\u05D5\u05D9\u05EA\u05D9\u05D5\u05EA \u05D4\u05E0\u05E2\u05D5\u05EA \u05D1\u05E8\u05E6\u05E3 \u05D5\u05D1\u05DB\u05D9\u05D5\u05D5\u05E0\u05D9\u05DD \u05DE\u05E0\u05D5\u05D2\u05D3\u05D9\u05DD."
  },
  {
    value: "classic-carousel",
    label: "\u05E7\u05E8\u05D5\u05E1\u05DC\u05D4 \u05E7\u05DC\u05D0\u05E1\u05D9\u05EA",
    description: "\u05EA\u05DE\u05D5\u05E0\u05D4 \u05E8\u05D0\u05E9\u05D9\u05EA, \u05DB\u05E4\u05EA\u05D5\u05E8\u05D9 \u05E0\u05D9\u05D5\u05D5\u05D8 \u05D5\u05E0\u05E7\u05D5\u05D3\u05D5\u05EA \u05DE\u05E2\u05D1\u05E8."
  },
  {
    value: "center-carousel",
    label: "\u05E7\u05E8\u05D5\u05E1\u05DC\u05D4 \u05DE\u05DE\u05D5\u05E7\u05D3\u05EA",
    description: "\u05D4\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D4\u05E4\u05E2\u05D9\u05DC\u05D4 \u05D1\u05DE\u05E8\u05DB\u05D6 \u05D5\u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05E9\u05DB\u05E0\u05D5\u05EA \u05E0\u05E9\u05D0\u05E8\u05D5\u05EA \u05D2\u05DC\u05D5\u05D9\u05D5\u05EA."
  },
  {
    value: "coverflow",
    label: "\u05DB\u05E8\u05D8\u05D9\u05E1\u05D9 \u05E2\u05D5\u05DE\u05E7",
    description: "\u05DB\u05E8\u05D8\u05D9\u05E1\u05D9\u05DD \u05DE\u05D3\u05D5\u05E8\u05D2\u05D9\u05DD \u05E2\u05DD \u05D3\u05D2\u05E9 \u05D1\u05E8\u05D5\u05E8 \u05E2\u05DC \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D4\u05E4\u05E2\u05D9\u05DC\u05D4."
  },
  {
    value: "masonry",
    label: "\u05D2\u05E8\u05D9\u05D3 \u05E4\u05E1\u05D9\u05E4\u05E1",
    description: "\u05E4\u05E8\u05D9\u05E1\u05D4 \u05D2\u05DE\u05D9\u05E9\u05D4; \u05DC\u05D7\u05D9\u05E6\u05D4 \u05E4\u05D5\u05EA\u05D7\u05EA \u05EA\u05E6\u05D5\u05D2\u05D4 \u05DE\u05D5\u05D2\u05D3\u05DC\u05EA."
  }
]);
var IMAGE_GALLERY_STYLE_VALUES = Object.freeze(IMAGE_GALLERY_STYLES.map((style) => style.value));
var DEFAULT_MAGAL_STRIPS_SETTINGS = Object.freeze({
  rowCount: 2,
  cardSizePx: 180,
  gapPx: 12,
  rows: Object.freeze([
    Object.freeze({ id: "row-1", direction: "left", durationSeconds: 34, angleDegrees: 3 }),
    Object.freeze({ id: "row-2", direction: "right", durationSeconds: 40, angleDegrees: -3 }),
    Object.freeze({ id: "row-3", direction: "left", durationSeconds: 38, angleDegrees: 2 }),
    Object.freeze({ id: "row-4", direction: "right", durationSeconds: 44, angleDegrees: -2 })
  ])
});

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/config/siteBuilderContract.js
var SITE_BUILDER_DATA_SCHEMA_VERSION = "1.0.0";

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/commanderImage.js
var COMMANDER_IMAGE_SCALE = {
  min: 25,
  max: 300,
  defaultValue: 100
};
var COMMANDER_IMAGE_OFFSET_X = {
  min: -160,
  max: 160,
  defaultValue: 0
};
var COMMANDER_IMAGE_OFFSET_Y = {
  min: -160,
  max: 160,
  defaultValue: 0
};
var DEFAULT_COMMANDER_IMAGE_PATH = "/images/\u05D0\u05D9\u05D9\u05DC \u05D6\u05DE\u05D9\u05E8.png";
var COMMANDER_IMAGE_SOURCE = Object.freeze({
  custom: "custom",
  default: "default",
  none: "none",
  builtin: "builtin"
});
var COMMANDER_BUILTIN_AVATARS = Object.freeze([
  { id: "slate", label: "\u05D3\u05DE\u05D5\u05EA \u05D1\u05D2\u05D5\u05D5\u05DF \u05DB\u05D7\u05D5\u05DC", path: "/images/commander-avatars/commander-slate.svg" },
  { id: "navy", label: "\u05D3\u05DE\u05D5\u05EA \u05D1\u05D2\u05D5\u05D5\u05DF \u05DB\u05D4\u05D4", path: "/images/commander-avatars/commander-navy.svg" },
  { id: "teal", label: "\u05D3\u05DE\u05D5\u05EA \u05D1\u05D2\u05D5\u05D5\u05DF \u05D8\u05D5\u05E8\u05E7\u05D9\u05D6", path: "/images/commander-avatars/commander-teal.svg" },
  { id: "sand", label: "\u05D3\u05DE\u05D5\u05EA \u05D1\u05D2\u05D5\u05D5\u05DF \u05D7\u05D5\u05DC", path: "/images/commander-avatars/commander-sand.svg" }
]);
var BUILTIN_BY_ID = new Map(COMMANDER_BUILTIN_AVATARS.map((avatar) => [avatar.id, avatar]));
var BUILTIN_BY_PATH = new Map(COMMANDER_BUILTIN_AVATARS.map((avatar) => [avatar.path, avatar]));

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/config/AppSchema.js
var SCHEMA_VERSION = SITE_BUILDER_DATA_SCHEMA_VERSION;
var VALID_BORDER_STYLES = ["standard", "square", "cyber", "armor", "shield", "blade"];
var VALID_OVERLAY_BORDER_STYLES = ["none", ...VALID_BORDER_STYLES];
var VALID_WIDGET_IDS = [
  "events",
  "alerts",
  "outstanding",
  "countdown",
  "news",
  "phonebook",
  "shuttles",
  "polls",
  "celebrations",
  "heritage",
  "tips"
];
var VALID_WIDGET_ID_SET = new Set(VALID_WIDGET_IDS);
var DEFAULT_CONFIG_V1 = {
  schemaVersion: SCHEMA_VERSION,
  meta: {
    appId: "siteBuilder",
    migratedFromLegacy: false,
    lastUpdatedAt: null,
    lastUpdatedBy: null
  },
  theme: {
    primaryColor: "#0891b2",
    displayMode: "user-toggle",
    borderStyle: "cyber",
    borderTargets: {
      ...DEFAULT_BORDER_TARGETS
    },
    backgrounds: {
      tinted: {
        enabled: true,
        strength: 72
      },
      hero: {
        grayscale: false,
        glassEffect: false,
        glassStrength: 58
      },
      navbar: {
        glassEffect: true,
        glassStrength: 1
      }
    }
  },
  layout: {
    navigation: {
      showCategories: false,
      mode: "sidebar-right"
    },
    hero: {
      widgetHeight: "full",
      panelsBordered: true,
      commanderPanelBordered: false,
      widgetPanelBordered: true
    },
    externalLinks: {
      mode: "cards",
      fixed: false,
      bordered: true,
      showBackground: true
    }
  },
  navigation: {
    items: [
      {
        id: "training",
        label: "\u05D4\u05DB\u05E9\u05E8\u05D5\u05EA",
        icon: "GraduationCap",
        url: "",
        children: [
          {
            id: "training-courses",
            label: "\u05DC\u05D5\u05D7\u05D5\u05EA \u05D4\u05DB\u05E9\u05E8\u05D4",
            icon: "CalendarDays",
            url: "",
            children: [
              {
                id: "training-courses-trainees",
                label: "\u05D7\u05E0\u05D9\u05DB\u05D9 \u05D4\u05E7\u05D5\u05E8\u05E1",
                icon: "Users",
                url: "#",
                children: []
              },
              {
                id: "training-courses-gantt",
                label: "\u05D2\u05D0\u05E0\u05D8 \u05D4\u05E7\u05D5\u05E8\u05E1",
                icon: "Calendar",
                url: "#",
                children: []
              },
              {
                id: "training-courses-drills",
                label: "\u05D0\u05D9\u05DE\u05D5\u05E0\u05D9\u05DD",
                icon: "Target",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "training-materials",
            label: "\u05D7\u05D5\u05DE\u05E8\u05D9 \u05DC\u05D9\u05DE\u05D5\u05D3",
            icon: "BookOpen",
            url: "",
            children: [
              {
                id: "training-materials-lessons",
                label: "\u05DE\u05E2\u05E8\u05DB\u05D9 \u05E9\u05D9\u05E2\u05D5\u05E8",
                icon: "FileText",
                url: "#",
                children: []
              },
              {
                id: "training-materials-tests",
                label: "\u05DE\u05D1\u05D7\u05E0\u05D9\u05DD \u05D5\u05E1\u05D9\u05DB\u05D5\u05DE\u05D9\u05DD",
                icon: "ClipboardList",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "training-staff",
            label: "\u05E1\u05D2\u05DC \u05D4\u05DB\u05E9\u05E8\u05D4",
            icon: "Users",
            url: "",
            children: [
              {
                id: "training-staff-commanders",
                label: "\u05DE\u05E4\u05E7\u05D3\u05D9 \u05E7\u05D5\u05E8\u05E1\u05D9\u05DD",
                icon: "User",
                url: "#",
                children: []
              },
              {
                id: "training-staff-instructors",
                label: "\u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD",
                icon: "Users",
                url: "#",
                children: []
              }
            ]
          }
        ]
      },
      {
        id: "ops",
        label: '\u05D0\u05D2"\u05DD',
        icon: "ShieldCheck",
        url: "",
        children: [
          {
            id: "ops-orders",
            label: "\u05E4\u05E7\u05D5\u05D3\u05D5\u05EA \u05D5\u05E2\u05D3\u05DB\u05D5\u05E0\u05D9\u05DD",
            icon: "ClipboardList",
            url: "",
            children: [
              {
                id: "ops-orders-daily",
                label: "\u05E4\u05E7\u05D5\u05D3\u05D5\u05EA \u05D9\u05D5\u05DE\u05D9\u05D5\u05EA",
                icon: "FileText",
                url: "#",
                children: []
              },
              {
                id: "ops-orders-weekly",
                label: "\u05D4\u05E0\u05D7\u05D9\u05D5\u05EA \u05E9\u05D1\u05D5\u05E2\u05D9\u05D5\u05EA",
                icon: "Calendar",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "ops-readiness",
            label: "\u05DB\u05E9\u05D9\u05E8\u05D5\u05EA \u05DE\u05D1\u05E6\u05E2\u05D9\u05EA",
            icon: "Target",
            url: "",
            children: [
              {
                id: "ops-readiness-trainings",
                label: "\u05DB\u05E9\u05D9\u05E8\u05D5\u05EA \u05E6\u05D5\u05D5\u05EA\u05D9\u05DD",
                icon: "Users",
                url: "#",
                children: []
              },
              {
                id: "ops-readiness-drills",
                label: "\u05EA\u05E8\u05D2\u05D5\u05DC\u05D5\u05EA \u05D7\u05D5\u05D3\u05E9\u05D9\u05D5\u05EA",
                icon: "Target",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "ops-briefings",
            label: "\u05EA\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD \u05DE\u05D1\u05E6\u05E2\u05D9\u05D9\u05DD",
            icon: "FileText",
            url: "",
            children: [
              {
                id: "ops-briefings-morning",
                label: "\u05EA\u05D3\u05E8\u05D9\u05DA \u05D1\u05D5\u05E7\u05E8",
                icon: "CalendarDays",
                url: "#",
                children: []
              },
              {
                id: "ops-briefings-special",
                label: "\u05EA\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD \u05DE\u05D9\u05D5\u05D7\u05D3\u05D9\u05DD",
                icon: "AlertTriangle",
                url: "#",
                children: []
              }
            ]
          }
        ]
      },
      {
        id: "hq",
        label: "\u05DE\u05E4\u05E7\u05D3\u05D4",
        icon: "Building2",
        url: "",
        children: [
          {
            id: "hq-hr",
            label: "\u05DB\u05D7 \u05D0\u05D3\u05DD",
            icon: "Users",
            url: "",
            children: [
              {
                id: "hq-hr-leave",
                label: "\u05D8\u05E4\u05E1\u05D9 \u05D7\u05D5\u05E4\u05E9\u05D4",
                icon: "FileText",
                url: "#",
                children: []
              },
              {
                id: "hq-hr-contacts",
                label: "\u05D0\u05E0\u05E9\u05D9 \u05E7\u05E9\u05E8",
                icon: "Users",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "hq-logistics",
            label: "\u05DC\u05D5\u05D2\u05D9\u05E1\u05D8\u05D9\u05E7\u05D4",
            icon: "Package",
            url: "",
            children: [
              {
                id: "hq-logistics-inventory",
                label: "\u05DE\u05DC\u05D0\u05D9 \u05D5\u05E6\u05D9\u05D5\u05D3",
                icon: "Package",
                url: "#",
                children: []
              },
              {
                id: "hq-logistics-transports",
                label: "\u05E9\u05D9\u05E0\u05D5\u05E2 \u05D5\u05D4\u05E1\u05E2\u05D5\u05EA",
                icon: "Truck",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "hq-admin",
            label: "\u05DE\u05E0\u05D4\u05DC\u05D4",
            icon: "Briefcase",
            url: "",
            children: [
              {
                id: "hq-admin-forms",
                label: "\u05D8\u05E4\u05E1\u05D9\u05DD \u05DE\u05E0\u05D4\u05DC\u05EA\u05D9\u05D9\u05DD",
                icon: "FileText",
                url: "#",
                children: []
              },
              {
                id: "hq-admin-procedures",
                label: "\u05E0\u05D4\u05DC\u05D9\u05DD",
                icon: "ClipboardList",
                url: "#",
                children: []
              }
            ]
          }
        ]
      },
      {
        id: "unit-graph",
        label: "\u05D2\u05E8\u05E3 \u05D9\u05D7\u05D9\u05D3\u05D4",
        icon: "BarChart",
        url: "",
        children: [
          {
            id: "unit-graph-org",
            label: "\u05DE\u05D1\u05E0\u05D4 \u05D0\u05E8\u05D2\u05D5\u05E0\u05D9",
            icon: "BarChart",
            url: "",
            children: [
              {
                id: "unit-graph-org-command",
                label: "\u05D3\u05E8\u05D2 \u05E4\u05D9\u05E7\u05D5\u05D3\u05D9",
                icon: "Users",
                url: "#",
                children: []
              },
              {
                id: "unit-graph-org-sections",
                label: "\u05DE\u05D3\u05D5\u05E8\u05D9\u05DD \u05D5\u05E6\u05D5\u05D5\u05EA\u05D9\u05DD",
                icon: "Folder",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "unit-graph-kpis",
            label: "\u05DE\u05D3\u05D3\u05D9 \u05D1\u05D9\u05E6\u05D5\u05E2",
            icon: "Target",
            url: "",
            children: [
              {
                id: "unit-graph-kpis-training",
                label: "\u05DE\u05D3\u05D3\u05D9 \u05D4\u05DB\u05E9\u05E8\u05D4",
                icon: "GraduationCap",
                url: "#",
                children: []
              },
              {
                id: "unit-graph-kpis-readiness",
                label: "\u05DE\u05D3\u05D3\u05D9 \u05DB\u05E9\u05D9\u05E8\u05D5\u05EA",
                icon: "ShieldCheck",
                url: "#",
                children: []
              }
            ]
          }
        ]
      },
      {
        id: "core-files",
        label: "\u05EA\u05D9\u05E7\u05D9 \u05D9\u05E1\u05D5\u05D3",
        icon: "Briefcase",
        url: "",
        children: [
          {
            id: "core-files-procedures",
            label: "\u05E4\u05E7\u05D5\u05D3\u05D5\u05EA \u05D5\u05E0\u05D4\u05DC\u05D9\u05DD",
            icon: "FileText",
            url: "",
            children: [
              {
                id: "core-files-procedures-safety",
                label: "\u05E0\u05D4\u05DC\u05D9 \u05D1\u05D8\u05D9\u05D7\u05D5\u05EA",
                icon: "AlertTriangle",
                url: "#",
                children: []
              },
              {
                id: "core-files-procedures-routine",
                label: "\u05E0\u05D4\u05DC\u05D9 \u05E9\u05D2\u05E8\u05D4",
                icon: "ClipboardList",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "core-files-knowledge",
            label: "\u05DE\u05D0\u05D2\u05E8 \u05D9\u05D3\u05E2",
            icon: "BookOpen",
            url: "",
            children: [
              {
                id: "core-files-knowledge-lessons",
                label: "\u05DC\u05E7\u05D7\u05D9\u05DD",
                icon: "FileText",
                url: "#",
                children: []
              },
              {
                id: "core-files-knowledge-templates",
                label: "\u05EA\u05D1\u05E0\u05D9\u05D5\u05EA",
                icon: "Folder",
                url: "#",
                children: []
              }
            ]
          }
        ]
      },
      {
        id: "safety",
        label: "\u05D1\u05D8\u05D9\u05D7\u05D5\u05EA",
        icon: "AlertTriangle",
        url: "",
        children: [
          {
            id: "safety-routines",
            label: "\u05E0\u05D4\u05DC\u05D9 \u05D1\u05D8\u05D9\u05D7\u05D5\u05EA",
            icon: "ShieldCheck",
            url: "",
            children: [
              {
                id: "safety-routines-base",
                label: "\u05D1\u05D8\u05D9\u05D7\u05D5\u05EA \u05E9\u05D2\u05E8\u05D4",
                icon: "FileText",
                url: "#",
                children: []
              },
              {
                id: "safety-routines-training",
                label: "\u05D1\u05D8\u05D9\u05D7\u05D5\u05EA \u05D1\u05D0\u05D9\u05DE\u05D5\u05DF",
                icon: "Target",
                url: "#",
                children: []
              }
            ]
          },
          {
            id: "safety-emergency",
            label: "\u05D7\u05D9\u05E8\u05D5\u05DD \u05D5\u05D7\u05D9\u05DC\u05D5\u05E5",
            icon: "AlertTriangle",
            url: "",
            children: [
              {
                id: "safety-emergency-contacts",
                label: "\u05D0\u05E0\u05E9\u05D9 \u05E7\u05E9\u05E8 \u05DC\u05D7\u05D9\u05E8\u05D5\u05DD",
                icon: "Users",
                url: "#",
                children: []
              },
              {
                id: "safety-emergency-protocols",
                label: "\u05E0\u05D5\u05D4\u05DC\u05D9 \u05E4\u05D9\u05E0\u05D5\u05D9",
                icon: "FileText",
                url: "#",
                children: []
              }
            ]
          }
        ]
      }
    ]
  },
  content: {
    hero: {
      siteName: '\u05DE\u05EA\u05E0"\u05D4',
      title: '  \u05DE\u05EA\u05E0"\u05D4  \n \u05D1\u05D5\u05E0\u05D4 \u05D4\u05D0\u05EA\u05E8\u05D9\u05DD  ',
      subtitle: "\u05DE\u05E2\u05E8\u05DB\u05EA \u05EA\u05D1\u05E0\u05D9\u05D5\u05EA \u05DC\u05E0\u05D9\u05D4\u05D5\u05DC \u05D4\u05D9\u05D3\u05E2",
      logoUrl: "/images/gift.svg",
      description: '\u05DE\u05E8\u05DB\u05D6 \u05D4\u05E4\u05D9\u05EA\u05D5\u05D7 \u05D4\u05DE\u05D5\u05D1\u05D9\u05DC \u05D1\u05E6\u05D4"\u05DC \u05DC\u05E4\u05D9\u05EA\u05D5\u05D7 \u05DE\u05E2\u05E8\u05DB\u05D5\u05EA \u05DE\u05D1\u05E6\u05E2\u05D9\u05D5\u05EA, \u05D8\u05DB\u05E0\u05D5\u05DC\u05D5\u05D2\u05D9\u05D5\u05EA \u05D5\u05E4\u05D9\u05E7\u05D5\u05D3\u05D9\u05D5\u05EA.',
      backgroundImageUrls: [
        "/images/\u05DC\u05D74.webp",
        "/images/\u05DC\u05D73.jpg",
        "/images/\u05DC\u05D76.webp",
        "/images/idf-tank_enhanced.png",
        "/images/IDFsoldiers.jpeg"
      ]
    },
    commander: {
      imageUrl: DEFAULT_COMMANDER_IMAGE_PATH,
      imageSource: "default",
      imageAvatar: "",
      customImageUrl: "",
      imageScale: COMMANDER_IMAGE_SCALE.defaultValue,
      imageOffsetX: COMMANDER_IMAGE_OFFSET_X.defaultValue,
      imageOffsetY: COMMANDER_IMAGE_OFFSET_Y.defaultValue,
      sectionTitle: "\u05D3\u05D1\u05E8 \u05D4\u05DE\u05E4\u05E7\u05D3",
      roleLabel: "\u05DE\u05E4\u05E7\u05D3 \u05E6\u05D5\u05D5\u05EA \u05D0\u05DC\u05E4\u05D0 ",
      decorativeElement: "line-diamond-line",
      messages: [
        {
          id: "1",
          text: "\u05D1\u05D9\u05EA \u05D4\u05E1\u05E4\u05E8 \u05D4\u05D5\u05D0 \u05DC\u05D1 \u05D4\u05DE\u05E6\u05D5\u05D9\u05E0\u05D5\u05EA \u05D4\u05DE\u05D1\u05E6\u05E2\u05D9\u05EA \u05D5\u05D4\u05D8\u05DB\u05E0\u05D5\u05DC\u05D5\u05D2\u05D9\u05EA \u05E9\u05DC\u05E0\u05D5. \u05E0\u05DE\u05E9\u05D9\u05DA \u05DC\u05E4\u05EA\u05D7 \u05D3\u05D5\u05E8 \u05DE\u05E4\u05E7\u05D3\u05D9\u05DD \u05DE\u05E7\u05E6\u05D5\u05E2\u05D9, \u05E2\u05E8\u05DB\u05D9 \u05D5\u05D9\u05D5\u05D6\u05DD.",
          signature: '\u05D0\u05DC"\u05DD \u05D0\u05F3 | \u05DE\u05E4\u05E7\u05D3 \u05D1\u05D4\u05F4\u05E1 \u05E6\u05D5\u05D5\u05EA \u05D0\u05DC\u05E4\u05D0'
        },
        {
          id: "2",
          text: "\u05D4\u05D4\u05D5\u05DF \u05D4\u05D0\u05E0\u05D5\u05E9\u05D9 \u05D4\u05D5\u05D0 \u05D4\u05DB\u05D5\u05D7 \u05D4\u05DE\u05E8\u05DB\u05D6\u05D9 \u05E9\u05DC\u05E0\u05D5. \u05E9\u05DE\u05E8\u05D5 \u05E2\u05DC \u05D7\u05EA\u05D9\u05E8\u05D4 \u05DC\u05DE\u05E6\u05D5\u05D9\u05E0\u05D5\u05EA, \u05DC\u05DE\u05D9\u05D3\u05D4 \u05DE\u05EA\u05DE\u05D3\u05EA \u05D5\u05E8\u05D5\u05D7 \u05E6\u05D5\u05D5\u05EA.",
          signature: '\u05D0\u05DC"\u05DD \u05D0\u05F3 | \u05DE\u05E4\u05E7\u05D3 \u05D1\u05D4\u05F4\u05E1 \u05E6\u05D5\u05D5\u05EA \u05D0\u05DC\u05E4\u05D0'
        }
      ]
    },
    overlayImage: {
      enabled: false,
      imageUrl: "",
      width: 240,
      height: 180,
      opacity: 100,
      objectFit: "contain",
      borderStyle: "standard",
      positionMode: "fixed",
      displayArea: "fixed-site",
      anchor: "bottom-left",
      offsetX: 28,
      offsetY: -28,
      zIndex: 180,
      blendEffect: true
    },
    orgChart: {
      enabled: false,
      pageTitle: "\u05E2\u05E5 \u05DE\u05D1\u05E0\u05D4 \u05D9\u05D7\u05D9\u05D3\u05EA\u05D9",
      layoutDirection: "flow-canvas",
      cardStyle: "classic",
      lineStyle: "solid",
      avatarShape: "circle",
      graph3d: {
        initialExpandLevels: 1,
        linkDistance: 180,
        nodeStrength: -220,
        minDistance: 160,
        maxDistance: 12e3,
        labelType: "all",
        layoutType: "forceDirected3d",
        cameraMode: "rotate",
        edgeInterpolation: "curved",
        edgeArrowPosition: "end",
        edgeLabelPosition: "natural",
        draggable: false,
        animated: true,
        aggregateEdges: false,
        defaultNodeSize: 9,
        minNodeSize: 6,
        maxNodeSize: 18,
        minZoom: 1,
        maxZoom: 100
      },
      flowCanvas: {
        edgeType: "smoothstep",
        edgeAnimated: true,
        edgeOpacityPercent: 88,
        edgeStrokeWidth: 2,
        backgroundVariant: "dots",
        backgroundGap: 18,
        backgroundSize: 1,
        showMiniMap: true,
        miniMapPannable: true,
        miniMapZoomable: false,
        showControls: true,
        showControlZoom: true,
        showControlFitView: true,
        showControlInteractive: false,
        controlsOrientation: "vertical",
        viewportMode: "map",
        panOnScroll: false,
        zoomOnDoubleClick: true,
        snapToGrid: false,
        snapGridX: 20,
        snapGridY: 20,
        fitViewPaddingPercent: 24,
        onlyRenderVisibleElements: false,
        nodeVisualStyle: "command",
        hierarchySizing: true,
        rootScalePercent: 112,
        levelScaleStepPercent: 6,
        minScalePercent: 84,
        showRank: true,
        showRole: true,
        showAvatar: true,
        autoLayoutDirection: "center"
      },
      nodePositions: {},
      nodes: [
        {
          id: "org-root-hq",
          name: "\u05DE\u05E4\u05E7\u05D3\u05EA \u05D1\u05D9\u05EA \u05D4\u05E1\u05E4\u05E8",
          rank: '\u05D0\u05DC"\u05DD',
          role: "\u05DE\u05E4\u05E7\u05D3\u05EA \u05D4\u05D9\u05D7\u05D9\u05D3\u05D4",
          imageUrl: "",
          children: [
            {
              id: "org-root-hq-training",
              name: "\u05DE\u05D3\u05D5\u05E8 \u05D4\u05DB\u05E9\u05E8\u05D5\u05EA",
              rank: '\u05E8\u05E1"\u05DF',
              role: "\u05D4\u05D5\u05D1\u05DC\u05EA \u05EA\u05D5\u05DB\u05E0\u05D9\u05D5\u05EA \u05D4\u05DB\u05E9\u05E8\u05D4",
              imageUrl: "",
              children: []
            },
            {
              id: "org-root-hq-ops",
              name: '\u05DE\u05D3\u05D5\u05E8 \u05D0\u05D2"\u05DD',
              rank: '\u05E8\u05E1"\u05DF',
              role: "\u05EA\u05DB\u05E0\u05D5\u05DF \u05D5\u05D1\u05E7\u05E8\u05D4 \u05DE\u05D1\u05E6\u05E2\u05D9\u05EA",
              imageUrl: "",
              children: []
            },
            {
              id: "org-root-hq-logistics",
              name: "\u05DE\u05D3\u05D5\u05E8 \u05DC\u05D5\u05D2\u05D9\u05E1\u05D8\u05D9\u05E7\u05D4",
              rank: '\u05E8\u05E1"\u05DF',
              role: "\u05E6\u05D9\u05D5\u05D3, \u05E9\u05D9\u05E0\u05D5\u05E2 \u05D5\u05EA\u05DE\u05D9\u05DB\u05D4",
              imageUrl: "",
              children: []
            }
          ]
        }
      ]
    }
  },
  widgets: {
    active: [...DEFAULT_ACTIVE_WIDGETS],
    carousel: {
      rotationIntervalSeconds: 8
    },
    display: {
      alerts: { itemsPerView: 3, autoScroll: true, intervalMs: 5e3 },
      outstanding: { itemsPerView: 1, autoScroll: true, intervalMs: 5e3 },
      news: { itemsPerView: 3, autoScroll: true, intervalMs: 5e3 },
      phonebook: { itemsPerView: 4, autoScroll: true, intervalMs: 5e3 },
      shuttles: { itemsPerView: 3, autoScroll: true, intervalMs: 5e3 },
      polls: { itemsPerView: 4, autoScroll: true, intervalMs: 5e3 },
      celebrations: { itemsPerView: 1, autoScroll: true, intervalMs: 5e3 },
      heritage: { itemsPerView: 1, autoScroll: true, intervalMs: 7e3 },
      tips: { itemsPerView: 1, autoScroll: true, intervalMs: 6e3 }
    },
    data: {
      events: {
        displayCount: 3,
        displayMode: "default",
        intervalMs: 6e3,
        items: [
          {
            id: "ev-1",
            date: "2026-03-25",
            title: "\u05DB\u05E0\u05E1 \u05DE\u05E4\u05E7\u05D3\u05D9\u05DD",
            subtitle: "\u05D0\u05D5\u05DC\u05DD \u05DE\u05E8\u05DB\u05D6\u05D9 | 09:00",
            color: "red"
          },
          {
            id: "ev-2",
            date: "2026-03-28",
            title: "\u05D9\u05D5\u05DD \u05DB\u05E9\u05D9\u05E8\u05D5\u05EA \u05E6\u05D5\u05D5\u05EA\u05D9\u05DD",
            subtitle: "\u05E8\u05D7\u05D1\u05EA \u05D0\u05D9\u05DE\u05D5\u05E0\u05D9\u05DD | 07:30",
            color: "gray"
          },
          {
            id: "ev-3",
            date: "2026-04-01",
            title: "\u05EA\u05D3\u05E8\u05D9\u05DA \u05E4\u05EA\u05D9\u05D7\u05EA \u05DE\u05D7\u05D6\u05D5\u05E8",
            subtitle: "\u05D1\u05E0\u05D9\u05D9\u05DF \u05D4\u05D3\u05E8\u05DB\u05D4 | 10:00",
            color: "gray"
          }
        ]
      },
      alerts: {
        items: [
          {
            id: "al-1",
            title: "\u05D1\u05D9\u05E7\u05D5\u05E8\u05EA \u05DB\u05D5\u05E9\u05E8 \u05E8\u05D1\u05E2\u05D5\u05E0\u05D9\u05EA",
            text: "\u05DB\u05DC\u05DC \u05DE\u05E9\u05E8\u05EA\u05D9 \u05D4\u05D9\u05D7\u05D9\u05D3\u05D4 \u05E0\u05D3\u05E8\u05E9\u05D9\u05DD \u05DC\u05D4\u05E9\u05DC\u05D9\u05DD \u05DE\u05D3\u05D3\u05D9 \u05DB\u05D5\u05E9\u05E8 \u05E2\u05D3 \u05D9\u05D5\u05DD \u05D7\u05DE\u05D9\u05E9\u05D9.",
            isUrgent: true
          },
          {
            id: "al-2",
            title: "\u05E2\u05D3\u05DB\u05D5\u05DF \u05E0\u05D4\u05DC\u05D9 \u05D0\u05D1\u05D8\u05D7\u05D4",
            text: "\u05D4\u05D7\u05DC \u05DE\u05D4\u05E9\u05D1\u05D5\u05E2 \u05D7\u05D5\u05D1\u05D4 \u05DC\u05E9\u05D0\u05EA \u05EA\u05D2 \u05D6\u05D9\u05D4\u05D5\u05D9 \u05D1\u05DB\u05DC \u05DE\u05E2\u05D1\u05E8 \u05D1\u05D9\u05DF \u05DE\u05EA\u05D7\u05DE\u05D9\u05DD.",
            isUrgent: false
          }
        ]
      },
      outstanding: {
        items: [
          {
            id: "out-1",
            name: "\u05E8\u05E1\u05F4\u05DC \u05E0\u05D8\u05E2 \u05DB\u05D4\u05DF",
            role: "\u05DE\u05D3\u05E8\u05D9\u05DB\u05EA \u05E7\u05D5\u05E8\u05E1 \u05DC\u05D9\u05D1\u05D4",
            imageUrl: "/images/\u05E4\u05D5\u05E8\u05D8\u05E8\u05D8.png",
            description: "\u05D4\u05D5\u05D1\u05D9\u05DC\u05D4 \u05EA\u05D4\u05DC\u05D9\u05DA \u05D4\u05D8\u05DE\u05E2\u05EA \u05EA\u05D5\u05DB\u05E0\u05D9\u05EA \u05DC\u05D9\u05DE\u05D5\u05D3 \u05D7\u05D3\u05E9\u05D4 \u05D5\u05E9\u05D9\u05E4\u05E8\u05D4 \u05D0\u05EA \u05E6\u05D9\u05D5\u05E0\u05D9 \u05D4\u05DE\u05D7\u05D6\u05D5\u05E8 \u05D1\u05D0\u05D5\u05E4\u05DF \u05DE\u05E9\u05DE\u05E2\u05D5\u05EA\u05D9."
          },
          {
            id: "out-2",
            name: "\u05E1\u05DE\u05F4\u05E8 \u05D9\u05D5\u05D0\u05D1 \u05DC\u05D5\u05D9",
            role: "\u05DE\u05E4\u05E7\u05D3 \u05E6\u05D5\u05D5\u05EA \u05D4\u05D3\u05E8\u05DB\u05D4",
            imageUrl: "/images/\u05E4\u05D5\u05E8\u05D8\u05E8\u05D8.png",
            description: "\u05E7\u05D9\u05D3\u05DD \u05EA\u05E8\u05D2\u05D5\u05DC\u05D5\u05EA \u05DE\u05E7\u05E6\u05D5\u05E2\u05D9\u05D5\u05EA \u05D5\u05D4\u05E6\u05D8\u05D9\u05D9\u05DF \u05D1\u05D4\u05D5\u05D1\u05DC\u05EA \u05D4\u05D7\u05E0\u05D9\u05DB\u05D9\u05DD \u05DC\u05DE\u05E6\u05D5\u05D9\u05E0\u05D5\u05EA \u05DE\u05D1\u05E6\u05E2\u05D9\u05EA."
          }
        ]
      },
      countdown: {
        title: "\u05E4\u05EA\u05D9\u05D7\u05EA \u05DE\u05D7\u05D6\u05D5\u05E8 \u05D0\u05D1\u05D9\u05D1",
        targetDate: "2026-05-10T08:00:00+03:00",
        showDetails: true,
        details: "\u05E1\u05E4\u05D9\u05E8\u05D4 \u05E8\u05E9\u05DE\u05D9\u05EA \u05DC\u05E4\u05EA\u05D9\u05D7\u05EA \u05DE\u05D7\u05D6\u05D5\u05E8 \u05D4\u05D0\u05D1\u05D9\u05D1 \u05D4\u05E7\u05E8\u05D5\u05D1.",
        switchIntervalSeconds: 8,
        activeItemId: "cd-1",
        items: [
          {
            id: "cd-1",
            title: "\u05E4\u05EA\u05D9\u05D7\u05EA \u05DE\u05D7\u05D6\u05D5\u05E8 \u05D0\u05D1\u05D9\u05D1",
            targetDate: "2026-05-10T08:00:00+03:00",
            showDetails: true,
            details: "\u05E1\u05E4\u05D9\u05E8\u05D4 \u05E8\u05E9\u05DE\u05D9\u05EA \u05DC\u05E4\u05EA\u05D9\u05D7\u05EA \u05DE\u05D7\u05D6\u05D5\u05E8 \u05D4\u05D0\u05D1\u05D9\u05D1 \u05D4\u05E7\u05E8\u05D5\u05D1."
          }
        ]
      },
      news: {
        items: [
          {
            id: "news-1",
            text: "\u05D4\u05D7\u05DC \u05D4\u05E9\u05D1\u05D5\u05E2: \u05D4\u05E8\u05D7\u05D1\u05EA \u05DE\u05E2\u05E8\u05DA \u05D4\u05DC\u05DE\u05D9\u05D3\u05D4 \u05D4\u05D3\u05D9\u05D2\u05D9\u05D8\u05DC\u05D9\u05EA \u05DC\u05DB\u05DC\u05DC \u05DE\u05E1\u05DC\u05D5\u05DC\u05D9 \u05D4\u05D4\u05DB\u05E9\u05E8\u05D4.",
            isUrgent: false
          },
          {
            id: "news-2",
            text: "\u05EA\u05E8\u05D2\u05D9\u05DC \u05D9\u05D7\u05D9\u05D3\u05EA\u05D9 \u05E8\u05D7\u05D1 \u05D9\u05EA\u05E7\u05D9\u05D9\u05DD \u05D1\u05D9\u05D5\u05DD \u05E8\u05D1\u05D9\u05E2\u05D9 \u05D4\u05E7\u05E8\u05D5\u05D1 - \u05D9\u05E9 \u05DC\u05D4\u05EA\u05E2\u05D3\u05DB\u05DF \u05D1\u05D4\u05E0\u05D7\u05D9\u05D5\u05EA \u05D4\u05DE\u05D5\u05E7\u05D3\u05DE\u05D5\u05EA.",
            isUrgent: true
          }
        ]
      },
      phonebook: {
        items: [
          {
            id: "ph-1",
            name: "\u05D7\u05DE\u05F4\u05DC \u05EA\u05D5\u05E8\u05DF",
            number: "08-9991000",
            department: "\u05D0\u05D2\u05F4\u05DD"
          },
          {
            id: "ph-2",
            name: "\u05E7\u05E6\u05D9\u05E0\u05EA \u05EA\u05F4\u05E9",
            number: "08-9991021",
            department: "\u05DE\u05E4\u05E7\u05D3\u05D4"
          },
          {
            id: "ph-3",
            name: "\u05DE\u05D3\u05D5\u05E8 \u05D4\u05D3\u05E8\u05DB\u05D4",
            number: "08-9991044",
            department: "\u05D4\u05DB\u05E9\u05E8\u05D5\u05EA"
          }
        ]
      },
      shuttles: {
        items: [
          {
            id: "sh-1",
            destination: "\u05EA\u05D7\u05E0\u05D4 \u05DE\u05E8\u05DB\u05D6\u05D9\u05EA \u05D1\u05D0\u05E8 \u05E9\u05D1\u05E2",
            departureTime: "07:15",
            type: "bus"
          },
          {
            id: "sh-2",
            destination: "\u05E8\u05DB\u05D1\u05EA \u05E6\u05E4\u05D5\u05DF",
            departureTime: "13:40",
            type: "minibus"
          },
          {
            id: "sh-3",
            destination: "\u05DE\u05E8\u05DB\u05D6 \u05EA\u05D7\u05D1\u05D5\u05E8\u05D4 \u05D3\u05E8\u05D5\u05DD",
            departureTime: "18:00",
            type: "bus"
          }
        ]
      },
      polls: {
        activePollId: "poll-1",
        items: [
          {
            id: "poll-1",
            question: "\u05D0\u05D9\u05D6\u05D4 \u05E4\u05D5\u05E8\u05DE\u05D8 \u05EA\u05D3\u05E8\u05D9\u05DA \u05E9\u05D1\u05D5\u05E2\u05D9 \u05D4\u05DB\u05D9 \u05D9\u05E2\u05D9\u05DC \u05E2\u05D1\u05D5\u05E8\u05DB\u05DD?",
            options: [
              { id: "poll-1-opt-1", text: "\u05EA\u05D3\u05E8\u05D9\u05DA \u05E4\u05E8\u05D5\u05E0\u05D8\u05DC\u05D9 \u05E7\u05E6\u05E8", votes: 12 },
              { id: "poll-1-opt-2", text: "\u05E1\u05D9\u05DB\u05D5\u05DD \u05D3\u05D9\u05D2\u05D9\u05D8\u05DC\u05D9 \u05DB\u05EA\u05D5\u05D1", votes: 8 },
              { id: "poll-1-opt-3", text: "\u05D5\u05D9\u05D3\u05D0\u05D5 \u05DE\u05D5\u05E7\u05DC\u05D8", votes: 5 }
            ]
          }
        ]
      },
      celebrations: {
        items: [
          {
            id: "cel-1",
            name: "\u05E1\u05D2\u05DF \u05E2\u05D5\u05DE\u05E8 \u05D9\u05E9\u05E8\u05D0\u05DC\u05D9",
            type: "\u05D9\u05D5\u05DD \u05D4\u05D5\u05DC\u05D3\u05EA",
            date: "2026-03-22",
            description: "\u05D7\u05D5\u05D2\u05D2/\u05EA \u05D9\u05D5\u05DD \u05D4\u05D5\u05DC\u05D3\u05EA \u05D4\u05E9\u05D1\u05D5\u05E2 - \u05DE\u05D6\u05DC \u05D8\u05D5\u05D1!"
          },
          {
            id: "cel-2",
            name: "\u05DE\u05D3\u05D5\u05E8 \u05EA\u05E7\u05E9\u05D5\u05D1",
            type: "\u05E6\u05D9\u05D5\u05DF \u05DC\u05E9\u05D1\u05D7",
            date: "2026-03-29",
            description: "\u05E7\u05D9\u05D1\u05DC \u05E6\u05D9\u05D5\u05DF \u05DC\u05E9\u05D1\u05D7 \u05E2\u05DC \u05D4\u05D5\u05D1\u05DC\u05EA \u05E4\u05E8\u05D5\u05D9\u05E7\u05D8 \u05EA\u05E9\u05EA\u05D9\u05D5\u05EA \u05DE\u05D5\u05E6\u05DC\u05D7."
          }
        ]
      },
      heritage: {
        items: [
          {
            id: "her-1",
            quote: "\u05DE\u05E6\u05D5\u05D9\u05E0\u05D5\u05EA \u05DE\u05D1\u05E6\u05E2\u05D9\u05EA \u05DE\u05EA\u05D7\u05D9\u05DC\u05D4 \u05D1\u05DE\u05E9\u05DE\u05E2\u05EA \u05DE\u05E7\u05E6\u05D5\u05E2\u05D9\u05EA \u05D5\u05DE\u05DE\u05E9\u05D9\u05DB\u05D4 \u05D1\u05E8\u05D5\u05D7 \u05E6\u05D5\u05D5\u05EA.",
            author: '\u05D0\u05DC"\u05DD \u05D9\u05F3',
            role: "\u05DE\u05E4\u05E7\u05D3 \u05DE\u05E2\u05E8\u05DA \u05D4\u05D4\u05DB\u05E9\u05E8\u05D4"
          },
          {
            id: "her-2",
            quote: "\u05DE\u05D9 \u05E9\u05DC\u05D5\u05DE\u05D3 \u05D4\u05D9\u05D5\u05DD \u05D1\u05E2\u05D5\u05DE\u05E7, \u05DE\u05E4\u05E7\u05D3 \u05DE\u05D7\u05E8 \u05D1\u05D1\u05D9\u05D8\u05D7\u05D5\u05DF.",
            author: '\u05E8\u05E1"\u05DF \u05DE\u05F3',
            role: "\u05E8\u05D0\u05E9 \u05DE\u05D3\u05D5\u05E8 \u05D4\u05D3\u05E8\u05DB\u05D4"
          }
        ]
      },
      tips: {
        items: [
          {
            id: "tip-1",
            title: "\u05E0\u05D9\u05D4\u05D5\u05DC \u05DE\u05E9\u05D9\u05DE\u05D4 \u05D9\u05D5\u05DE\u05D9",
            text: "\u05E4\u05EA\u05D7\u05D5 \u05DB\u05DC \u05D1\u05D5\u05E7\u05E8 \u05D1\u05EA\u05D9\u05E2\u05D3\u05D5\u05E3 \u05E9\u05DC\u05D5\u05E9 \u05D4\u05DE\u05E9\u05D9\u05DE\u05D5\u05EA \u05D4\u05E7\u05E8\u05D9\u05D8\u05D9\u05D5\u05EA \u05D5\u05D4\u05EA\u05E7\u05D3\u05DE\u05D5 \u05DC\u05E4\u05D9 \u05E1\u05D3\u05E8 \u05D7\u05E9\u05D9\u05D1\u05D5\u05EA."
          },
          {
            id: "tip-2",
            title: "\u05DC\u05DE\u05D9\u05D3\u05D4 \u05D0\u05E4\u05E7\u05D8\u05D9\u05D1\u05D9\u05EA",
            text: "\u05E1\u05DB\u05DE\u05D5 \u05DB\u05DC \u05E9\u05D9\u05E2\u05D5\u05E8 \u05D1\u05E9\u05DC\u05D5\u05E9 \u05E0\u05E7\u05D5\u05D3\u05D5\u05EA \u05DE\u05E4\u05EA\u05D7 - \u05D6\u05D4 \u05DE\u05D7\u05D6\u05E7 \u05D6\u05D9\u05DB\u05E8\u05D5\u05DF \u05D5\u05DE\u05E7\u05E6\u05E8 \u05D7\u05D6\u05E8\u05D5\u05EA."
          }
        ]
      }
    }
  },
  externalLinks: {
    items: [
      {
        id: "ext-1",
        title: '\u05E2\u05E0\u05DF \u05D4\u05EA\u05D5\u05DE\u05DB"\u05DC',
        url: "https://portal.army.idf",
        visual: { type: "icon", icon: "Globe" },
        order: 0
      },
      {
        id: "ext-2",
        title: "\u05D7\u05D8\u05D9\u05D1\u05EA \u05D4\u05D4\u05E4\u05E2\u05DC\u05D4",
        url: "https://mzai.army.idf/sites/Mahir/main/index.html",
        visual: { type: "icon", icon: "GraduationCap" },
        order: 1
      }
    ]
  },
  imageGalleries: {
    schemaVersion: 1,
    items: []
  },
  access: {
    adminUsers: [
      {
        id: "admin-1",
        name: "admin",
        role: "admin"
      }
    ]
  }
};

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/config/defaultUsers.js
var DEFAULT_SAMPLE_ADMIN_USERS = [
  {
    id: 1,
    name: "\u05DE\u05E0\u05D4\u05DC \u05DC\u05D3\u05D5\u05D2\u05DE\u05D4",
    role: "admin",
    personalNumber: "8856096",
    email: "",
    loginName: ""
  },
  {
    id: 2,
    name: "\u05DE\u05E0\u05D4\u05DC \u05E8\u05D0\u05E9\u05D9",
    role: "admin",
    personalNumber: "8624034",
    email: "",
    loginName: ""
  }
];
var cloneDefaultSampleAdminUsers = () => DEFAULT_SAMPLE_ADMIN_USERS.map((user) => ({ ...user }));

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/ganttData.js
var GANTT_STATUS_OPTIONS = [
  { value: "planned", label: "\u05DE\u05EA\u05D5\u05DB\u05E0\u05DF" },
  { value: "blocked", label: "\u05D7\u05E1\u05D5\u05DD" },
  { value: "completed", label: "\u05D4\u05D5\u05E9\u05DC\u05DD" },
  { value: "cancelled", label: "\u05D1\u05D5\u05D8\u05DC" },
  { value: "onHold", label: "\u05D1\u05D4\u05DE\u05EA\u05E0\u05D4" }
];
var GANTT_VIEW_OPTIONS = [
  { value: "day", label: "\u05D9\u05D5\u05DD" },
  { value: "week", label: "\u05E9\u05D1\u05D5\u05E2" },
  { value: "month", label: "\u05D7\u05D5\u05D3\u05E9" },
  { value: "quarter", label: "\u05E8\u05D1\u05E2\u05D5\u05DF" }
];
var GANTT_RECURRENCE_FREQUENCY_OPTIONS = [
  { value: "weekly", label: "\u05E9\u05D1\u05D5\u05E2\u05D9" },
  { value: "monthly", label: "\u05D7\u05D5\u05D3\u05E9\u05D9" }
];
var GANTT_RECURRENCE_MONTHLY_MODE_OPTIONS = [
  { value: "weekdays", label: "\u05DC\u05E4\u05D9 \u05D9\u05DE\u05D9\u05DD \u05D1\u05E9\u05D1\u05D5\u05E2" },
  { value: "dayOfMonth", label: "\u05DC\u05E4\u05D9 \u05D9\u05D5\u05DD \u05D1\u05D7\u05D5\u05D3\u05E9" }
];
var GANTT_WEEKDAY_OPTIONS = [
  { value: 0, label: "\u05E8\u05D0\u05E9\u05D5\u05DF", shortLabel: "\u05D0\u05F3" },
  { value: 1, label: "\u05E9\u05E0\u05D9", shortLabel: "\u05D1\u05F3" },
  { value: 2, label: "\u05E9\u05DC\u05D9\u05E9\u05D9", shortLabel: "\u05D2\u05F3" },
  { value: 3, label: "\u05E8\u05D1\u05D9\u05E2\u05D9", shortLabel: "\u05D3\u05F3" },
  { value: 4, label: "\u05D7\u05DE\u05D9\u05E9\u05D9", shortLabel: "\u05D4\u05F3" },
  { value: 5, label: "\u05E9\u05D9\u05E9\u05D9", shortLabel: "\u05D5\u05F3" },
  { value: 6, label: "\u05E9\u05D1\u05EA", shortLabel: "\u05E9\u05F3" }
];
var DEFAULT_GANTT_CATEGORIES = [
  { id: "gantt-category-planning", name: "\u05EA\u05DB\u05E0\u05D5\u05DF", color: "#2563eb", order: 1 },
  { id: "gantt-category-content", name: "\u05EA\u05D5\u05DB\u05DF", color: "#0891b2", order: 2 },
  { id: "gantt-category-approval", name: "\u05D0\u05D9\u05E9\u05D5\u05E8\u05D9\u05DD", color: "#d97706", order: 3 },
  { id: "gantt-category-development", name: "\u05E4\u05D9\u05EA\u05D5\u05D7", color: "#7c3aed", order: 4 },
  { id: "gantt-category-qa", name: "\u05D1\u05D3\u05D9\u05E7\u05D5\u05EA", color: "#16a34a", order: 5 },
  { id: "gantt-category-delivery", name: "\u05DE\u05E1\u05D9\u05E8\u05D4", color: "#0f766e", order: 6 },
  { id: "gantt-category-general", name: "\u05DB\u05DC\u05DC\u05D9", color: "#475569", order: 7 }
];
var DEFAULT_GANTT_ITEMS = [
  {
    id: "gantt-demo-discovery",
    title: "\u05D0\u05D9\u05E4\u05D9\u05D5\u05DF \u05DE\u05E1\u05DC\u05D5\u05DC \u05D4\u05E2\u05D1\u05D5\u05D3\u05D4",
    owner: "\u05E6\u05D5\u05D5\u05EA \u05E4\u05E8\u05D5\u05D9\u05E7\u05D8",
    category: "\u05EA\u05DB\u05E0\u05D5\u05DF",
    status: "completed",
    startDate: "2026-06-02",
    endDate: "2026-06-07",
    color: "#2563eb",
    details: "\u05DE\u05E9\u05D9\u05DE\u05D4 \u05DE\u05DC\u05D0\u05D4 \u05DC\u05D3\u05D5\u05D2\u05DE\u05D4: \u05D0\u05D9\u05E1\u05D5\u05E3 \u05E6\u05E8\u05DB\u05D9\u05DD, \u05DE\u05D9\u05E4\u05D5\u05D9 \u05D1\u05E2\u05DC\u05D9 \u05E2\u05E0\u05D9\u05D9\u05DF \u05D5\u05E1\u05D2\u05D9\u05E8\u05EA \u05DE\u05D1\u05E0\u05D4 \u05E8\u05D0\u05E9\u05D5\u05E0\u05D9 \u05E9\u05DC \u05D4\u05D2\u05D0\u05E0\u05D8.",
    dependsOn: [],
    milestones: [
      { id: "gantt-demo-discovery-interviews", title: "\u05E1\u05D9\u05D5\u05DD \u05E8\u05D0\u05D9\u05D5\u05E0\u05D5\u05EA", date: "2026-06-04" },
      { id: "gantt-demo-discovery-approved", title: "\u05D0\u05D9\u05E9\u05D5\u05E8 \u05D0\u05E4\u05D9\u05D5\u05DF", date: "2026-06-07" }
    ]
  },
  {
    id: "gantt-demo-content",
    title: "\u05D0\u05D9\u05E1\u05D5\u05E3 \u05EA\u05DB\u05E0\u05D9\u05DD \u05DE\u05D4\u05D9\u05D7\u05D9\u05D3\u05D5\u05EA",
    owner: "\u05DE\u05D3\u05D5\u05E8 \u05EA\u05D5\u05DB\u05DF",
    category: "\u05EA\u05D5\u05DB\u05DF",
    status: "planned",
    startDate: "2026-06-12",
    endDate: "2026-07-02",
    color: "#0891b2",
    details: "\u05E8\u05D9\u05DB\u05D5\u05D6 \u05E7\u05D1\u05E6\u05D9\u05DD, \u05EA\u05D0\u05E8\u05D9\u05DB\u05D9\u05DD \u05D5\u05E7\u05D9\u05E9\u05D5\u05E8\u05D9\u05DD \u05E9\u05D9\u05D9\u05DB\u05E0\u05E1\u05D5 \u05DC\u05E2\u05DE\u05D5\u05D3\u05D9 \u05D4\u05EA\u05D5\u05DB\u05DF.",
    dependsOn: ["gantt-demo-discovery"],
    milestones: [
      { id: "gantt-demo-content-template", title: "\u05EA\u05D1\u05E0\u05D9\u05EA \u05DE\u05D5\u05DB\u05E0\u05D4", date: "2026-06-17" },
      { id: "gantt-demo-content-ready", title: "\u05EA\u05D5\u05DB\u05DF \u05E8\u05D0\u05E9\u05D5\u05E0\u05D9 \u05DE\u05D5\u05DB\u05DF", date: "2026-07-02" }
    ]
  },
  {
    id: "gantt-demo-approval",
    title: "\u05D0\u05D9\u05E9\u05D5\u05E8 \u05D2\u05D5\u05E8\u05DE\u05D9 \u05DE\u05D8\u05D4",
    owner: "\u05DE\u05E0\u05D4\u05DC \u05D4\u05DE\u05E2\u05E8\u05DB\u05EA",
    category: "\u05D0\u05D9\u05E9\u05D5\u05E8\u05D9\u05DD",
    status: "blocked",
    startDate: "2026-06-24",
    endDate: "2026-07-01",
    color: "#d97706",
    details: "\u05D3\u05D5\u05D2\u05DE\u05D4 \u05DC\u05DE\u05E9\u05D9\u05DE\u05D4 \u05D7\u05E1\u05D5\u05DE\u05D4: \u05DE\u05DE\u05EA\u05D9\u05E0\u05D4 \u05DC\u05D4\u05E2\u05E8\u05D5\u05EA \u05E1\u05D5\u05E4\u05D9\u05D5\u05EA \u05DC\u05E4\u05E0\u05D9 \u05D4\u05DE\u05E9\u05DA \u05E2\u05D1\u05D5\u05D3\u05D4.",
    dependsOn: ["gantt-demo-content"],
    milestones: [
      { id: "gantt-demo-approval-review", title: "\u05E1\u05D1\u05D1 \u05D4\u05E2\u05E8\u05D5\u05EA", date: "2026-06-30" }
    ]
  },
  {
    id: "gantt-demo-build",
    title: "\u05D1\u05E0\u05D9\u05D9\u05EA \u05EA\u05E6\u05D5\u05D2\u05EA \u05D2\u05D0\u05E0\u05D8",
    owner: "\u05E6\u05D5\u05D5\u05EA \u05E4\u05D9\u05EA\u05D5\u05D7",
    category: "\u05E4\u05D9\u05EA\u05D5\u05D7",
    status: "planned",
    startDate: "2026-06-27",
    endDate: "2026-07-10",
    color: "#7c3aed",
    details: "\u05D4\u05D8\u05DE\u05E2\u05EA \u05DE\u05E1\u05DA \u05E0\u05D9\u05D4\u05D5\u05DC, \u05EA\u05E6\u05D5\u05D2\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA, \u05E4\u05D9\u05DC\u05D8\u05E8\u05D9\u05DD \u05D5\u05D0\u05D1\u05E0\u05D9 \u05D3\u05E8\u05DA.",
    dependsOn: ["gantt-demo-discovery", "gantt-demo-content"],
    milestones: [
      { id: "gantt-demo-build-admin", title: "\u05DE\u05E1\u05DA \u05E0\u05D9\u05D4\u05D5\u05DC", date: "2026-07-03" },
      { id: "gantt-demo-build-public", title: "\u05EA\u05E6\u05D5\u05D2\u05D4 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05EA", date: "2026-07-10" }
    ]
  },
  {
    id: "gantt-demo-link-check",
    title: "\u05D1\u05D3\u05D9\u05E7\u05EA \u05E7\u05D9\u05E9\u05D5\u05E8\u05D9\u05DD",
    category: "\u05D1\u05D3\u05D9\u05E7\u05D5\u05EA",
    status: "onHold",
    startDate: "2026-07-03",
    endDate: "2026-07-03",
    color: "#16a34a"
  },
  {
    id: "gantt-demo-weekly-update",
    title: "\u05EA\u05D6\u05DB\u05D5\u05E8\u05EA \u05E2\u05D3\u05DB\u05D5\u05DF \u05E9\u05D1\u05D5\u05E2\u05D9",
    startDate: "2026-07-08",
    endDate: "2026-07-08"
  },
  {
    id: "gantt-demo-rollout",
    title: "\u05E4\u05E8\u05E1\u05D5\u05DD \u05D2\u05E8\u05E1\u05D4 \u05E8\u05D0\u05E9\u05D5\u05E0\u05D4",
    category: "\u05DE\u05E1\u05D9\u05E8\u05D4",
    status: "planned",
    startDate: "2026-07-11",
    endDate: "2026-07-14",
    color: "#0f766e",
    details: "\u05DE\u05E9\u05D9\u05DE\u05EA \u05DE\u05E1\u05D9\u05E8\u05D4 \u05E7\u05E6\u05E8\u05D4 \u05E2\u05DD \u05EA\u05DC\u05D5\u05EA \u05D1\u05DE\u05E9\u05D9\u05DE\u05D5\u05EA \u05D4\u05D1\u05E0\u05D9\u05D9\u05D4 \u05D5\u05D4\u05D1\u05D3\u05D9\u05E7\u05D4.",
    dependsOn: ["gantt-demo-build", "gantt-demo-link-check"],
    milestones: [
      { id: "gantt-demo-rollout-live", title: "\u05E2\u05DC\u05D9\u05D9\u05D4 \u05DC\u05D0\u05D5\u05D5\u05D9\u05E8", date: "2026-07-14" }
    ]
  },
  {
    id: "gantt-demo-cancelled-drill",
    title: "\u05EA\u05E8\u05D2\u05D5\u05DC \u05E9\u05D1\u05D5\u05D8\u05DC",
    category: "\u05D1\u05D3\u05D9\u05E7\u05D5\u05EA",
    status: "cancelled",
    startDate: "2026-06-16",
    endDate: "2026-06-18",
    color: "#dc2626",
    details: "\u05D3\u05D5\u05D2\u05DE\u05D4 \u05DC\u05E4\u05E8\u05D9\u05D8 \u05E9\u05D1\u05D5\u05D8\u05DC \u05D5\u05E0\u05E9\u05D0\u05E8 \u05D1\u05D2\u05D0\u05E0\u05D8 \u05DC\u05E6\u05D5\u05E8\u05DA \u05EA\u05D9\u05E2\u05D5\u05D3."
  }
];
var DEFAULT_GANTT_DATA = {
  enabled: false,
  buttonLabel: "\u05D2\u05D0\u05E0\u05D8 \u05E2\u05D1\u05D5\u05D3\u05D4",
  pageTitle: "\u05D2\u05D0\u05E0\u05D8 \u05E2\u05D1\u05D5\u05D3\u05D4",
  description: "\u05E0\u05EA\u05D5\u05E0\u05D9 \u05D3\u05D5\u05D2\u05DE\u05D4 \u05DC\u05E0\u05D9\u05D4\u05D5\u05DC \u05D2\u05D0\u05E0\u05D8: \u05DE\u05E9\u05D9\u05DE\u05D5\u05EA \u05DE\u05DC\u05D0\u05D5\u05EA \u05DC\u05E6\u05D3 \u05DE\u05E9\u05D9\u05DE\u05D5\u05EA \u05E7\u05E6\u05E8\u05D5\u05EA \u05E9\u05DE\u05E1\u05EA\u05DE\u05DB\u05D5\u05EA \u05E2\u05DC \u05D4\u05E9\u05DC\u05DE\u05D5\u05EA \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05D5\u05EA.",
  groupBy: "category",
  defaultView: "month",
  showLegend: true,
  showToday: true,
  categories: DEFAULT_GANTT_CATEGORIES,
  items: DEFAULT_GANTT_ITEMS
};
var DEFAULT_GANTT_DESIGN = {
  presetId: "classic-beige",
  layoutMode: "fullWidth",
  chartWidthMode: "full",
  chartHeightMode: "viewport",
  density: "comfortable",
  taskColumnWidth: "medium",
  cardStyle: "soft",
  backgroundStyle: "site",
  toolbarStyle: "comfortable",
  gridStyle: "subtle",
  barStyle: "rounded",
  milestoneStyle: "diamond",
  legendPlacement: "bottom",
  todayLineStyle: "soft",
  showOuterCard: true,
  barShadow: true,
  showProgressLabel: true,
  showTaskNameOnBar: false,
  showHebrewDate: false,
  showHolidays: false,
  colors: {
    chartBackground: "#ffffff",
    cardBackground: "#ffffff",
    accentColor: "#2563eb",
    todayLineColor: "#ef4444"
  }
};
var GANTT_DESIGN_PRESETS = [
  {
    id: "classic-beige",
    name: "\u05E7\u05DC\u05D0\u05E1\u05D9 \u05D7\u05DE\u05D9\u05DD",
    description: "\u05D4\u05E2\u05D9\u05E6\u05D5\u05D1 \u05D4\u05E6\u05D9\u05D1\u05D5\u05E8\u05D9 \u05D4\u05E0\u05D5\u05DB\u05D7\u05D9 \u05D1\u05D2\u05D5\u05D5\u05E0\u05D9 \u05D1\u05D6\u05F3 \u05D5\u05D7\u05D5\u05DD, \u05DE\u05EA\u05D0\u05D9\u05DD \u05DC\u05D0\u05EA\u05E8 \u05D1\u05E2\u05D9\u05E6\u05D5\u05D1 \u05D7\u05DE\u05D9\u05DD.",
    settings: {
      ...DEFAULT_GANTT_DESIGN,
      presetId: "classic-beige",
      layoutMode: "fullWidth",
      chartWidthMode: "full",
      cardStyle: "soft",
      backgroundStyle: "site",
      toolbarStyle: "comfortable",
      density: "comfortable",
      gridStyle: "subtle"
    }
  },
  {
    id: "clean-card",
    name: "\u05DB\u05E8\u05D8\u05D9\u05E1 \u05E0\u05E7\u05D9",
    description: "\u05E2\u05D9\u05E6\u05D5\u05D1 \u05D1\u05D4\u05D9\u05E8 \u05D5\u05E0\u05E7\u05D9 \u05DB\u05DE\u05D5 \u05D4\u05EA\u05E6\u05D5\u05D2\u05D4 \u05D4\u05DE\u05E7\u05D3\u05D9\u05DE\u05D4 \u05D1\u05E0\u05D9\u05D4\u05D5\u05DC, \u05E2\u05DD \u05DB\u05E8\u05D8\u05D9\u05E1 \u05DE\u05DE\u05D5\u05E8\u05DB\u05D6, \u05E8\u05E7\u05E2 \u05D1\u05D4\u05D9\u05E8 \u05D5\u05D2\u05D1\u05D5\u05DC\u05D5\u05EA \u05E2\u05D3\u05D9\u05E0\u05D9\u05DD.",
    settings: {
      ...DEFAULT_GANTT_DESIGN,
      presetId: "clean-card",
      layoutMode: "centered",
      chartWidthMode: "contained",
      cardStyle: "clean",
      backgroundStyle: "clean",
      toolbarStyle: "compact",
      density: "comfortable",
      gridStyle: "subtle",
      barShadow: false,
      colors: {
        chartBackground: "#f8fafc",
        cardBackground: "#ffffff",
        accentColor: "#2563eb",
        todayLineColor: "#ef4444"
      }
    }
  },
  {
    id: "full-board",
    name: "\u05DC\u05D5\u05D7 \u05DE\u05DC\u05D0",
    description: "\u05EA\u05E8\u05E9\u05D9\u05DD \u05E8\u05D7\u05D1 \u05E9\u05DE\u05E0\u05E6\u05DC \u05D0\u05EA \u05DB\u05DC \u05E8\u05D5\u05D7\u05D1 \u05D4\u05DE\u05E1\u05DA, \u05DE\u05EA\u05D0\u05D9\u05DD \u05DC\u05D4\u05E8\u05D1\u05D4 \u05DE\u05E9\u05D9\u05DE\u05D5\u05EA.",
    settings: {
      ...DEFAULT_GANTT_DESIGN,
      presetId: "full-board",
      layoutMode: "fullWidth",
      chartWidthMode: "full",
      cardStyle: "minimal",
      backgroundStyle: "clean",
      toolbarStyle: "compact",
      density: "comfortable",
      taskColumnWidth: "wide",
      showOuterCard: true,
      barShadow: false
    }
  },
  {
    id: "compact",
    name: "\u05E7\u05D5\u05DE\u05E4\u05E7\u05D8\u05D9",
    description: "\u05E2\u05D9\u05E6\u05D5\u05D1 \u05E6\u05E4\u05D5\u05E3 \u05D9\u05D5\u05EA\u05E8 \u05E9\u05DE\u05EA\u05D0\u05D9\u05DD \u05DC\u05DE\u05E1\u05DB\u05D9\u05DD \u05E7\u05D8\u05E0\u05D9\u05DD \u05D0\u05D5 \u05DC\u05D4\u05E8\u05D1\u05D4 \u05DE\u05E9\u05D9\u05DE\u05D5\u05EA.",
    settings: {
      ...DEFAULT_GANTT_DESIGN,
      presetId: "compact",
      layoutMode: "fullWidth",
      chartWidthMode: "full",
      cardStyle: "clean",
      backgroundStyle: "clean",
      toolbarStyle: "compact",
      chartHeightMode: "compact",
      density: "compact",
      taskColumnWidth: "narrow",
      gridStyle: "minimal",
      barShadow: false,
      showProgressLabel: false
    }
  },
  {
    id: "glass-modern",
    name: "\u05D6\u05DB\u05D5\u05DB\u05D9\u05EA \u05DE\u05D5\u05D3\u05E8\u05E0\u05D9\u05EA",
    description: "\u05E2\u05D9\u05E6\u05D5\u05D1 \u05D6\u05DB\u05D5\u05DB\u05D9\u05EA \u05E2\u05D3\u05D9\u05DF \u05E2\u05DD \u05E8\u05E7\u05E2 \u05DE\u05D8\u05D5\u05E9\u05D8\u05E9 \u05D5\u05E9\u05E7\u05D9\u05E4\u05D5\u05EA \u05E7\u05DC\u05D4.",
    settings: {
      ...DEFAULT_GANTT_DESIGN,
      presetId: "glass-modern",
      layoutMode: "centered",
      chartWidthMode: "contained",
      cardStyle: "glass",
      backgroundStyle: "glass",
      toolbarStyle: "comfortable",
      density: "comfortable",
      gridStyle: "subtle",
      colors: {
        chartBackground: "#f8fafc",
        cardBackground: "#ffffff",
        accentColor: "#0f766e",
        todayLineColor: "#dc2626"
      }
    }
  }
];
var VALID_STATUS = new Set(GANTT_STATUS_OPTIONS.map((option) => option.value));
var VALID_VIEW = new Set(GANTT_VIEW_OPTIONS.map((option) => option.value));
var VALID_RECURRENCE_FREQUENCY = new Set(GANTT_RECURRENCE_FREQUENCY_OPTIONS.map((option) => option.value));
var VALID_RECURRENCE_MONTHLY_MODE = new Set(GANTT_RECURRENCE_MONTHLY_MODE_OPTIONS.map((option) => option.value));
var VALID_WEEKDAY = new Set(GANTT_WEEKDAY_OPTIONS.map((option) => option.value));
var VALID_DESIGN_PRESET = new Set(GANTT_DESIGN_PRESETS.map((preset) => preset.id));

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/utils/boomData.js
var BOOM_STATUS_OPTIONS = Object.freeze([
  { value: "planned", label: "\u05DE\u05EA\u05D5\u05DB\u05E0\u05DF" },
  { value: "active", label: "\u05D1\u05D1\u05D9\u05E6\u05D5\u05E2" },
  { value: "blocked", label: "\u05D7\u05E1\u05D5\u05DD" },
  { value: "onHold", label: "\u05D1\u05D4\u05DE\u05EA\u05E0\u05D4" },
  { value: "completed", label: "\u05D4\u05D5\u05E9\u05DC\u05DD" }
]);
var BOOM_SUMMARY_METRICS = Object.freeze([
  { id: "total", label: "\u05DE\u05E9\u05D9\u05DE\u05D5\u05EA", icon: "tasks" },
  { id: "active", label: "\u05D1\u05D1\u05D9\u05E6\u05D5\u05E2", icon: "activity" },
  { id: "blocked", label: "\u05D7\u05E1\u05D5\u05DE\u05D5\u05EA", icon: "blocked" },
  { id: "completed", label: "\u05D4\u05D5\u05E9\u05DC\u05DE\u05D5", icon: "completed" },
  { id: "overdue", label: "\u05D1\u05D0\u05D9\u05D7\u05D5\u05E8", icon: "overdue" },
  { id: "upcoming", label: "\u05E7\u05E8\u05D5\u05D1\u05D5\u05EA", icon: "upcoming" },
  { id: "owners", label: "\u05D0\u05D7\u05E8\u05D0\u05D9\u05DD", icon: "owners" },
  { id: "categories", label: "\u05EA\u05D7\u05D5\u05DE\u05D9\u05DD", icon: "categories" }
]);
var DEFAULT_SUMMARY_METRICS = ["total", "active", "owners", "categories"];
var BOOM_TABLE_DENSITIES = Object.freeze([
  { value: "compact", label: "\u05E7\u05D5\u05DE\u05E4\u05E7\u05D8\u05D9" },
  { value: "comfortable", label: "\u05DE\u05D0\u05D5\u05D6\u05DF" }
]);
var BOOM_ACCENT_OPTIONS = Object.freeze([
  { value: "primary", label: "\u05E6\u05D1\u05E2 \u05D4\u05D0\u05EA\u05E8" },
  { value: "sky", label: "\u05DB\u05D7\u05D5\u05DC \u05E4\u05D9\u05E7\u05D5\u05D3\u05D9" },
  { value: "emerald", label: "\u05D9\u05E8\u05D5\u05E7 \u05EA\u05E4\u05E2\u05D5\u05DC\u05D9" }
]);
var VALID_SUMMARY_METRICS = new Set(BOOM_SUMMARY_METRICS.map((metric) => metric.id));
var VALID_TABLE_DENSITIES = new Set(BOOM_TABLE_DENSITIES.map((option) => option.value));
var VALID_ACCENTS = new Set(BOOM_ACCENT_OPTIONS.map((option) => option.value));
var BOOM_COLOR_OPTIONS = Object.freeze([
  "#2563eb",
  "#0891b2",
  "#0f766e",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#475569"
]);
var DEFAULT_BOOM_DATA = Object.freeze({
  enabled: false,
  buttonLabel: "\u05D1\u05D5\u05DD",
  pageTitle: "BOOM - \u05EA\u05DE\u05D5\u05E0\u05EA \u05DE\u05E6\u05D1",
  description: "\u05DE\u05E2\u05E8\u05DB\u05EA \u05E9\u05DC\u05D9\u05D8\u05D4 \u05D5\u05D1\u05E7\u05E8\u05D4 \u05DC\u05DE\u05E9\u05D9\u05DE\u05D5\u05EA, \u05D0\u05D7\u05E8\u05D9\u05D5\u05EA \u05D5\u05D4\u05EA\u05E7\u05D3\u05DE\u05D5\u05EA.",
  design: {
    showSummaryStrip: true,
    summaryMetrics: DEFAULT_SUMMARY_METRICS,
    tableDensity: "comfortable",
    showCategoryColors: true,
    showSummaryChips: true,
    accent: "primary"
  },
  categories: [
    { id: "boom-category-general", name: "\u05DB\u05DC\u05DC\u05D9", color: BOOM_COLOR_OPTIONS[0], order: 1 }
  ],
  items: []
});
var VALID_STATUS2 = new Set(BOOM_STATUS_OPTIONS.map((option) => option.value));
var HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function isObject4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}
function normalizeBoomAssignee(assigneeLike) {
  if (!isObject4(assigneeLike)) return null;
  const sharePointUserId = Number(assigneeLike.sharePointUserId ?? assigneeLike.Id);
  const loginName = text(assigneeLike.loginName ?? assigneeLike.LoginName);
  const email = text(assigneeLike.email ?? assigneeLike.Email).toLowerCase();
  const personalNumber = text(assigneeLike.personalNumber).replace(/\D/g, "");
  const identityKey = text(assigneeLike.identityKey).toLowerCase() || (Number.isInteger(sharePointUserId) && sharePointUserId > 0 ? `sp:${sharePointUserId}` : "") || (loginName ? `login:${loginName.toLowerCase()}` : "") || (email ? `email:${email}` : "") || (personalNumber ? `pn:${personalNumber}` : "");
  if (!identityKey) return null;
  return {
    displayName: text(assigneeLike.displayName ?? assigneeLike.Title),
    personalNumber,
    loginName,
    email,
    sharePointUserId: Number.isInteger(sharePointUserId) && sharePointUserId > 0 ? sharePointUserId : null,
    identityKey
  };
}
function integer(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
function validDate(value, fallback) {
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
  return Number.isFinite(Date.parse(`${candidate}T00:00:00`)) ? candidate : fallback;
}
function normalizeSummaryMetrics(value) {
  const metrics = Array.isArray(value) ? value.filter((metric) => VALID_SUMMARY_METRICS.has(metric)) : DEFAULT_SUMMARY_METRICS;
  return [...new Set(metrics)];
}
function normalizeBoomDesign(designLike) {
  const source = isObject4(designLike) ? designLike : {};
  return {
    showSummaryStrip: source.showSummaryStrip !== void 0 ? source.showSummaryStrip !== false : source.showDashboard !== false,
    summaryMetrics: normalizeSummaryMetrics(source.summaryMetrics),
    tableDensity: VALID_TABLE_DENSITIES.has(source.tableDensity) ? source.tableDensity : DEFAULT_BOOM_DATA.design.tableDensity,
    showCategoryColors: source.showCategoryColors !== false,
    showSummaryChips: source.showSummaryChips !== false,
    accent: VALID_ACCENTS.has(source.accent) ? source.accent : DEFAULT_BOOM_DATA.design.accent
  };
}
function isValidBoomColor(value) {
  return HEX_COLOR_RE.test(text(value));
}
function normalizeBoomStatus(value) {
  return VALID_STATUS2.has(value) ? value : BOOM_STATUS_OPTIONS[0].value;
}
function normalizeBoomTask(taskLike, index = 0) {
  const source = isObject4(taskLike) ? taskLike : {};
  const startDate = validDate(source.startDate, "");
  const endCandidate = validDate(source.endDate ?? source.deadline, startDate);
  const endDate = !startDate || !endCandidate || Date.parse(`${endCandidate}T00:00:00`) >= Date.parse(`${startDate}T00:00:00`) ? endCandidate : startDate;
  return {
    id: text(source.id, `boom-task-${index + 1}`),
    title: text(source.title, `\u05DE\u05E9\u05D9\u05DE\u05D4 ${index + 1}`),
    category: text(source.category ?? source.domain, "\u05DB\u05DC\u05DC\u05D9"),
    owner: text(source.owner ?? source.responsibleOwner),
    ...normalizeBoomAssignee(source.linkedAssignee) ? { linkedAssignee: normalizeBoomAssignee(source.linkedAssignee) } : {},
    ...Number(source.assignmentVersion) > 0 ? { assignmentVersion: integer(source.assignmentVersion, 1, Number.MAX_SAFE_INTEGER, 1) } : {},
    status: normalizeBoomStatus(source.status),
    startDate,
    endDate,
    details: text(source.details ?? source.description ?? source.notes),
    color: isValidBoomColor(source.color) ? source.color : BOOM_COLOR_OPTIONS[0],
    order: integer(source.order, 0, Number.MAX_SAFE_INTEGER, index + 1)
  };
}
function normalizeBoomCategories(categoriesLike, tasks) {
  const source = Array.isArray(categoriesLike) ? categoriesLike : [];
  const seen = /* @__PURE__ */ new Set();
  const categories = [];
  source.forEach((categoryLike, index) => {
    const category = isObject4(categoryLike) ? categoryLike : {};
    const name = text(category.name ?? category.label);
    const key = name.toLocaleLowerCase("he");
    if (!name || seen.has(key)) return;
    seen.add(key);
    categories.push({
      id: text(category.id, `boom-category-${index + 1}`),
      name,
      color: isValidBoomColor(category.color) ? category.color : BOOM_COLOR_OPTIONS[index % BOOM_COLOR_OPTIONS.length],
      order: integer(category.order, 0, Number.MAX_SAFE_INTEGER, index + 1)
    });
  });
  tasks.forEach((task) => {
    const key = task.category.toLocaleLowerCase("he");
    if (seen.has(key)) return;
    seen.add(key);
    categories.push({
      id: `boom-category-${categories.length + 1}`,
      name: task.category,
      color: task.color,
      order: categories.length + 1
    });
  });
  if (categories.length === 0) {
    categories.push({ ...DEFAULT_BOOM_DATA.categories[0] });
  }
  return categories.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "he"));
}
function normalizeBoomData(dataLike) {
  const source = isObject4(dataLike) ? dataLike : {};
  const items = (Array.isArray(source.items) ? source.items : []).map((item, index) => normalizeBoomTask(item, index)).sort((left, right) => left.order - right.order);
  const categories = normalizeBoomCategories(source.categories, items);
  const categoryByName = new Map(categories.map((category) => [category.name.toLocaleLowerCase("he"), category]));
  return {
    enabled: source.enabled === true,
    buttonLabel: text(source.buttonLabel, DEFAULT_BOOM_DATA.buttonLabel),
    pageTitle: text(source.pageTitle, DEFAULT_BOOM_DATA.pageTitle),
    description: text(source.description, DEFAULT_BOOM_DATA.description),
    design: normalizeBoomDesign(source.design),
    categories,
    items: items.map((task) => {
      const category = categoryByName.get(task.category.toLocaleLowerCase("he"));
      return {
        ...task,
        category: category?.name || task.category,
        color: category?.color || task.color
      };
    })
  };
}
function addDays(date, days) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, "0"),
    String(next.getDate()).padStart(2, "0")
  ].join("-");
}
function createBoomDemoData(today = /* @__PURE__ */ new Date()) {
  const categories = [
    { id: "boom-category-operations", name: "\u05DE\u05D1\u05E6\u05E2\u05D9\u05DD", color: "#2563eb", order: 1 },
    { id: "boom-category-readiness", name: "\u05DB\u05E9\u05D9\u05E8\u05D5\u05EA", color: "#0f766e", order: 2 },
    { id: "boom-category-community", name: "\u05E7\u05D4\u05D9\u05DC\u05D4", color: "#7c3aed", order: 3 }
  ];
  const items = [
    {
      id: "boom-demo-completed",
      title: "\u05E1\u05D9\u05DB\u05D5\u05DD \u05EA\u05DE\u05D5\u05E0\u05EA \u05DE\u05E6\u05D1 \u05E7\u05D5\u05D3\u05DE\u05EA",
      category: "\u05DE\u05D1\u05E6\u05E2\u05D9\u05DD",
      owner: "\u05D7\u05D3\u05E8 \u05DE\u05D1\u05E6\u05E2\u05D9\u05DD",
      status: "completed",
      startDate: addDays(today, -18),
      endDate: addDays(today, -8),
      details: "\u05E1\u05D9\u05DB\u05D5\u05DD \u05D4\u05DE\u05E9\u05D9\u05DE\u05D5\u05EA \u05D5\u05D4\u05E4\u05E7\u05EA \u05DC\u05E7\u05D7\u05D9\u05DD \u05DE\u05D4\u05EA\u05E7\u05D5\u05E4\u05D4 \u05E9\u05D4\u05E1\u05EA\u05D9\u05D9\u05DE\u05D4.",
      color: "#2563eb",
      order: 1
    },
    {
      id: "boom-demo-active",
      title: "\u05E2\u05D3\u05DB\u05D5\u05DF \u05EA\u05DE\u05D5\u05E0\u05EA \u05DE\u05E6\u05D1 \u05D9\u05D5\u05DE\u05D9\u05EA",
      category: "\u05DE\u05D1\u05E6\u05E2\u05D9\u05DD",
      owner: "\u05E7\u05E6\u05D9\u05DF \u05EA\u05D5\u05E8\u05DF",
      status: "active",
      startDate: addDays(today, -5),
      endDate: addDays(today, 5),
      details: "\u05D0\u05D9\u05E1\u05D5\u05E3 \u05EA\u05DE\u05D5\u05E0\u05EA \u05DE\u05E6\u05D1, \u05D7\u05E1\u05DE\u05D9\u05DD \u05D5\u05D4\u05D7\u05DC\u05D8\u05D5\u05EA \u05DC\u05D1\u05D9\u05E6\u05D5\u05E2.",
      color: "#2563eb",
      order: 2
    },
    {
      id: "boom-demo-blocked",
      title: "\u05D4\u05E9\u05DC\u05DE\u05EA \u05DB\u05E9\u05D9\u05E8\u05D5\u05EA \u05E6\u05D5\u05D5\u05EA\u05D9\u05DD",
      category: "\u05DB\u05E9\u05D9\u05E8\u05D5\u05EA",
      owner: "\u05E8\u05DB\u05D6 \u05DB\u05E9\u05D9\u05E8\u05D5\u05EA",
      status: "blocked",
      startDate: addDays(today, -3),
      endDate: addDays(today, 9),
      details: "\u05DE\u05E2\u05E7\u05D1 \u05D0\u05D7\u05E8 \u05E4\u05E2\u05E8\u05D9 \u05D4\u05DB\u05E9\u05E8\u05D4 \u05D5\u05E6\u05D9\u05D5\u05D3 \u05D4\u05D3\u05D5\u05E8\u05E9\u05D9\u05DD \u05D8\u05D9\u05E4\u05D5\u05DC.",
      color: "#0f766e",
      order: 3
    },
    {
      id: "boom-demo-planned",
      title: "\u05D4\u05D9\u05E2\u05E8\u05DB\u05D5\u05EA \u05DC\u05E4\u05E2\u05D9\u05DC\u05D5\u05EA \u05E7\u05D4\u05D9\u05DC\u05EA\u05D9\u05EA",
      category: "\u05E7\u05D4\u05D9\u05DC\u05D4",
      owner: "\u05E8\u05DB\u05D6\u05EA \u05E7\u05D4\u05D9\u05DC\u05D4",
      status: "planned",
      startDate: addDays(today, 7),
      endDate: addDays(today, 21),
      details: "\u05EA\u05D9\u05D0\u05D5\u05DD \u05D1\u05E2\u05DC\u05D9 \u05EA\u05E4\u05E7\u05D9\u05D3\u05D9\u05DD, \u05EA\u05E9\u05EA\u05D9\u05D5\u05EA \u05D5\u05E4\u05E8\u05E1\u05D5\u05DD.",
      color: "#7c3aed",
      order: 4
    }
  ];
  return normalizeBoomData({
    ...DEFAULT_BOOM_DATA,
    categories,
    items
  });
}
function createInitialBoomData(today = /* @__PURE__ */ new Date()) {
  return createBoomDemoData(today);
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/src/config/siteSeedDefaults.js
var clone = (value) => JSON.parse(JSON.stringify(value));
var asString = (value, fallback = "") => typeof value === "string" ? value : fallback;
function toLegacyEventsPayload(defaults) {
  const eventsBranch = defaults?.widgets?.data?.events || {};
  return {
    displayCount: Number.isFinite(Number(eventsBranch.displayCount)) ? Number(eventsBranch.displayCount) : 3,
    displayMode: asString(eventsBranch.displayMode, "default"),
    events: Array.isArray(eventsBranch.items) ? clone(eventsBranch.items) : []
  };
}
function toLegacyNavigationPayload(defaults) {
  const level1 = Array.isArray(defaults?.navigation?.items) ? defaults.navigation.items : [];
  return level1.map((node, l1Index) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    const l1Id = asString(node?.id, `nav_${l1Index + 1}`);
    return {
      id: l1Id,
      label: asString(node?.label, ""),
      icon: asString(node?.icon, ""),
      url: asString(node?.url, ""),
      children: children.map((child, l2Index) => {
        const subLinks = Array.isArray(child?.children) ? child.children : [];
        const l2Id = asString(child?.id, `${l1Id}_sub_${l2Index + 1}`);
        const title = asString(child?.label, asString(child?.title, ""));
        return {
          id: l2Id,
          title,
          label: title,
          icon: asString(child?.icon, ""),
          url: asString(child?.url, ""),
          subLinks: subLinks.map((link, l3Index) => ({
            id: asString(link?.id, `${l2Id}_link_${l3Index + 1}`),
            label: asString(link?.label, asString(link?.title, "")),
            icon: asString(link?.icon, ""),
            url: asString(link?.url, "")
          }))
        };
      })
    };
  });
}
function toLegacyThemePayload(defaults) {
  const theme = defaults?.theme || {};
  const layout = defaults?.layout || {};
  return {
    primaryColor: asString(theme.primaryColor, "#0891b2"),
    displayMode: asString(theme.displayMode, "dark"),
    borderStyle: asString(theme.borderStyle, "cyber"),
    useTintedBackground: theme?.backgrounds?.tinted?.enabled ?? true,
    tintedBackgroundStrength: Number.isFinite(Number(theme?.backgrounds?.tinted?.strength)) ? Number(theme.backgrounds.tinted.strength) : 72,
    borderTargets: clone(theme?.borderTargets || {}),
    heroGrayscale: theme?.backgrounds?.hero?.grayscale ?? false,
    heroPanelsBordered: layout?.hero?.panelsBordered ?? true,
    commanderPanelBordered: layout?.hero?.commanderPanelBordered ?? false,
    widgetPanelBordered: layout?.hero?.widgetPanelBordered ?? layout?.hero?.panelsBordered ?? true,
    showNavCategories: layout?.navigation?.showCategories ?? false,
    regularLinksLayout: asString(layout?.navigation?.mode, "sidebar-right"),
    externalLinksLayout: asString(layout?.externalLinks?.mode, "cards"),
    externalLinksFixed: layout?.externalLinks?.fixed ?? false,
    externalLinksBordered: layout?.externalLinks?.bordered ?? true,
    externalLinksShowBackground: layout?.externalLinks?.showBackground ?? true,
    widgetHeight: asString(layout?.hero?.widgetHeight, "full"),
    linksLayout: "cards"
  };
}
function toLegacySiteContentPayload(defaults) {
  const content = defaults?.content || {};
  const hero = content?.hero || {};
  const commander = content?.commander || {};
  return {
    hero: {
      siteName: asString(hero.siteName, ""),
      title: asString(hero.title, ""),
      subtitle: asString(hero.subtitle, ""),
      logo: asString(hero.logoUrl, ""),
      description: asString(hero.description, ""),
      backgroundImages: Array.isArray(hero.backgroundImageUrls) ? clone(hero.backgroundImageUrls) : []
    },
    commander: {
      image: asString(commander.imageUrl, ""),
      sectionTitle: asString(commander.sectionTitle, ""),
      roleLabel: asString(commander.roleLabel, ""),
      decorativeElement: asString(commander.decorativeElement, "line-diamond-line"),
      messages: Array.isArray(commander.messages) ? clone(commander.messages) : []
    },
    overlayImage: clone(content.overlayImage || {})
  };
}
function toLegacyWidgetsPayload(defaults) {
  const widgets = defaults?.widgets || {};
  const data = widgets?.data || {};
  const events = data?.events || {};
  const countdown = data?.countdown || {};
  const countdownItems = Array.isArray(countdown.items) ? clone(countdown.items) : [];
  const activeCountdownId = countdown.activeItemId ? String(countdown.activeItemId) : null;
  const activeCountdown = countdownItems.find((item) => String(item?.id) === activeCountdownId) || countdownItems[0] || null;
  const pollsBranch = data?.polls || {};
  const activePollId = pollsBranch.activePollId ? String(pollsBranch.activePollId) : null;
  const polls = (Array.isArray(pollsBranch.items) ? pollsBranch.items : []).map((poll, index) => {
    const id = String(poll?.id ?? `${index + 1}`);
    return {
      ...clone(poll),
      id,
      active: activePollId !== null && activePollId === id
    };
  });
  const activeWidgets = Array.isArray(widgets.active) && widgets.active.length > 0 ? widgets.active.slice(0, 3) : [...DEFAULT_ACTIVE_WIDGETS];
  return {
    activeWidgets,
    activeWidget: activeWidgets[0] || DEFAULT_ACTIVE_WIDGETS[0],
    rotationInterval: Number.isFinite(Number(widgets?.carousel?.rotationIntervalSeconds)) ? Number(widgets.carousel.rotationIntervalSeconds) : 8,
    widgetSettings: mergeWidgetSettings(widgets.display || {}),
    events: Array.isArray(events.items) ? clone(events.items) : [],
    displayCount: Number.isFinite(Number(events.displayCount)) ? Number(events.displayCount) : 3,
    displayMode: asString(events.displayMode, "default"),
    alerts: Array.isArray(data?.alerts?.items) ? clone(data.alerts.items) : [],
    outstanding: Array.isArray(data?.outstanding?.items) ? data.outstanding.items.map((item) => ({
      ...clone(item),
      image: asString(item?.imageUrl, asString(item?.image, ""))
    })) : [],
    countdown: {
      title: asString(activeCountdown?.title, ""),
      targetDate: asString(activeCountdown?.targetDate, ""),
      details: asString(activeCountdown?.details, ""),
      showDetails: activeCountdown?.showDetails ?? false,
      switchIntervalSeconds: Number.isFinite(Number(countdown.switchIntervalSeconds)) ? Number(countdown.switchIntervalSeconds) : 8,
      activeItemId: activeCountdown ? String(activeCountdown.id) : null,
      items: countdownItems.map((item, index) => ({
        id: String(item?.id ?? `countdown-${index + 1}`),
        title: asString(item?.title, ""),
        targetDate: asString(item?.targetDate, ""),
        details: asString(item?.details, ""),
        showDetails: item?.showDetails ?? false
      }))
    },
    news: Array.isArray(data?.news?.items) ? clone(data.news.items) : [],
    phonebook: Array.isArray(data?.phonebook?.items) ? clone(data.phonebook.items) : [],
    shuttles: Array.isArray(data?.shuttles?.items) ? clone(data.shuttles.items) : [],
    polls,
    celebrations: Array.isArray(data?.celebrations?.items) ? clone(data.celebrations.items) : [],
    heritage: Array.isArray(data?.heritage?.items) ? clone(data.heritage.items) : [],
    tips: Array.isArray(data?.tips?.items) ? clone(data.tips.items) : []
  };
}
function toLegacyExternalLinksPayload(defaults) {
  const items = Array.isArray(defaults?.externalLinks?.items) ? defaults.externalLinks.items : [];
  return items.map((item, index) => {
    const visual = item?.visual || { type: "none" };
    const image = visual.type === "image" ? asString(visual.imageUrl, "") : "";
    const icon = visual.type === "icon" ? asString(visual.icon, "") : "";
    return {
      id: asString(item?.id, String(index + 1)),
      title: asString(item?.title, ""),
      url: asString(item?.url, ""),
      icon,
      iconUrl: image,
      image,
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index
    };
  });
}
function buildCanonicalLegacySeedEntries({ today = /* @__PURE__ */ new Date() } = {}) {
  const defaults = clone(DEFAULT_CONFIG_V1);
  return [
    {
      key: "masterConfig",
      label: "\u05E7\u05D5\u05E0\u05E4\u05D9\u05D2\u05D5\u05E8\u05E6\u05D9\u05D9\u05EA \u05DE\u05D0\u05E1\u05D8\u05E8",
      fileName: "bihs_master_config_v1.txt",
      data: defaults
    },
    {
      key: "users",
      label: "\u05DE\u05E9\u05EA\u05DE\u05E9\u05D9\u05DD",
      fileName: "users_data.txt",
      data: cloneDefaultSampleAdminUsers()
    },
    {
      key: "events",
      label: "\u05D0\u05D9\u05E8\u05D5\u05E2\u05D9\u05DD",
      fileName: "events_data.txt",
      data: toLegacyEventsPayload(defaults)
    },
    {
      key: "navigation",
      label: "\u05E0\u05D9\u05D5\u05D5\u05D8",
      fileName: "nav_data.txt",
      data: toLegacyNavigationPayload(defaults)
    },
    {
      key: "siteContent",
      label: "\u05EA\u05D5\u05DB\u05DF \u05D0\u05EA\u05E8",
      fileName: "site_content_data.txt",
      data: toLegacySiteContentPayload(defaults)
    },
    {
      key: "theme",
      label: "\u05E2\u05D9\u05E6\u05D5\u05D1",
      fileName: "theme_data.txt",
      data: toLegacyThemePayload(defaults)
    },
    {
      key: "widgets",
      label: "\u05D5\u05D5\u05D9\u05D3\u05D2\u05D8\u05D9\u05DD",
      fileName: "widgets_data.txt",
      data: toLegacyWidgetsPayload(defaults)
    },
    {
      key: "externalLinks",
      label: "\u05E7\u05D9\u05E9\u05D5\u05E8\u05D9\u05DD \u05D7\u05D9\u05E6\u05D5\u05E0\u05D9\u05D9\u05DD",
      fileName: "external_links_data.txt",
      data: toLegacyExternalLinksPayload(defaults)
    },
    {
      key: "gantt",
      label: "\u05D2\u05D0\u05E0\u05D8",
      fileName: "gantt_data.txt",
      data: clone(DEFAULT_GANTT_DATA)
    },
    {
      key: "boom",
      label: "BOOM",
      fileName: "boom_data.txt",
      data: createInitialBoomData(today)
    }
  ].map((entry) => Object.freeze({
    ...entry,
    data: clone(entry.data)
  }));
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/provisioning/siteProvisioning.js
var isNotFound = (error) => error?.statusCode === 404 || error?.code === "not_found";
function toProvisionItem(entry, snapshot = null) {
  const version = Number(snapshot?.version);
  return {
    key: entry.key,
    fileName: entry.fileName,
    label: entry.label,
    exists: Boolean(snapshot && snapshot.missing !== true),
    missing: !snapshot || snapshot.missing === true,
    version: Number.isInteger(version) && version >= 0 ? version : 0
  };
}
async function inspectSiteProvisioning({ siteId, repository, legacyRepository, today = /* @__PURE__ */ new Date() }) {
  const seedEntries = buildCanonicalLegacySeedEntries({ today });
  let site = null;
  try {
    site = await repository.getSite(siteId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (!site) {
    const items2 = seedEntries.map((entry) => toProvisionItem(entry));
    return {
      site: null,
      siteExists: false,
      provisioned: false,
      totalDefaults: items2.length,
      existingDefaults: 0,
      missingDefaults: items2.length,
      items: items2
    };
  }
  const snapshots = await Promise.all(
    seedEntries.map((entry) => legacyRepository.readLegacyObject(siteId, entry.fileName, { allowMissing: true }))
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
    items
  };
}
async function provisionSiteDefaults({
  siteId,
  repository,
  legacyRepository,
  actor = "api",
  siteSlug,
  displayName,
  status,
  publicRead,
  today = /* @__PURE__ */ new Date()
} = {}) {
  await repository.initIndexes();
  const before = await inspectSiteProvisioning({ siteId, repository, legacyRepository, today });
  const site = await repository.ensureSite({
    siteId,
    siteSlug,
    displayName,
    ...status ? { status } : {},
    ...publicRead !== void 0 ? { publicRead } : {},
    actor
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
        provisioning: "canonical-defaults",
        seedKey: entry.key
      }
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
    provisionStatus
  };
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/server/src/validation/schemas.js
var schemas_exports = {};
__export(schemas_exports, {
  backupCreateSchema: () => backupCreateSchema,
  backupDeleteSchema: () => backupDeleteSchema,
  backupRestoreSchema: () => backupRestoreSchema,
  batchReadSchema: () => batchReadSchema,
  batchWriteSchema: () => batchWriteSchema,
  createSiteSchema: () => createSiteSchema,
  entityIdSchema: () => entityIdSchema,
  jsonDataSchema: () => jsonDataSchema,
  legacyBatchReadSchema: () => legacyBatchReadSchema,
  legacyBatchWriteSchema: () => legacyBatchWriteSchema,
  legacyWriteSchema: () => legacyWriteSchema,
  parseOrBadRequest: () => parseOrBadRequest,
  patchDataSchema: () => patchDataSchema,
  provisionSiteSchema: () => provisionSiteSchema,
  putDataSchema: () => putDataSchema,
  scopeSchema: () => scopeSchema,
  siteIdSchema: () => siteIdSchema,
  siteSlugSchema: () => siteSlugSchema
});
var import_zod = require("zod");
var siteIdSchema = import_zod.z.string().trim().min(1).max(160);
var siteSlugSchema = import_zod.z.string().trim().min(1).max(160).optional();
var scopeSchema = import_zod.z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
var entityIdSchema = import_zod.z.string().trim().min(1).max(512).refine((value) => !value.includes("\0"), {
  message: "entityId cannot contain null bytes"
});
var jsonDataSchema = import_zod.z.union([
  import_zod.z.record(import_zod.z.string(), import_zod.z.unknown()),
  import_zod.z.array(import_zod.z.unknown())
]);
var createSiteSchema = import_zod.z.object({
  siteId: siteIdSchema,
  siteSlug: siteSlugSchema,
  displayName: import_zod.z.string().trim().max(240).optional(),
  status: import_zod.z.enum(["active", "disabled", "archived"]).optional(),
  publicRead: import_zod.z.boolean().optional()
});
var provisionSiteSchema = createSiteSchema.omit({ siteId: true });
var putDataSchema = import_zod.z.object({
  data: jsonDataSchema,
  expectedVersion: import_zod.z.number().int().min(0).optional(),
  allowEmptyOverwrite: import_zod.z.boolean().optional()
});
var patchDataSchema = import_zod.z.object({
  patch: jsonDataSchema.optional(),
  data: jsonDataSchema.optional(),
  expectedVersion: import_zod.z.number().int().min(0).optional(),
  allowEmptyOverwrite: import_zod.z.boolean().optional()
}).refine((value) => value.patch !== void 0 || value.data !== void 0, {
  message: "PATCH requires patch or data"
});
var batchReadSchema = import_zod.z.object({
  items: import_zod.z.array(import_zod.z.object({
    scope: scopeSchema,
    entityId: entityIdSchema
  })).min(1).max(200)
});
var batchWriteSchema = import_zod.z.object({
  operations: import_zod.z.array(import_zod.z.object({
    op: import_zod.z.enum(["put", "patch", "delete"]),
    scope: scopeSchema,
    entityId: entityIdSchema,
    data: jsonDataSchema.optional(),
    patch: jsonDataSchema.optional(),
    expectedVersion: import_zod.z.number().int().min(0).optional(),
    allowEmptyOverwrite: import_zod.z.boolean().optional()
  })).min(1).max(200)
});
var legacyWriteSchema = import_zod.z.object({
  key: import_zod.z.string().trim().min(1).max(1024),
  data: jsonDataSchema,
  expectedVersion: import_zod.z.number().int().min(0).optional(),
  allowEmptyOverwrite: import_zod.z.boolean().optional()
});
var legacyBatchReadSchema = import_zod.z.object({
  keys: import_zod.z.array(import_zod.z.string().trim().min(1).max(1024)).min(1).max(100)
});
var legacyBatchWriteSchema = import_zod.z.object({
  items: import_zod.z.array(legacyWriteSchema).min(1).max(100)
});
var backupCreateSchema = import_zod.z.object({
  backupPackage: import_zod.z.unknown(),
  name: import_zod.z.string().trim().max(240).optional(),
  description: import_zod.z.string().trim().max(2e3).optional()
});
var backupDeleteSchema = import_zod.z.object({
  expectedVersion: import_zod.z.number().int().min(0).optional()
}).optional();
var restoreUnitIdSchema = import_zod.z.string().trim().min(1).max(220);
var backupIdSchema = import_zod.z.string().trim().min(1).max(160);
var backupRestoreSchema = import_zod.z.object({
  allowSiteIdMismatch: import_zod.z.boolean().optional(),
  expectedBackupVersion: import_zod.z.number().int().min(0).optional(),
  preRestoreBackupId: backupIdSchema.optional(),
  selectedRestoreUnitIds: import_zod.z.array(restoreUnitIdSchema).min(1).optional()
}).optional();
function parseOrBadRequest(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest("Invalid request payload", parsed.error.flatten());
  }
  return parsed.data;
}

// ../../../../../private/var/folders/zn/ccdmnr292dq56nqtjfh6brwh0000gn/T/srm-site-builder-domain-Pl261D/adapter.js
async function createDailyDataDomain({ db, collectionPrefix }) {
  const repository = new SiteDataRepository(db, { collectionPrefix });
  const legacyRepository = new LegacyCompatibilityRepository(repository);
  const backupRepository = new SiteBackupRepository(repository, legacyRepository);
  await repository.initIndexes();
  return Object.freeze({
    repository,
    legacyRepository,
    backupRepository,
    inspectSiteProvisioning: (siteId) => inspectSiteProvisioning({ siteId, repository, legacyRepository }),
    provisionSiteDefaults: (options) => provisionSiteDefaults({ ...options, repository, legacyRepository }),
    schemas: schemas_exports
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createDailyDataDomain
});
