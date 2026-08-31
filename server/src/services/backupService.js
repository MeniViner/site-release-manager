import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { buildSiteIdentity, buildTxtSeedPlan, canonicalTargetKey } from '../../../shared/siteRuntime.js';

export const BACKUP_TRIGGER = 'PRE_DEPLOY';
export const BACKUP_OUTCOMES = Object.freeze([
  'IN_PROGRESS',
  'PASSED',
  'PARTIAL',
  'FAILED',
  'SKIPPED_FRESH_TARGET',
  'SKIPPED_UNSUPPORTED_BACKEND',
]);

const text = (value, max = 1000) => String(value ?? '').slice(0, max);
const validDate = (value, fallback = new Date()) => {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

function sanitizeFileEntries(value, kind) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((entry) => ({
    fileName: text(entry?.fileName, 180),
    sourcePath: text(entry?.sourcePath, 600),
    targetPath: text(entry?.targetPath, 600),
    operation: text(entry?.operation, 100),
    reason: text(entry?.reason, 200),
    error: text(entry?.error, 1200),
    errorClass: text(entry?.errorClass, 100),
    httpStatus: entry?.httpStatus == null ? null : Number(entry.httpStatus),
    size: kind === 'copied' ? Math.max(0, Number(entry?.size || 0)) : 0,
    sha256: kind === 'copied' ? text(entry?.sha256, 64) : '',
    verified: kind === 'copied' && entry?.verified === true,
  }));
}

function snapshotDocument({ job, site, release, now = new Date() }) {
  const identity = buildSiteIdentity(site);
  const txtFileCount = identity.storageBackend === 'txt' ? buildTxtSeedPlan(identity).length : 0;
  return {
    siteId: site._id,
    runId: job._id,
    targetKey: job.targetKey || canonicalTargetKey(identity),
    storageBackend: identity.storageBackend,
    strategy: identity.storageBackend === 'txt' ? 'SHAREPOINT_TXT_FILES' : 'MONGO_NOT_IMPLEMENTED',
    trigger: BACKUP_TRIGGER,
    outcome: 'IN_PROGRESS',
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    sourceVersion: text(site.currentVersion, 80),
    sourceReleaseId: site.currentReleaseId || null,
    incomingVersion: text(release.version, 80),
    incomingReleaseId: release._id,
    backupPath: '',
    backupUrl: '',
    fileCount: txtFileCount,
    copiedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    copiedFiles: [],
    skippedFiles: [],
    failedFiles: [],
    totalSizeBytes: 0,
    verificationStatus: 'PENDING',
    warningDetails: [],
    errorDetails: [],
    target: {
      host: identity.host,
      siteCode: identity.siteCode,
      siteDbFolder: identity.siteDbFolder,
      siteDbRoot: identity.siteDbRoot,
      usersDbFolder: identity.usersDbFolder,
      usersDbRoot: identity.usersDbRoot,
      siteAssetsRoot: identity.siteAssetsRoot,
      widgetsDbTarget: identity.widgetsDbTarget,
      finalAppUrl: identity.finalAppUrl,
    },
    siteSnapshot: {
      name: text(site.name, 200),
      unit: text(site.unit, 200),
      managerName: text(site.managerName, 200),
    },
    updatedAt: now,
  };
}

export function publicBackup(record, site = null) {
  if (!record) return null;
  return {
    ...record,
    id: String(record._id),
    _id: undefined,
    siteId: String(record.siteId),
    runId: String(record.runId),
    sourceReleaseId: record.sourceReleaseId ? String(record.sourceReleaseId) : null,
    incomingReleaseId: record.incomingReleaseId ? String(record.incomingReleaseId) : null,
    site: {
      id: site?._id ? String(site._id) : String(record.siteId),
      name: site?.name || record.siteSnapshot?.name || 'אתר שנמחק מהמעקב',
      unit: site?.unit || record.siteSnapshot?.unit || '',
      finalUrl: site?.finalUrl || record.target?.finalAppUrl || '',
      host: site?.host || record.target?.host || '',
      siteCode: site?.siteCode || record.target?.siteCode || '',
      siteDbFolder: site?.siteDbFolder || record.target?.siteDbFolder || '',
      usersDbFolder: site?.usersDbFolder || record.target?.usersDbFolder || '',
      tracked: Boolean(site),
    },
  };
}

export async function startBackupRecord({ job, site, release, startedAt }) {
  const collection = getDb().collection('backups');
  const existing = await collection.findOne({ runId: job._id, trigger: BACKUP_TRIGGER });
  if (existing && existing.outcome !== 'IN_PROGRESS') {
    return { reused: true, backup: existing };
  }
  if (existing) return { reused: false, backup: existing };

  const now = validDate(startedAt);
  const document = snapshotDocument({ job, site, release, now });
  try {
    await collection.insertOne(document);
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return {
    reused: false,
    backup: await collection.findOne({ runId: job._id, trigger: BACKUP_TRIGGER }),
  };
}

export async function finishBackupRecord({ job, site, release, payload = {} }) {
  const outcome = text(payload.outcome, 80);
  if (!BACKUP_OUTCOMES.includes(outcome) || outcome === 'IN_PROGRESS') {
    const error = new Error(`Unsupported backup outcome "${outcome || '(empty)'}".`);
    error.statusCode = 400;
    error.code = 'INVALID_BACKUP_OUTCOME';
    throw error;
  }

  const copiedFiles = sanitizeFileEntries(payload.copiedFiles, 'copied');
  const skippedFiles = sanitizeFileEntries(payload.skippedFiles, 'skipped');
  const failedFiles = sanitizeFileEntries(payload.failedFiles, 'failed');
  const now = new Date();
  const base = snapshotDocument({ job, site, release, now });
  const update = {
    outcome,
    strategy: text(payload.strategy, 100) || base.strategy,
    backupPath: text(payload.backupPath, 700),
    backupUrl: text(payload.backupUrl, 1000),
    fileCount: Math.max(0, Number(payload.fileCount ?? base.fileCount)),
    copiedCount: copiedFiles.length,
    skippedCount: skippedFiles.length,
    failedCount: failedFiles.length,
    copiedFiles,
    skippedFiles,
    failedFiles,
    totalSizeBytes: Math.max(0, Number(payload.totalSizeBytes || 0)),
    verificationStatus: text(payload.verificationStatus, 80) || 'NOT_APPLICABLE',
    warningDetails: (Array.isArray(payload.warningDetails) ? payload.warningDetails : [])
      .slice(0, 20).map((item) => text(item, 1200)),
    errorDetails: failedFiles.map((item) => item.error).filter(Boolean),
    startedAt: validDate(payload.startedAt, now),
    finishedAt: validDate(payload.finishedAt, now),
    updatedAt: now,
  };

  const collection = getDb().collection('backups');
  const insertOnly = Object.fromEntries(
    Object.entries(base).filter(([key]) => !Object.prototype.hasOwnProperty.call(update, key)),
  );
  await collection.updateOne(
    { runId: job._id, trigger: BACKUP_TRIGGER },
    { $setOnInsert: insertOnly, $set: update },
    { upsert: true },
  );
  return collection.findOne({ runId: job._id, trigger: BACKUP_TRIGGER });
}

export function objectIdOrNull(value) {
  return ObjectId.isValid(String(value || '')) ? new ObjectId(String(value)) : null;
}
