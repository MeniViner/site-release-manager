/**
 * Deployment job lifecycle.
 *
 * Deploying the SAME release again is always allowed. Only a run that is
 * actively holding the target blocks a new one, and such a run can always be
 * superseded explicitly. History never blocks a deployment.
 */

import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { prepareDeploymentJob, destroyStaging, stagingRootForJob } from './deploymentService.js';
import { appendRunEvent } from './runTelemetry.js';
import { STAGE } from '../../../shared/deploymentStages.js';
import { buildSiteIdentity, canonicalTargetKey } from '../../../shared/siteRuntime.js';
import {
  JOB_STATE, ACTIVE_STATE_QUERY, canonicalState, isTerminal, isResumable, ownsTarget, assertTransition,
} from './jobState.js';
import {
  acquireTargetLock, releaseTargetLock, readTargetLock, isStale, TargetLockedError, ensureLockIndexes,
} from './targetLock.js';

const JOBS = 'deployment_jobs';
const SITES = 'sites';

/** Roll a job into a terminal state and release everything it holds. */
export async function settleJob(jobId, state, { message = '', error = null, stage = null } = {}) {
  const db = getDb();
  const objectId = jobId instanceof ObjectId ? jobId : new ObjectId(jobId);
  const job = await db.collection(JOBS).findOne({ _id: objectId });
  if (!job) return null;
  if (isTerminal(job.state)) return job;

  const now = new Date();
  const target = canonicalState(state);
  await appendRunEvent(objectId, {
    stage: stage || job.currentStage || STAGE.RELEASE_VALIDATE,
    status: target === JOB_STATE.SUCCEEDED ? 'success' : target === JOB_STATE.FAILED ? 'failed' : 'warning',
    source: 'server',
    message: message || defaultSettleMessage(target),
    details: error ? { error: String(error).slice(0, 2000) } : null,
  });

  await db.collection(JOBS).updateOne(
    { _id: objectId },
    {
      $set: {
        state: target,
        progress: 100,
        message: message || defaultSettleMessage(target),
        error: error ? String(error).slice(0, 2000) : null,
        finishedAt: now,
        updatedAt: now,
        browserLease: null,
      },
      $push: { logs: { $each: [`[${now.toISOString()}] ${target}${error ? `: ${error}` : ''}`], $slice: -500 } },
    },
  );

  await releaseTargetLock(objectId);
  if (job.siteId) {
    const site = await db.collection(SITES).findOne({ _id: job.siteId });
    if (site && String(site.activeJobId || '') === String(objectId)) {
      await db.collection(SITES).updateOne(
        { _id: job.siteId },
        { $set: { activeJobId: null, status: nextSiteStatus(site, target), updatedAt: now } },
      );
    }
  }
  // Staging is disposable and is only kept while a run can still resume.
  if (target !== JOB_STATE.FAILED) {
    try { destroyStaging(job.stagingRoot || stagingRootForJob(objectId)); } catch { /* best effort */ }
  }
  return db.collection(JOBS).findOne({ _id: objectId });
}

function defaultSettleMessage(state) {
  return {
    SUCCEEDED: 'הפריסה הושלמה בהצלחה.',
    FAILED: 'הפריסה נכשלה.',
    CANCELLED: 'הריצה בוטלה.',
    SUPERSEDED: 'הריצה הוחלפה בריצה חדשה.',
  }[state] || state;
}

function nextSiteStatus(site, jobState) {
  if (jobState === JOB_STATE.SUCCEEDED) return 'ACTIVE';
  if (jobState === JOB_STATE.FAILED) return 'FAILED';
  return site.firstPublishedAt ? 'ACTIVE' : 'TRACKED';
}

/**
 * The run that currently owns a target, if any.
 * Returns null when the only runs for that target are finished — history must
 * never block a redeployment.
 */
export async function findActiveJobForTarget(targetKey) {
  const db = getDb();
  const lock = await readTargetLock(targetKey);
  if (!lock) return null;
  const job = await db.collection(JOBS).findOne({ _id: lock.jobId });
  if (!job || !ownsTarget(job.state)) {
    // The lock outlived its job. Clear it so the target is deployable again.
    await releaseTargetLock(lock.jobId);
    return null;
  }
  return { job, lock, stale: isStale(lock) };
}

/**
 * Create a deployment job.
 *
 * @param {object} options
 * @param {boolean} [options.force] supersede the run that currently holds the target
 */
export async function createDeploymentJob({ siteId, releaseId, type = 'UPDATE', force = false }) {
  const db = getDb();
  await ensureLockIndexes(db);

  const normalizedSiteId = new ObjectId(siteId);
  const normalizedReleaseId = new ObjectId(releaseId);
  const [site, release] = await Promise.all([
    db.collection(SITES).findOne({ _id: normalizedSiteId }),
    db.collection('releases').findOne({ _id: normalizedReleaseId }),
  ]);
  if (!site) throw Object.assign(new Error('האתר לא נמצא.'), { statusCode: 404 });
  if (!release) throw Object.assign(new Error('הריליס לא נמצא.'), { statusCode: 404 });
  if (release.artifactType !== 'universal-dist') {
    throw Object.assign(new Error('הריליס נוצר במודל הישן של קוד מקור. העלה Universal dist חדש.'), { statusCode: 400 });
  }

  const identity = buildSiteIdentity(site);
  const targetKey = canonicalTargetKey(identity);

  const active = await findActiveJobForTarget(targetKey);
  if (active && !force) {
    const error = new TargetLockedError(active.lock, active.stale);
    error.activeJobId = String(active.job._id);
    error.activeJobState = canonicalState(active.job.state);
    error.resumable = isResumable(active.job.state);
    throw error;
  }

  const now = new Date();
  const document = {
    siteId: normalizedSiteId,
    releaseId: normalizedReleaseId,
    targetKey,
    type,
    state: JOB_STATE.QUEUED,
    progress: 5,
    message: 'הריצה נוצרה וממתינה להכנה.',
    currentStage: STAGE.RELEASE_VALIDATE,
    currentStageLabel: 'אימות הריליס',
    runEvents: [],
    logs: [],
    error: null,
    failureInfo: null,
    browserLease: null,
    verifiedAssets: [],
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
  };
  const inserted = await db.collection(JOBS).insertOne(document);
  const jobId = inserted.insertedId;

  // The lock is taken before any preparation work so two concurrent requests
  // cannot both start preparing the same target.
  let supersededJobId = null;
  try {
    const lock = await acquireTargetLock({ targetKey, jobId, siteId: normalizedSiteId, takeOver: force, now });
    supersededJobId = lock.supersededJobId;
  } catch (error) {
    await db.collection(JOBS).deleteOne({ _id: jobId });
    throw error;
  }

  if (supersededJobId) {
    await db.collection(JOBS).updateOne(
      { _id: new ObjectId(supersededJobId) },
      {
        $set: {
          state: JOB_STATE.SUPERSEDED,
          progress: 100,
          message: 'הריצה הוחלפה בריצה חדשה לפי בקשת המשתמש.',
          finishedAt: now,
          updatedAt: now,
          browserLease: null,
        },
        $push: { logs: `[${now.toISOString()}] Superseded by job ${jobId}.` },
      },
    );
    await appendRunEvent(new ObjectId(supersededJobId), {
      stage: STAGE.READY_FOR_SHAREPOINT,
      status: 'warning',
      source: 'server',
      message: 'הריצה הוחלפה בריצה חדשה לפי בקשת המשתמש.',
      details: { supersededBy: String(jobId) },
    });
  }

  await appendRunEvent(jobId, {
    stage: STAGE.RELEASE_VALIDATE,
    status: 'started',
    source: 'server',
    message: `נוצרה ריצת ${type === 'INSTALL' ? 'התקנה' : 'עדכון'} חדשה.`,
    details: { targetKey, releaseVersion: release.version, supersededJobId: supersededJobId || '' },
  });
  await db.collection(SITES).updateOne(
    { _id: normalizedSiteId },
    { $set: { status: JOB_STATE.PREPARING_RELEASE, activeJobId: jobId, updatedAt: now } },
  );
  await db.collection(JOBS).updateOne({ _id: jobId }, { $set: { state: JOB_STATE.PREPARING_RELEASE, updatedAt: new Date() } });

  try {
    await prepareDeploymentJob(String(jobId));
  } catch (error) {
    await settleJob(jobId, JOB_STATE.FAILED, { message: error.message, error: error.message });
    throw error;
  }
  return db.collection(JOBS).findOne({ _id: jobId });
}

/** Cancel a run at the user's request. Verified SharePoint state is left alone. */
export async function cancelDeploymentJob(jobId, reason = 'בוטל על ידי המשתמש.') {
  return settleJob(jobId, JOB_STATE.CANCELLED, { message: reason });
}

/**
 * Retry a FAILED run in place.
 *
 * The job keeps its staging and its verified-stage history, so the browser
 * resumes at the first incomplete stage instead of redoing verified work.
 */
export async function retryDeploymentJob(jobId) {
  const db = getDb();
  const objectId = new ObjectId(jobId);
  const job = await db.collection(JOBS).findOne({ _id: objectId });
  if (!job) throw Object.assign(new Error('הריצה לא נמצאה.'), { statusCode: 404 });
  if (canonicalState(job.state) !== JOB_STATE.FAILED && !isResumable(job.state)) {
    throw Object.assign(new Error('רק ריצה שנכשלה או ריצה פעילה ניתנת להרצה מחדש.'), { statusCode: 409 });
  }

  const site = await db.collection(SITES).findOne({ _id: job.siteId });
  if (!site) throw Object.assign(new Error('האתר לא נמצא.'), { statusCode: 404 });
  const targetKey = job.targetKey || canonicalTargetKey(buildSiteIdentity(site));

  const active = await findActiveJobForTarget(targetKey);
  if (active && String(active.job._id) !== String(objectId)) {
    throw new TargetLockedError(active.lock, active.stale);
  }
  await acquireTargetLock({ targetKey, jobId: objectId, siteId: job.siteId, takeOver: true });

  // Staging is disposable; rebuild it so a retry always deploys freshly
  // generated, freshly verified bytes.
  await prepareDeploymentJob(String(objectId));
  const now = new Date();
  await db.collection(JOBS).updateOne(
    { _id: objectId },
    {
      $set: { error: null, finishedAt: null, browserLease: null, updatedAt: now, message: 'הריצה הופעלה מחדש.' },
      $inc: { attempt: 1 },
      $unset: { failureInfo: '', failureStage: '' },
    },
  );
  await appendRunEvent(objectId, {
    stage: STAGE.READY_FOR_SHAREPOINT,
    status: 'info',
    source: 'server',
    message: 'הריצה הופעלה מחדש; תמשיך מהשלב הראשון שלא הושלם.',
    details: { attempt: Number(job.attempt || 1) + 1 },
  });
  return db.collection(JOBS).findOne({ _id: objectId });
}

/**
 * Startup reconciliation.
 *
 * A restart while SharePoint work was in progress must NOT be reported as a
 * failed deployment: the target may be fully deployed and merely unverified.
 * Such a job is parked as PAUSED so it can be resumed and re-verified.
 */
export async function initializeQueue() {
  const db = getDb();
  await ensureLockIndexes(db);
  const now = new Date();

  // Server-owned preparation cannot survive a restart: it is cheap to redo.
  const preparing = await db.collection(JOBS).find({ state: { $in: [JOB_STATE.QUEUED, JOB_STATE.PREPARING_RELEASE] } }).toArray();
  for (const job of preparing) {
    await appendRunEvent(job._id, {
      stage: job.currentStage || STAGE.RELEASE_VALIDATE,
      status: 'warning',
      source: 'server',
      message: 'השרת אותחל בזמן הכנת הריליס; ההכנה תבוצע מחדש בהרצה הבאה.',
    });
    await settleJob(job._id, JOB_STATE.SUPERSEDED, { message: 'השרת אותחל בזמן הכנת הריליס.' });
  }

  // Browser-owned work is preserved, not failed.
  const inFlight = await db.collection(JOBS).find({
    state: { $in: [JOB_STATE.READY_FOR_SHAREPOINT, JOB_STATE.WAITING_FOR_BROWSER, JOB_STATE.DEPLOYING] },
  }).toArray();
  for (const job of inFlight) {
    await db.collection(JOBS).updateOne(
      { _id: job._id },
      {
        $set: {
          state: JOB_STATE.PAUSED,
          browserLease: null,
          message: 'השרת אותחל בזמן פריסת SharePoint. הריצה תמשיך מהשלב הראשון שלא הושלם.',
          updatedAt: now,
        },
        $push: { logs: `[${now.toISOString()}] Server restarted during SharePoint work; job paused for resume.` },
      },
    );
    await appendRunEvent(job._id, {
      stage: job.currentStage || STAGE.BROWSER_ACTIVATE,
      status: 'warning',
      source: 'server',
      message: 'השרת אותחל בזמן פריסת SharePoint. המצב ביעד נשמר והריצה תמשיך מהשלב הראשון שלא הושלם.',
    });
    // The lock is retained so nothing else claims the target while it is paused.
    if (job.targetKey) {
      await acquireTargetLock({ targetKey: job.targetKey, jobId: job._id, siteId: job.siteId, takeOver: true, now }).catch(() => {});
    }
  }

  // Locks whose job is already finished are released.
  const locks = await db.collection('deployment_locks').find({}).toArray();
  for (const lock of locks) {
    const job = await db.collection(JOBS).findOne({ _id: lock.jobId });
    if (!job || !ownsTarget(job.state)) await releaseTargetLock(lock.jobId);
  }
}

export { assertTransition, ACTIVE_STATE_QUERY };
