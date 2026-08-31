/**
 * Runs API: structured telemetry is the primary troubleshooting surface, with
 * raw logs available underneath it.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { stageLabel, canonicalStage, STAGE_ORDER } from '../../../shared/deploymentStages.js';
import { summarizeStages, canonicalState, stateLabel, isTerminal, isResumable, JOB_STATE } from '../services/jobState.js';
import { cancelDeploymentJob, retryDeploymentJob, findActiveJobForTarget } from '../services/jobQueue.js';
import { TargetLockedError } from '../services/targetLock.js';

export const runsRouter = Router();

const publicJob = (job) => ({ ...job, id: String(job._id), _id: undefined });

/** Runs created before structured telemetry still render as a single stage. */
function eventsOf(job) {
  if (Array.isArray(job.runEvents) && job.runEvents.length) return job.runEvents;
  const at = job.startedAt || job.createdAt || new Date();
  const stage = canonicalStage(job.currentStage || job.state || 'RELEASE_VALIDATE');
  return [{
    eventId: `legacy-${job._id}`,
    stage,
    stageLabel: job.currentStageLabel || stageLabel(stage) || 'משימה היסטורית',
    status: canonicalState(job.state) === JOB_STATE.FAILED ? 'failed' : canonicalState(job.state) === JOB_STATE.SUCCEEDED ? 'success' : 'info',
    source: 'legacy',
    message: job.message || job.error || 'משימה שנוצרה לפני מנגנון הטלמטריה המפורט.',
    at,
  }];
}

function runSummary(job, site, release) {
  const events = eventsOf(job);
  const state = canonicalState(job.state);
  return {
    id: String(job._id),
    type: job.type,
    state,
    stateLabel: stateLabel(state),
    // The stored spelling is kept so existing filters and saved views keep working.
    storedState: job.state,
    progress: job.progress || 0,
    message: job.message || '',
    error: job.error || '',
    attempt: job.attempt || 1,
    currentStage: canonicalStage(job.currentStage) || events.at(-1)?.stage || '',
    currentStageLabel: job.currentStageLabel || stageLabel(job.currentStage) || '',
    failureStage: job.failureStage || job.failureInfo?.stage || '',
    failureInfo: job.failureInfo || null,
    targetKey: job.targetKey || '',
    canCancel: !isTerminal(state),
    canRetry: state === JOB_STATE.FAILED || isResumable(state),
    canResume: isResumable(state),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    durationMs: job.finishedAt && job.startedAt ? new Date(job.finishedAt) - new Date(job.startedAt) : null,
    site: site ? {
      id: String(site._id),
      name: site.name,
      unit: site.unit,
      host: site.host,
      siteCode: site.siteCode,
      siteDbFolder: site.siteDbFolder,
      usersDbFolder: site.usersDbFolder,
      finalUrl: job.finalUrl || site.finalUrl,
    } : null,
    release: release ? { id: String(release._id), version: release.version } : null,
    eventCount: events.length,
    stageSummary: summarizeStages(events, state),
  };
}

runsRouter.get('/stages', (_req, res) => {
  res.json(STAGE_ORDER.map((stage, index) => ({ stage, index: index + 1, label: stageLabel(stage) })));
});

runsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 60)));
    const db = getDb();
    const jobs = await db.collection('deployment_jobs').find({}).sort({ createdAt: -1 }).limit(limit).toArray();
    const siteIds = [...new Set(jobs.map((job) => String(job.siteId || '')).filter(Boolean))].map((id) => new ObjectId(id));
    const releaseIds = [...new Set(jobs.map((job) => String(job.releaseId || '')).filter(Boolean))].map((id) => new ObjectId(id));
    const [sites, releases] = await Promise.all([
      siteIds.length ? db.collection('sites').find({ _id: { $in: siteIds } }).toArray() : [],
      releaseIds.length ? db.collection('releases').find({ _id: { $in: releaseIds } }).toArray() : [],
    ]);
    const siteMap = new Map(sites.map((site) => [String(site._id), site]));
    const releaseMap = new Map(releases.map((release) => [String(release._id), release]));
    return res.json(jobs.map((job) => runSummary(job, siteMap.get(String(job.siteId)), releaseMap.get(String(job.releaseId)))));
  } catch (error) {
    return next(error);
  }
});

runsRouter.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const job = await db.collection('deployment_jobs').findOne({ _id: new ObjectId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'הריצה לא נמצאה.' });
    const [site, release] = await Promise.all([
      db.collection('sites').findOne({ _id: job.siteId }),
      db.collection('releases').findOne({ _id: job.releaseId }),
    ]);
    const events = eventsOf(job);
    return res.json({
      ...publicJob(job),
      ...runSummary(job, site, release),
      runEvents: events,
      logs: job.logs || [],
      site: site ? {
        ...site,
        finalUrl: job.finalUrl || site.finalUrl,
        id: String(site._id),
        _id: undefined,
        identityEdit: undefined,
      } : null,
      release: release ? { ...release, id: String(release._id), _id: undefined, releaseRoot: undefined, distDir: undefined } : null,
    });
  } catch (error) {
    return next(error);
  }
});

runsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const job = await cancelDeploymentJob(req.params.id, String(req.body?.reason || 'בוטל על ידי המשתמש.').slice(0, 500));
    if (!job) return res.status(404).json({ error: 'הריצה לא נמצאה.' });
    return res.json({ ok: true, state: canonicalState(job.state) });
  } catch (error) {
    return next(error);
  }
});

runsRouter.post('/:id/retry', async (req, res, next) => {
  try {
    const job = await retryDeploymentJob(req.params.id);
    return res.json({ ok: true, job: publicJob(job), state: canonicalState(job.state) });
  } catch (error) {
    if (error instanceof TargetLockedError) {
      return res.status(409).json({ error: error.message, code: error.code, activeJobId: error.activeJobId, stale: error.stale, canForce: true });
    }
    return next(error);
  }
});

/** Who currently owns a target, so the UI can offer open/supersede/cancel. */
runsRouter.get('/target/:targetKey/active', async (req, res, next) => {
  try {
    const active = await findActiveJobForTarget(String(req.params.targetKey));
    if (!active) return res.json({ active: false });
    return res.json({
      active: true,
      jobId: String(active.job._id),
      state: canonicalState(active.job.state),
      stale: active.stale,
      resumable: isResumable(active.job.state),
      lockedAt: active.lock.acquiredAt,
      heartbeatAt: active.lock.heartbeatAt,
    });
  } catch (error) {
    return next(error);
  }
});
