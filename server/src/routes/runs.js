import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { STAGE_LABELS, summarizeEvents } from '../services/runTelemetry.js';

export const runsRouter = Router();

const publicJob = (job) => ({ ...job, id: String(job._id), _id: undefined });

function legacyEvents(job) {
  if (Array.isArray(job.runEvents) && job.runEvents.length) return job.runEvents;
  const at = job.startedAt || job.createdAt || new Date();
  return [{
    eventId: `legacy-${job._id}`,
    stage: job.currentStage || job.state || 'LEGACY',
    stageLabel: job.currentStageLabel || STAGE_LABELS[job.currentStage] || 'משימה היסטורית',
    status: job.state === 'FAILED' ? 'failed' : job.state === 'SUCCEEDED' ? 'success' : 'info',
    source: 'legacy',
    message: job.message || job.error || 'משימה שנוצרה לפני מנגנון הטלמטריה המפורט.',
    at,
  }];
}

runsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 60)));
    const db = getDb();
    const jobs = await db.collection('deployment_jobs').find({}).sort({ createdAt: -1 }).limit(limit).toArray();
    const siteIds = [...new Set(jobs.map((j) => String(j.siteId || '')).filter(Boolean))].map((id) => new ObjectId(id));
    const releaseIds = [...new Set(jobs.map((j) => String(j.releaseId || '')).filter(Boolean))].map((id) => new ObjectId(id));
    const [sites, releases] = await Promise.all([
      siteIds.length ? db.collection('sites').find({ _id: { $in: siteIds } }).toArray() : [],
      releaseIds.length ? db.collection('releases').find({ _id: { $in: releaseIds } }).toArray() : [],
    ]);
    const siteMap = new Map(sites.map((site) => [String(site._id), site]));
    const releaseMap = new Map(releases.map((release) => [String(release._id), release]));
    return res.json(jobs.map((job) => {
      const site = siteMap.get(String(job.siteId));
      const release = releaseMap.get(String(job.releaseId));
      const events = legacyEvents(job);
      return {
        id: String(job._id),
        type: job.type,
        state: job.state,
        progress: job.progress || 0,
        message: job.message || '',
        error: job.error || '',
        currentStage: job.currentStage || events.at(-1)?.stage || '',
        currentStageLabel: job.currentStageLabel || events.at(-1)?.stageLabel || '',
        failureStage: job.failureStage || job.failureInfo?.stage || '',
        failureInfo: job.failureInfo || null,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        updatedAt: job.updatedAt,
        site: site ? { id: String(site._id), name: site.name, unit: site.unit, host: site.host, siteCode: site.siteCode, finalUrl: site.finalUrl } : null,
        release: release ? { id: String(release._id), version: release.version } : null,
        eventCount: events.length,
        stageSummary: summarizeEvents(events),
      };
    }));
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
    const events = legacyEvents(job);
    return res.json({
      ...publicJob(job),
      runEvents: events,
      stageSummary: summarizeEvents(events),
      site: site ? { ...site, id: String(site._id), _id: undefined } : null,
      release: release ? { ...release, id: String(release._id), _id: undefined } : null,
    });
  } catch (error) {
    return next(error);
  }
});
