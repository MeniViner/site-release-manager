/**
 * Deployment API consumed by the in-browser SharePoint worker.
 *
 * Node prepares, serves staged bytes and records durable telemetry. It performs
 * no authenticated SharePoint work. A browser LEASE guarantees that exactly one
 * worker mutates one target at a time, even with several Release Manager tabs
 * open on the same SharePoint host.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { isSafeRelativePath, normalizeRelativePath } from '../utils/files.js';
import { buildDeploymentDescriptor, resolveDeploymentFile } from '../services/deploymentService.js';
import { runLocalDeploymentVerification } from '../services/localVerificationService.js';
import { appendRunEvent } from '../services/runTelemetry.js';
import { settleJob } from '../services/jobQueue.js';
import { heartbeatTargetLock } from '../services/targetLock.js';
import { STAGE } from '../../../shared/deploymentStages.js';
import { JOB_STATE, canonicalState, isTerminal, resumeStage, completedStages, assertTransition } from '../services/jobState.js';
import { finishBackupRecord, publicBackup, startBackupRecord } from '../services/backupService.js';

export const deploymentsRouter = Router();

/** A lease is renewed on every reported event; this is how long silence is tolerated. */
const LEASE_TTL_MS = 90 * 1000;

async function loadContext(jobId) {
  const db = getDb();
  let objectId;
  try { objectId = new ObjectId(jobId); } catch { return null; }
  const job = await db.collection('deployment_jobs').findOne({ _id: objectId });
  if (!job) return null;
  const [site, release] = await Promise.all([
    db.collection('sites').findOne({ _id: job.siteId }),
    db.collection('releases').findOne({ _id: job.releaseId }),
  ]);
  return { db, job, site, release };
}

const leaseIsLive = (lease, now = Date.now()) =>
  Boolean(lease?.leaseId) && (now - new Date(lease.heartbeatAt || lease.acquiredAt || 0).getTime()) < LEASE_TTL_MS;

/**
 * Confirm the caller still owns the write lease. Any other worker reporting
 * against this job is rejected rather than allowed to race the active owner.
 */
function assertLease(job, req) {
  const presented = String(req.get('x-srm-lease') || req.body?.leaseId || '');
  if (!job.browserLease?.leaseId) {
    const error = new Error('הריצה אינה מוחזקת על ידי אף worker. יש לתפוס lease לפני דיווח.');
    error.statusCode = 409;
    error.code = 'NO_LEASE';
    throw error;
  }
  if (presented !== job.browserLease.leaseId) {
    const error = new Error('worker אחר מחזיק את הריצה הזו. רק בעלים אחד רשאי לכתוב ל-SharePoint.');
    error.statusCode = 409;
    error.code = 'LEASE_LOST';
    throw error;
  }
}

function assertWritable(job) {
  if (isTerminal(job.state)) {
    const error = new Error('הריצה כבר הסתיימה ואינה יכולה להתעדכן.');
    error.statusCode = 409;
    error.code = 'JOB_SETTLED';
    throw error;
  }
}

/** Full deployment instruction set for the browser worker. */
deploymentsRouter.get('/:jobId', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    const { job, site, release } = context;
    if (!job.manifestPath || !fs.existsSync(job.manifestPath)) {
      return res.status(409).json({ error: 'הריליס עדיין אינו מוכן לפריסה.', code: 'NOT_PREPARED' });
    }
    const artifact = JSON.parse(fs.readFileSync(job.manifestPath, 'utf8'));
    const descriptor = buildDeploymentDescriptor({
      job, site, release,
      // The deployable list, which includes sharepoint-deploy-manifest.json.
      manifest: { ...artifact.manifest, files: artifact.files || artifact.manifest.files },
      uploadOrder: artifact.uploadOrder,
    });
    const events = job.runEvents || [];
    return res.json({
      ...descriptor,
      resume: {
        resumeFrom: resumeStage(events),
        completedStages: [...completedStages(events).done],
        verifiedAssets: job.verifiedAssets || [],
        attempt: job.attempt || 1,
      },
      lease: { held: leaseIsLive(job.browserLease), ttlMs: LEASE_TTL_MS },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Claim the exclusive write lease.
 *
 * This is the single-provisioning-owner guarantee: a second tab polling the
 * same READY job is refused here and reports status only.
 */
deploymentsRouter.post('/:jobId/claim', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    const { db, job } = context;
    if (isTerminal(job.state)) {
      return res.status(409).json({ error: 'הריצה כבר הסתיימה.', code: 'JOB_SETTLED', state: canonicalState(job.state) });
    }

    const now = new Date();
    const clientId = String(req.body?.clientId || '').slice(0, 120) || 'unknown-worker';
    if (leaseIsLive(job.browserLease, now.getTime()) && job.browserLease.clientId !== clientId) {
      return res.status(409).json({
        error: 'worker אחר כבר מבצע את הריצה הזו.',
        code: 'LEASE_HELD',
        holder: job.browserLease.clientId,
        expiresInMs: Math.max(0, LEASE_TTL_MS - (now.getTime() - new Date(job.browserLease.heartbeatAt).getTime())),
      });
    }

    // A claim moves the run into browser ownership; reject a transition the
    // state machine does not allow instead of forcing it with a raw $set.
    try {
      assertTransition(job.state, JOB_STATE.WAITING_FOR_BROWSER);
    } catch (error) {
      return res.status(409).json({ error: error.message, code: error.code, state: canonicalState(job.state) });
    }

    const lease = { leaseId: crypto.randomUUID(), clientId, acquiredAt: now, heartbeatAt: now };
    // Guarded update: whoever wins this atomic swap is the sole owner.
    const claimed = await db.collection('deployment_jobs').findOneAndUpdate(
      {
        _id: job._id,
        $or: [
          { browserLease: null },
          { 'browserLease.leaseId': job.browserLease?.leaseId ?? null },
        ],
      },
      { $set: { browserLease: lease, state: JOB_STATE.WAITING_FOR_BROWSER, updatedAt: now } },
      { returnDocument: 'after' },
    );
    if (!claimed) return res.status(409).json({ error: 'הריצה נתפסה על ידי worker אחר.', code: 'LEASE_RACE' });

    await heartbeatTargetLock(job._id, now).catch(() => {});
    await appendRunEvent(job._id, {
      stage: STAGE.BROWSER_ACTIVATE,
      status: 'started',
      source: 'release-manager-browser-worker',
      message: 'מנוע הפריסה בדפדפן תפס בעלות בלעדית על הריצה.',
      details: { clientId, attempt: job.attempt || 1 },
    });

    const events = claimed.runEvents || [];
    return res.json({
      granted: true,
      leaseId: lease.leaseId,
      ttlMs: LEASE_TTL_MS,
      resumeFrom: resumeStage(events),
      completedStages: [...completedStages(events).done],
      verifiedAssets: claimed.verifiedAssets || [],
    });
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.post('/:jobId/heartbeat', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    assertWritable(context.job);
    assertLease(context.job, req);
    const now = new Date();
    await context.db.collection('deployment_jobs').updateOne(
      { _id: context.job._id },
      { $set: { 'browserLease.heartbeatAt': now, updatedAt: now } },
    );
    await heartbeatTargetLock(context.job._id, now).catch(() => {});
    return res.json({ ok: true, ttlMs: LEASE_TTL_MS });
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.post('/:jobId/release-lease', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    if (context.job.browserLease?.leaseId === String(req.get('x-srm-lease') || req.body?.leaseId || '')) {
      await context.db.collection('deployment_jobs').updateOne(
        { _id: context.job._id },
        { $set: { browserLease: null, updatedAt: new Date() } },
      );
    }
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/** Serve one staged file. Always from this job's staging, never from the release. */
deploymentsRouter.get('/:jobId/file', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    const relativePath = normalizeRelativePath(req.query.path || '');
    if (!isSafeRelativePath(relativePath)) return res.status(400).json({ error: 'נתיב הקובץ אינו תקין.' });
    let filePath;
    try {
      filePath = resolveDeploymentFile(context.job, context.release, relativePath);
    } catch {
      return res.status(400).json({ error: 'נתיב הקובץ אינו תקין.' });
    }
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'הקובץ לא נמצא ב-Staging של הריצה.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(filePath);
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.post('/:jobId/verify-local', async (req, res, next) => {
  try {
    await appendRunEvent(req.params.jobId, { stage: 'LOCAL_AUDIT', stageLabel: 'Audit מקומי', status: 'started', source: 'local-audit', message: 'התחיל Audit מקומי עמוק.' });
    const report = await runLocalDeploymentVerification(req.params.jobId);
    await appendRunEvent(req.params.jobId, {
      stage: 'LOCAL_AUDIT', stageLabel: 'Audit מקומי', status: report.ok ? 'success' : 'failed', source: 'local-audit',
      message: report.ok ? 'ה-Audit המקומי עבר.' : 'ה-Audit המקומי מצא כשלים.',
      details: { summary: report.summary || null, reportPath: report.reportPath || '' },
    });
    return res.json(report);
  } catch (error) {
    await appendRunEvent(req.params.jobId, { stage: 'LOCAL_AUDIT', stageLabel: 'Audit מקומי', status: 'failed', source: 'local-audit', message: error.message }).catch(() => {});
    return next(error);
  }
});

/** Structured stage telemetry from the browser worker. */
deploymentsRouter.post('/:jobId/event', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    assertWritable(context.job);
    assertLease(context.job, req);

    const now = new Date();
    await context.db.collection('deployment_jobs').updateOne(
      { _id: context.job._id },
      { $set: { 'browserLease.heartbeatAt': now } },
    );
    const event = await appendRunEvent(context.job._id, {
      ...req.body,
      source: req.body?.source || 'release-manager-browser-worker',
    });
    return res.json({ ok: true, event });
  } catch (error) {
    return next(error);
  }
});

/** Record an asset verified at the target so a resume can skip re-uploading it. */
deploymentsRouter.post('/:jobId/verified-asset', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    assertWritable(context.job);
    assertLease(context.job, req);
    const paths = (Array.isArray(req.body?.paths) ? req.body.paths : [req.body?.path])
      .map((value) => String(value || '').slice(0, 500))
      .filter(Boolean);
    if (!paths.length) return res.status(400).json({ error: 'לא התקבל נתיב קובץ.' });
    await context.db.collection('deployment_jobs').updateOne(
      { _id: context.job._id },
      { $addToSet: { verifiedAssets: { $each: paths } }, $set: { updatedAt: new Date() } },
    );
    return res.json({ ok: true, recorded: paths.length });
  } catch (error) {
    return next(error);
  }
});

/** Start/reuse the one durable pre-deploy backup record for this run. */
deploymentsRouter.post('/:jobId/backup/start', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    assertWritable(context.job);
    assertLease(context.job, req);
    const result = await startBackupRecord({
      job: context.job,
      site: context.site,
      release: context.release,
      startedAt: req.body?.startedAt,
    });
    return res.json({ reused: result.reused, backup: publicBackup(result.backup, context.site) });
  } catch (error) {
    return next(error);
  }
});

/** Finish a backup attempt. FAILED/PARTIAL are valid, non-fatal outcomes. */
deploymentsRouter.post('/:jobId/backup/finish', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    assertWritable(context.job);
    assertLease(context.job, req);
    const backup = await finishBackupRecord({
      job: context.job,
      site: context.site,
      release: context.release,
      payload: req.body,
    });
    return res.json({ ok: true, backup: publicBackup(backup, context.site) });
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.post('/:jobId/progress', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    assertWritable(context.job);
    assertLease(context.job, req);

    const progress = Math.max(0, Math.min(99, Number(req.body?.progress || 0)));
    const message = String(req.body?.message || '').slice(0, 500);
    const currentFile = String(req.body?.currentFile || '').slice(0, 500);
    const stage = String(req.body?.stage || '').slice(0, 80);
    const now = new Date();
    const set = { state: JOB_STATE.DEPLOYING, progress, message, currentFile, updatedAt: now, 'browserLease.heartbeatAt': now };
    if (stage) set.currentStage = stage;

    await context.db.collection('deployment_jobs').updateOne(
      { _id: context.job._id },
      { $set: set, $push: { logs: { $each: [`[${now.toISOString()}] ${message}${currentFile ? ` | ${currentFile}` : ''}`], $slice: -500 } } },
    );
    await context.db.collection('sites').updateOne({ _id: context.job.siteId }, { $set: { status: JOB_STATE.DEPLOYING, updatedAt: now } });
    await heartbeatTargetLock(context.job._id, now).catch(() => {});
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.post('/:jobId/complete', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    const { db, job, site, release } = context;
    if (canonicalState(job.state) === JOB_STATE.SUCCEEDED) {
      // Idempotent: a duplicate completion report is not an error.
      return res.json({ ok: true, finalUrl: site?.finalUrl || '', alreadyComplete: true });
    }
    assertWritable(job);
    assertLease(job, req);

    const now = new Date();
    await appendRunEvent(job._id, {
      stage: STAGE.COMPLETE,
      status: 'success',
      source: 'release-manager-browser-worker',
      message: 'מנוע הפריסה דיווח שהפריסה הושלמה ואומתה במלואה.',
      details: req.body || {},
    });
    // Record the run's own result, but leave the STATE transition to settleJob.
    // Writing SUCCEEDED here first would make settleJob's isTerminal guard fire,
    // and the target lock and the staging directory would never be released.
    await db.collection('deployment_jobs').updateOne(
      { _id: job._id },
      {
        $set: { deploymentSummary: req.body || {}, browserLease: null, updatedAt: now },
        $push: { logs: `[${now.toISOString()}] SharePoint deployment completed and verified.` },
      },
    );
    await db.collection('sites').updateOne(
      { _id: site._id },
      {
        $set: {
          status: 'ACTIVE',
          currentVersion: release.version,
          currentReleaseId: release._id,
          lastPublishedAt: now,
          activeJobId: null,
          updatedAt: now,
          ...(site.firstPublishedAt ? {} : { firstPublishedAt: now }),
        },
      },
    );
    // settleJob performs the terminal transition and releases the target lock
    // and the staging directory.
    await settleJob(job._id, JOB_STATE.SUCCEEDED, { message: 'הפריסה הושלמה בהצלחה.', stage: STAGE.COMPLETE });
    return res.json({ ok: true, finalUrl: site.finalUrl });
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.post('/:jobId/fail', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    const { job } = context;
    if (isTerminal(job.state)) return res.json({ ok: true, alreadySettled: true });
    // A worker that lost its lease must still be able to report WHY it stopped.
    // Refusing that would strand the job in an active state holding the target.
    if (leaseIsLive(job.browserLease)) assertLease(job, req);

    const message = String(req.body?.error || 'SharePoint deployment failed.').slice(0, 2000);
    const alreadyCaptured = req.body?.eventAlreadyReported === true;
    if (!alreadyCaptured) {
      await appendRunEvent(job._id, {
        stage: req.body?.stage || job.currentStage || STAGE.BROWSER_ACTIVATE,
        stageLabel: req.body?.stageLabel,
        status: 'failed',
        source: 'release-manager-browser-worker',
        message,
        currentFile: req.body?.currentFile || '',
        operation: req.body?.operation || '',
        target: req.body?.target || '',
        method: req.body?.method || '',
        url: req.body?.url || '',
        httpStatus: req.body?.httpStatus,
        attempt: req.body?.attempt,
        errorClass: req.body?.errorClass || '',
        sharePointCode: req.body?.sharePointCode || '',
        sharePointExceptionType: req.body?.sharePointExceptionType || '',
        nextAction: req.body?.nextAction || '',
        details: req.body?.details || null,
      });
    }
    await settleJob(job._id, JOB_STATE.FAILED, { message: 'הפריסה נכשלה.', error: message, stage: req.body?.stage });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});
