import { LEGACY_MAPPINGS } from './legacyMappings.js';
import { badRequest } from '../utils/errors.js';

export const BACKUP_SCOPE = 'backups';
export const BACKUP_SOURCE = 'admin-backup-management';
export const MAX_BACKUP_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const BACKUP_PACKAGE_KIND = 'bihs-backup-package';

const textEncoder = new TextEncoder();
const LEGACY_FILE_NAMES = new Set(LEGACY_MAPPINGS.map((mapping) => mapping.fileName));
const EXPECTED_LEGACY_FILE_NAMES = LEGACY_MAPPINGS.map((mapping) => mapping.fileName);

const nowIso = () => new Date().toISOString();
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

function byteLength(value) {
  return textEncoder.encode(JSON.stringify(value)).length;
}

function sanitizeBackupId(value = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.slice(0, 160);
}

function sanitizeRestoreUnitToken(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildRestoreUnitId(entry = {}, backupId = '') {
  const fileName = sanitizeRestoreUnitToken(entry.fileName || entry.name || '');
  const scope = sanitizeRestoreUnitToken(entry.scope || '');
  const entityId = sanitizeRestoreUnitToken(entry.entityId || '');
  const mappingKey = sanitizeRestoreUnitToken(entry.mappingKey || '');
  const normalizedBackupId = sanitizeRestoreUnitToken(backupId || '');
  const baseParts = [normalizedBackupId || 'backup', fileName || 'file', scope || 'scope', entityId || 'entity', mappingKey || 'key'];
  return `ru-${baseParts.join('-')}`;
}

function createBackupId(createdAt = nowIso()) {
  return `backup-${createdAt.replace(/[:.]/g, '-')}`;
}

function normalizeFile(file, index) {
  if (!isObject(file)) throw badRequest(`Backup file at index ${index} must be an object.`);
  const name = String(file.name || '').trim();
  if (!name) throw badRequest(`Backup file at index ${index} is missing name.`);
  if (typeof file.text !== 'string') throw badRequest(`Backup file "${name}" is missing text.`);
  return {
    ...file,
    name,
    text: file.text,
    sizeBytes: Number.isFinite(Number(file.sizeBytes))
      ? Number(file.sizeBytes)
      : textEncoder.encode(file.text).length,
  };
}

export function normalizeBackupPackage(candidate, { fallbackId = '', createdAt = nowIso() } = {}) {
  if (!isObject(candidate)) throw badRequest('Backup package must be a JSON object.');
  const sourceFiles = Array.isArray(candidate.files) ? candidate.files : [];
  if (sourceFiles.length === 0) throw badRequest('Backup package must include at least one file.');

  const files = sourceFiles.map(normalizeFile);
  const id = sanitizeBackupId(candidate.id || candidate.backup?.id || fallbackId || createBackupId(createdAt));
  if (!id) throw badRequest('Backup package id is invalid.');

  return {
    ...cloneJson(candidate),
    kind: candidate.kind || BACKUP_PACKAGE_KIND,
    version: candidate.version || '1.0.0',
    id,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : createdAt,
    source: typeof candidate.source === 'string' ? candidate.source : BACKUP_SOURCE,
    backup: {
      ...(isObject(candidate.backup) ? cloneJson(candidate.backup) : {}),
      id,
      name: typeof candidate.backup?.name === 'string' ? candidate.backup.name : '',
      timeCreated: typeof candidate.backup?.timeCreated === 'string' ? candidate.backup.timeCreated : createdAt,
      timeLastModified: typeof candidate.backup?.timeLastModified === 'string' ? candidate.backup.timeLastModified : createdAt,
    },
    files,
    meta: isObject(candidate.meta) ? cloneJson(candidate.meta) : {},
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
  return error?.statusCode === 404 || error?.code === 'not_found';
}

function countLegacyRecords(mapping, data) {
  if (mapping.mode === 'list') {
    return Array.isArray(data) ? data.length : 0;
  }

  if (mapping.mode === 'list-with-settings') {
    return Array.isArray(data?.[mapping.listProperty]) ? data[mapping.listProperty].length : 0;
  }
  if (Array.isArray(data)) return data.length;
  if (isObject(data)) return Object.keys(data).length > 0 ? 1 : 0;
  return data === null || data === undefined ? 0 : 1;
}

function validateLegacyPayload(mapping, data, fileName) {
  if (!mapping) throw badRequest(`Backup file "${fileName}" has no supported restore destination.`);
  if (data === null) {
    throw badRequest(`Backup file "${fileName}" contains null instead of a restorable ${mapping.mode} payload.`);
  }
  if (mapping.mode === 'list' && !Array.isArray(data)) {
    throw badRequest(`Backup file "${fileName}" must contain a JSON array.`);
  }
  if (mapping.mode === 'list-with-settings'
    && (!isObject(data) || !Array.isArray(data[mapping.listProperty]))) {
    throw badRequest(`Backup file "${fileName}" must contain an "${mapping.listProperty}" array.`);
  }
  if (mapping.mode === 'singleton' && !isObject(data)) {
    throw badRequest(`Backup file "${fileName}" must contain a JSON object.`);
  }
}

function hasLegacySettings(mapping, data) {
  if (mapping.mode !== 'list-with-settings' || !isObject(data)) return false;
  return Object.keys(data).some((key) => key !== mapping.listProperty);
}

function isEmptyLegacyData(mapping, data) {
  if (mapping.mode === 'list') {
    return !Array.isArray(data) || data.length === 0;
  }
  if (mapping.mode === 'list-with-settings') {
    return countLegacyRecords(mapping, data) === 0 && !hasLegacySettings(mapping, data);
  }
  if (Array.isArray(data)) return data.length === 0;
  if (isObject(data)) return Object.keys(data).length === 0;
  return data === null || data === undefined || data === '';
}

function fallbackTextForMissingFile() {
  return 'null';
}

function backupFileStatusFromEntry(entry = {}) {
  if (entry.invalid) return 'invalid';
  if (entry.missing) return 'missing';
  if (entry.restoreStatus) return entry.restoreStatus;
  if (entry.status) return entry.status;
  if (entry.empty) return 'empty';
  return 'hasData';
}

function isEntryRestorable(entry = {}) {
  const status = backupFileStatusFromEntry(entry);
  return entry.willRestore !== false
    && entry.restoreAction !== 'skipped'
    && status !== 'missing'
    && status !== 'invalid';
}

function inferEntryFromFile(file) {
  const mapping = LEGACY_MAPPINGS.find((item) => item.fileName === file.name);
  const status = backupFileStatusFromEntry(file);
  const willRestore = LEGACY_FILE_NAMES.has(file.name) && isEntryRestorable(file);
  return {
    fileName: file.name,
    scope: file.scope || mapping?.scope || '',
    entityId: file.entityId || mapping?.entityId || '',
    mappingKey: file.mappingKey || mapping?.key || '',
    status,
    restoreStatus: status,
    restoreAction: willRestore ? 'will_restore' : 'skipped',
    willRestore,
    empty: Boolean(file.empty) || status === 'empty',
    missing: Boolean(file.missing) || status === 'missing',
    invalid: Boolean(file.invalid) || status === 'invalid',
    recordCount: (() => {
      if (!mapping || typeof file.text !== 'string') {
        return Number.isFinite(Number(file.recordCount)) ? Number(file.recordCount) : 0;
      }
      try {
        return countLegacyRecords(mapping, JSON.parse(file.text));
      } catch {
        return Number.isFinite(Number(file.recordCount)) ? Number(file.recordCount) : 0;
      }
    })(),
    documentCount: Number.isFinite(Number(file.documentCount)) ? Number(file.documentCount) : 0,
    version: Number.isFinite(Number(file.version)) ? Number(file.version) : undefined,
    hash: typeof file.hash === 'string' ? file.hash : '',
    source: typeof file.source === 'string' ? file.source : '',
    sizeBytes: Number(file.sizeBytes) || textEncoder.encode(file.text || '').length,
  };
}

function restoreEntriesFromPackage(backupPackage, { backupId = '' } = {}) {
  const files = Array.isArray(backupPackage?.files) ? backupPackage.files : [];
  const filesByName = new Map(files.map((file) => [file.name, file]));
  const sourceEntries = Array.isArray(backupPackage?.meta?.restoreEntries)
    ? backupPackage.meta.restoreEntries
    : [];

  if (sourceEntries.length > 0) {
    return sourceEntries.map((entry) => {
      const sourceEntry = isObject(entry) ? entry : {};
      const fileName = String(sourceEntry.fileName || sourceEntry.name || '').trim();
      const file = filesByName.get(fileName) || {};
      const inferredEntry = inferEntryFromFile({
        ...file,
        ...sourceEntry,
        name: fileName || file.name,
      });
      const summarized = summarizeEntry({
        ...inferredEntry,
        ...cloneJson(sourceEntry),
        fileName: fileName || file.name,
        name: fileName || file.name,
        sizeBytes: Number(sourceEntry.sizeBytes || file.sizeBytes || 0),
        backupId,
      });
      return {
        ...cloneJson(sourceEntry),
        ...summarized,
      };
    }).filter((entry) => entry.fileName);
  }

  return files.map((file) => summarizeEntry({
    ...inferEntryFromFile(file),
    backupId,
    fileName: file.name,
    name: file.name,
    sizeBytes: Number(file.sizeBytes || 0),
  }));
}

function summarizeEntry(entry) {
  const backupId = String(entry.backupId || '').trim();
  return {
    fileName: entry.fileName,
    name: entry.fileName,
    scope: entry.scope || '',
    entityId: entry.entityId || '',
    mappingKey: entry.mappingKey || '',
    status: entry.status || backupFileStatusFromEntry(entry),
    restoreStatus: entry.restoreStatus || entry.status || backupFileStatusFromEntry(entry),
    restoreAction: entry.restoreAction || (entry.willRestore === false ? 'skipped' : 'will_restore'),
    willRestore: entry.willRestore !== false,
    empty: Boolean(entry.empty),
    missing: Boolean(entry.missing),
    invalid: Boolean(entry.invalid),
    recordCount: Number(entry.recordCount || 0),
    documentCount: Number(entry.documentCount || 0),
    version: entry.version,
    hash: entry.hash || '',
    source: entry.source || '',
    sizeBytes: Number(entry.sizeBytes || 0),
    restoreUnitId: typeof entry.restoreUnitId === 'string' && entry.restoreUnitId.trim()
      ? entry.restoreUnitId
      : buildRestoreUnitId(entry, backupId),
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
    hasMasterConfig: fileNames.includes('bihs_master_config_v1.txt'),
    restorableFiles: restoreEntries
      .filter((entry) => LEGACY_FILE_NAMES.has(entry.fileName) && isEntryRestorable(entry))
      .map((entry) => entry.fileName),
    expectedFiles: EXPECTED_LEGACY_FILE_NAMES,
    missingExpectedFiles: EXPECTED_LEGACY_FILE_NAMES.filter((fileName) => (
      !restoreEntries.some((entry) => entry.fileName === fileName && entry.status !== 'missing')
    )),
  };
}

function ensureSizeWithinLimit(data, maxDocumentBytes) {
  const sizeBytes = byteLength(data);
  if (sizeBytes > maxDocumentBytes) {
    throw badRequest(
      `Backup package is too large for single-document Mongo storage (${sizeBytes} bytes, limit ${maxDocumentBytes} bytes). Future chunked backup support is required for this backup.`,
      { sizeBytes, maxDocumentBytes },
    );
  }
  return sizeBytes;
}

function toBackupListItem(document) {
  const data = document.data || {};
  const summary = data.summary || {};
  const backupId = data.backupId || document.entityId;
  const createdAt = data.createdAt || document.createdAt?.toISOString?.() || '';
  const updatedAt = document.updatedAt?.toISOString?.() || createdAt;
  return {
    id: backupId,
    name: data.name || '',
    description: data.description || '',
    source: data.source || BACKUP_SOURCE,
    storageBackend: data.storageBackend || 'mongo',
    serverRelativeUrl: `mongo-backup:${backupId}`,
    url: '',
    timeCreated: createdAt,
    timeLastModified: updatedAt,
    createdAt,
    createdBy: data.createdBy || document.createdBy || '',
    fileCount: Number(summary.fileCount || 0),
    totalSizeBytes: Number(data.sizeBytes || summary.totalSizeBytes || 0),
    summary,
    files: Array.isArray(summary.files) ? summary.files : [],
    version: document.version,
    entityId: document.entityId,
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
      deletedAt: document.deletedAt,
    },
  };
}

export class SiteBackupRepository {
  constructor(siteDataRepository, legacyRepository, options = {}) {
    this.repository = siteDataRepository;
    this.legacyRepository = legacyRepository;
    this.maxDocumentBytes = Number(options.maxDocumentBytes || MAX_BACKUP_DOCUMENT_BYTES);
  }

  shouldCaptureCurrentSiteSnapshot(backupPackage) {
    if (backupPackage?.meta?.captureStrategy === 'server-full-site') return true;
    if (backupPackage?.meta?.fullSiteSnapshot === true) return true;
    if (backupPackage?.meta?.importedAt) return false;

    const files = Array.isArray(backupPackage?.files) ? backupPackage.files : [];
    return backupPackage?.source === BACKUP_SOURCE
      && files.length === 1
      && files[0]?.name === 'bihs_master_config_v1.txt';
  }

  async buildCurrentSiteSnapshotPackage({ siteId, basePackage, createdAt, actor }) {
    if (!this.legacyRepository) {
      throw badRequest('legacyRepository is required to capture a full site backup snapshot.');
    }

    const requestFilesByName = new Map(
      (Array.isArray(basePackage.files) ? basePackage.files : [])
        .map((file) => [file.name, file]),
    );
    const files = [];
    const restoreEntries = [];

    for (const mapping of LEGACY_MAPPINGS) {
      const requestFile = requestFilesByName.get(mapping.fileName);
      let data = null;
      let snapshot = null;
      let source = 'mongo-live';
      let status = 'missing';
      let willRestore = false;

      try {
        snapshot = await this.legacyRepository.readLegacyObject(siteId, mapping.fileName);
        data = cloneJson(snapshot.data);
        status = isEmptyLegacyData(mapping, data) ? 'empty' : 'hasData';
        willRestore = true;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        if (requestFile && typeof requestFile.text === 'string' && requestFile.text.trim()) {
          data = parseFileJson(requestFile);
          source = 'request-payload';
          status = isEmptyLegacyData(mapping, data) ? 'empty' : 'hasData';
          willRestore = true;
        }
      }

      const text = willRestore
        ? JSON.stringify(data, null, 2)
        : fallbackTextForMissingFile(mapping);
      const sizeBytes = textEncoder.encode(text).length;
      const entry = summarizeEntry({
        fileName: mapping.fileName,
        name: mapping.fileName,
        scope: mapping.scope,
        entityId: mapping.entityId || '',
        mappingKey: mapping.key,
        status,
        restoreStatus: status,
        restoreAction: willRestore ? 'will_restore' : 'skipped',
        willRestore,
        empty: status === 'empty',
        missing: status === 'missing',
        invalid: false,
        recordCount: willRestore ? countLegacyRecords(mapping, data) : 0,
        documentCount: snapshot?.documents?.length || 0,
        version: snapshot?.version,
        hash: snapshot?.hash || '',
        source,
        sizeBytes,
        backupId: basePackage.id,
      });

      files.push({
        name: mapping.fileName,
        label: requestFile?.label || '',
        targetServerRelativeUrl: requestFile?.targetServerRelativeUrl || '',
        timeCreated: createdAt,
        timeLastModified: createdAt,
        text,
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
        source: entry.source,
      });
      restoreEntries.push(entry);
    }

    const indexes = buildRestoreIndexes(restoreEntries);

    return normalizeBackupPackage({
      ...cloneJson(basePackage),
      source: BACKUP_SOURCE,
      backup: {
        ...(isObject(basePackage.backup) ? cloneJson(basePackage.backup) : {}),
        id: basePackage.id,
        timeCreated: basePackage.backup?.timeCreated || createdAt,
        timeLastModified: createdAt,
      },
      files,
      exportedAt: basePackage.exportedAt || createdAt,
      meta: {
        ...(isObject(basePackage.meta) ? cloneJson(basePackage.meta) : {}),
        siteId,
        captureStrategy: 'server-full-site',
        capturedAt: createdAt,
        capturedBy: actor,
        expectedLegacyFiles: EXPECTED_LEGACY_FILE_NAMES,
        restoreEntries: restoreEntries.map(summarizeEntry),
        legacyObjects: indexes.legacyObjects,
        scopes: indexes.scopes,
      },
    }, { fallbackId: basePackage.id, createdAt });
  }

  async listBackups(siteId) {
    const documents = await this.repository.listDocuments(siteId, BACKUP_SCOPE);
    return documents
      .map(toBackupListItem)
      .sort((a, b) => Date.parse(b.timeLastModified || b.timeCreated || '') - Date.parse(a.timeLastModified || a.timeCreated || ''));
  }

  async getBackup(siteId, backupId) {
    const document = await this.repository.getDocument(siteId, BACKUP_SCOPE, backupId);
    return toFullBackup(document);
  }

  async createBackup({
    siteId,
    backupPackage,
    name = '',
    description = '',
    actor = 'api',
    metadata = {},
  }) {
    const createdAt = nowIso();
    const requestedPackage = normalizeBackupPackage(backupPackage, { createdAt });
    const normalizedPackage = this.shouldCaptureCurrentSiteSnapshot(requestedPackage)
      ? await this.buildCurrentSiteSnapshotPackage({
          siteId,
          basePackage: requestedPackage,
          createdAt,
          actor,
        })
      : requestedPackage;
    const backupId = normalizedPackage.id;
    const summary = summarizePackage(normalizedPackage);
    const data = {
      backupId,
      name: String(name || normalizedPackage.backup?.name || `backup-${createdAt}`).trim(),
      description: String(description || '').trim(),
      createdAt,
      createdBy: actor,
      source: BACKUP_SOURCE,
      summary,
      snapshot: normalizedPackage,
      sizeBytes: 0,
      storageBackend: 'mongo',
      siteId,
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
      operation: 'admin-backup-create',
    });

    await this.repository.writeAuditLog({
      siteId,
      documentKey: document._id,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      operation: 'admin-backup-create',
      result: 'ok',
      actor,
      metadata: { ...metadata, backupId, sizeBytes: data.sizeBytes },
    });

    return toFullBackup(document);
  }

  async deleteBackup({ siteId, backupId, expectedVersion = undefined, actor = 'api', metadata = {} }) {
    const current = await this.repository.getDocument(siteId, BACKUP_SCOPE, backupId);
    const document = await this.repository.softDeleteDocument({
      siteId,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      expectedVersion: expectedVersion ?? current.version,
      actor,
      metadata: { ...metadata, backupId },
    });

    await this.repository.writeAuditLog({
      siteId,
      documentKey: document._id,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      operation: 'admin-backup-delete',
      result: 'ok',
      actor,
      metadata: { ...metadata, backupId },
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
    actor = 'api',
    metadata = {},
  }) {
    if (!this.legacyRepository) {
      throw new Error('legacyRepository is required for backup restore.');
    }

    const backup = await this.getBackup(siteId, backupId);
    if (expectedBackupVersion !== undefined && Number(backup.version) !== Number(expectedBackupVersion)) {
      throw badRequest('Backup was modified since preview was generated. Reload the preview and retry.', {
        expectedBackupVersion,
        currentBackupVersion: backup.version,
      });
    }

    const backupPackage = normalizeBackupPackage(backup.backupPackage, { fallbackId: backupId });
    const packageSiteId = String(backupPackage.meta?.siteId || backup.data?.siteId || '').trim();
    if (packageSiteId && packageSiteId !== siteId && !allowSiteIdMismatch) {
      throw badRequest('Backup siteId does not match restore target siteId.', {
        backupSiteId: packageSiteId,
        targetSiteId: siteId,
      });
    }

    const restoreEntries = restoreEntriesFromPackage(backupPackage, { backupId });
    const restoreEntryById = new Map();

    for (const entry of restoreEntries) {
      if (!entry.fileName) {
        throw badRequest('Restore entries are missing file names.');
      }
      const restoreUnitId = String(entry.restoreUnitId || '').trim();
      if (!restoreUnitId) {
        throw badRequest('Restore entries are missing stable identifiers.', { fileName: entry.fileName });
      }
      if (restoreEntryById.has(restoreUnitId)) {
        throw badRequest('Backup restore entries contain duplicate identifiers.', {
          restoreUnitId,
        });
      }
      restoreEntryById.set(restoreUnitId, entry);
    }

    const requestedRestoreUnitIds = selectedRestoreUnitIds === undefined
      ? null
      : selectedRestoreUnitIds.map((entryId) => String(entryId || '').trim()).filter(Boolean);
    if (requestedRestoreUnitIds !== null && requestedRestoreUnitIds.length === 0) {
      throw badRequest('Restore selection cannot be empty. Select at least one restore item.');
    }

    const duplicateSelectionIds = [];
    const seenSelectionIds = new Set();
    for (const restoreUnitId of requestedRestoreUnitIds || []) {
      if (seenSelectionIds.has(restoreUnitId)) {
        duplicateSelectionIds.push(restoreUnitId);
      }
      seenSelectionIds.add(restoreUnitId);
    }
    if (duplicateSelectionIds.length > 0) {
      throw badRequest('Restore selection contains duplicate items.', {
        duplicateRestoreUnitIds: duplicateSelectionIds,
      });
    }

    const unknownSelectionIds = (requestedRestoreUnitIds || []).filter((restoreUnitId) => !restoreEntryById.has(restoreUnitId));
    if (unknownSelectionIds.length > 0) {
      throw badRequest('One or more selected restore units were not found in this backup.', {
        restoreUnitIds: unknownSelectionIds,
      });
    }

    const selectedEntries = requestedRestoreUnitIds === null
      ? Array.from(restoreEntryById.values())
          .filter((entry) => LEGACY_FILE_NAMES.has(entry.fileName) && isEntryRestorable(entry))
      : requestedRestoreUnitIds.map((restoreUnitId) => {
        const entry = restoreEntryById.get(restoreUnitId);
        if (!isEntryRestorable(entry)) {
          throw badRequest('One or more selected restore units are not restorable.', {
            restoreUnitId,
            restoreAction: entry?.restoreAction,
            status: entry?.status,
          });
        }
        return entry;
      });

    if (selectedEntries.length === 0) {
      throw badRequest('Backup package does not contain restorable Site Builder files.');
    }

    const filesByName = new Map(backupPackage.files.map((file) => [file.name, file]));
    const selectedRestoreUnitSet = new Set(selectedEntries.map((entry) => entry.restoreUnitId));
    const filesToRestore = selectedEntries
      .filter((entry) => LEGACY_FILE_NAMES.has(entry.fileName))
      .map((entry) => ({
        entry,
        file: filesByName.get(entry.fileName),
      }));

    // Validate every selected payload before the first write so an invalid
    // package cannot produce a partially applied restore.
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
    const notSelectedEntries = restoreEntries
      .filter((entry) => !selectedRestoreUnitSet.has(entry.restoreUnitId));
    const notSelected = notSelectedEntries.map((entry) => ({
      restoreUnitId: entry.restoreUnitId,
      fileName: entry.fileName,
      scope: entry.scope,
      entityId: entry.entityId,
      status: entry.status,
      restoreAction: entry.restoreAction,
      selected: false,
      outcome: 'not_selected',
      reason: 'not_selected',
      empty: Boolean(entry.empty),
      missing: Boolean(entry.missing),
      invalid: Boolean(entry.invalid),
    }));

    for (const { entry, file } of filesToRestore) {
      try {
        const data = parseFileJson(file);
        let expectedVersion = 0;
        try {
          const current = await this.legacyRepository.readLegacyObject(siteId, file.name);
          expectedVersion = current.version;
        } catch (error) {
          if (error.statusCode !== 404 && error.code !== 'not_found') throw error;
        }
        const result = await this.legacyRepository.writeLegacyObject({
          siteId,
          key: file.name,
          data,
          expectedVersion,
          allowEmptyOverwrite: true,
          actor,
          metadata: { ...metadata, backupId, restore: true },
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
          outcome: 'restored',
          clearOrReplace: Boolean(entry.empty),
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
          outcome: 'failed',
          message: restoreError?.message || 'Restore entry failed.',
        });
      }
    }

    const restoredItemCount = restored.length;
    const failedItemCount = failed.length;
    const restoreStatus = failedItemCount > 0 ? (restoredItemCount > 0 ? 'partial' : 'failed') : 'completed';
    const selectedRecordCount = selectedEntries.reduce((sum, entry) => sum + (Number(entry.recordCount) || 0), 0);
    const clearOrReplaceActions = restored
      .filter((entry) => entry.clearOrReplace)
      .map((entry) => ({
        restoreUnitId: entry.restoreUnitId,
        fileName: entry.fileName,
        scope: entry.scope,
        entityId: entry.entityId,
        status: entry.status,
        restoreAction: entry.restoreAction,
      }));

    const selectedRestoreUnitIdsOut = requestedRestoreUnitIds === null
      ? selectedEntries.map((entry) => entry.restoreUnitId)
      : requestedRestoreUnitIds;

    await this.repository.writeAuditLog({
      siteId,
      documentKey: `backup:${backupId}`,
      scope: BACKUP_SCOPE,
      entityId: backupId,
      operation: 'admin-backup-restore',
      result: restoreStatus === 'completed' ? 'ok' : 'partial',
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
          recordCount: Number(entry.recordCount || 0),
        })),
        notSelectedItems: notSelectedEntries.map((entry) => ({
          restoreUnitId: entry.restoreUnitId,
          fileName: entry.fileName,
          scope: entry.scope,
          entityId: entry.entityId,
          status: entry.status,
          restoreAction: entry.restoreAction,
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
            restoreAction: item.restoreAction,
          })),
          ...notSelected.map((item) => ({
            restoreUnitId: item.restoreUnitId,
            fileName: item.fileName,
            scope: item.scope,
            entityId: item.entityId,
            outcome: item.outcome,
            status: item.status,
            restoreAction: item.restoreAction,
            reason: item.reason,
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
            message: item.message,
          })),
        ],
      },
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
      notSelectedRestoreUnits: notSelected.map((entry) => entry.restoreUnitId),
    };
  }
}

export default SiteBackupRepository;
