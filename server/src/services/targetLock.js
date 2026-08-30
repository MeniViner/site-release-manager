/**
 * Target locking.
 *
 * Exactly one active writer per LOGICAL target. The lock key is the canonical
 * target identity (host + siteCode + siteDbFolder + usersDbFolder), not the
 * Site record _id, so two Site records that happen to point at the same
 * physical SharePoint target cannot deploy concurrently.
 */

import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { buildSiteIdentity, canonicalTargetKey } from '../../../shared/siteRuntime.js';

const COLLECTION = 'deployment_locks';

/**
 * A lock older than this with no heartbeat is considered stale. It is never
 * silently stolen: it is reported so the caller can supersede it explicitly.
 */
export const STALE_LOCK_MS = 15 * 60 * 1000;

export async function ensureLockIndexes(db = getDb()) {
  await db.collection(COLLECTION).createIndex({ targetKey: 1 }, { unique: true });
}

export function targetKeyForSite(site) {
  return canonicalTargetKey(buildSiteIdentity(site));
}

export class TargetLockedError extends Error {
  constructor(lock, stale) {
    super(stale
      ? 'קיימת ריצה תקועה על היעד הזה. אפשר להחליף אותה בריצה חדשה.'
      : 'כבר קיימת ריצת פריסה פעילה ליעד הזה.');
    this.name = 'TargetLockedError';
    this.statusCode = 409;
    this.code = stale ? 'STALE_TARGET_LOCK' : 'TARGET_LOCKED';
    this.activeJobId = String(lock.jobId);
    this.targetKey = lock.targetKey;
    this.stale = Boolean(stale);
    this.lockedAt = lock.acquiredAt;
    this.heartbeatAt = lock.heartbeatAt;
  }
}

/**
 * Acquire the lock for a target.
 *
 * @param {object} options
 * @param {string} options.targetKey
 * @param {ObjectId} options.jobId
 * @param {ObjectId} options.siteId
 * @param {boolean} [options.takeOver] supersede an existing lock on user request
 * @returns {Promise<{acquired:boolean, supersededJobId:string|null}>}
 */
export async function acquireTargetLock({ targetKey, jobId, siteId, takeOver = false, now = new Date() }) {
  const db = getDb();
  const collection = db.collection(COLLECTION);
  const document = {
    targetKey,
    jobId: new ObjectId(jobId),
    siteId: siteId ? new ObjectId(siteId) : null,
    acquiredAt: now,
    heartbeatAt: now,
  };

  try {
    await collection.insertOne(document);
    return { acquired: true, supersededJobId: null };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const existing = await collection.findOne({ targetKey });
  if (!existing) {
    // The holder released between the failed insert and this read.
    await collection.insertOne(document);
    return { acquired: true, supersededJobId: null };
  }

  if (String(existing.jobId) === String(jobId)) {
    await collection.updateOne({ targetKey }, { $set: { heartbeatAt: now } });
    return { acquired: true, supersededJobId: null };
  }

  const stale = isStale(existing, now);
  if (!takeOver) throw new TargetLockedError(existing, stale);

  // Explicit user-driven takeover. Guarded on the previous holder so two
  // concurrent takeovers cannot both believe they won.
  const replaced = await collection.findOneAndUpdate(
    { targetKey, jobId: existing.jobId },
    { $set: { jobId: new ObjectId(jobId), siteId: document.siteId, acquiredAt: now, heartbeatAt: now } },
    { returnDocument: 'after' },
  );
  if (!replaced) throw new TargetLockedError(existing, stale);
  return { acquired: true, supersededJobId: String(existing.jobId) };
}

export function isStale(lock, now = new Date()) {
  const last = new Date(lock.heartbeatAt || lock.acquiredAt || 0).getTime();
  return Number.isFinite(last) && (now.getTime() - last) > STALE_LOCK_MS;
}

/** Keep a long-running browser deployment from looking abandoned. */
export async function heartbeatTargetLock(jobId, now = new Date()) {
  await getDb().collection(COLLECTION).updateOne(
    { jobId: new ObjectId(jobId) },
    { $set: { heartbeatAt: now } },
  );
}

/** Release on success, failure, cancellation or supersede. */
export async function releaseTargetLock(jobId) {
  const result = await getDb().collection(COLLECTION).deleteOne({ jobId: new ObjectId(jobId) });
  return result.deletedCount > 0;
}

export async function readTargetLock(targetKey) {
  return getDb().collection(COLLECTION).findOne({ targetKey });
}

export async function readLockForJob(jobId) {
  return getDb().collection(COLLECTION).findOne({ jobId: new ObjectId(jobId) });
}
