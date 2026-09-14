const { Router } = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db.js");
const { createDeploymentJob } = require("../services/jobQueue.js");
const { normalizeBackend, releaseSupportsBackend } = require("../utils/backendMode.js");

const deploymentBatchesRouter = Router();
const terminalStates = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'SUPERSEDED']);

function publicBatch(batch, jobs = []) {
  const counts = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const job of jobs) {
    const state = String(job.state || '').toUpperCase();
    if (state === 'SUCCEEDED') counts.succeeded += 1;
    else if (state === 'FAILED') counts.failed += 1;
    else if (state === 'CANCELLED' || state === 'SUPERSEDED') counts.cancelled += 1;
    else if (state === 'QUEUED') counts.queued += 1;
    else counts.running += 1;
  }
  const finished = jobs.length === batch.total && jobs.every((job) => terminalStates.has(String(job.state || '').toUpperCase()));
  const state = finished
    ? (counts.succeeded === batch.total ? 'SUCCEEDED' : counts.succeeded ? 'PARTIAL' : counts.cancelled === batch.total ? 'CANCELLED' : 'FAILED')
    : jobs.length ? 'RUNNING' : batch.state;
  return {
    ...batch,
    id: String(batch._id),
    _id: undefined,
    siteIds: batch.siteIds.map(String),
    childJobIds: batch.childJobIds.map(String),
    state,
    ...counts,
    jobs: jobs.map((job) => ({
      id: String(job._id),
      siteId: String(job.siteId),
      state: job.state,
      progress: job.progress || 0,
      currentStage: job.currentStage || '',
      message: job.message || '',
      error: job.error || '',
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    })),
  };
}

deploymentBatchesRouter.post('/', async (req, res, next) => {
  try {
    const backend = normalizeBackend(req.body?.backend);
    const releaseId = String(req.body?.releaseId || '');
    const rawSiteIds = Array.isArray(req.body?.siteIds) ? req.body.siteIds.map(String) : [];
    if (!ObjectId.isValid(releaseId) || !rawSiteIds.length) {
      return res.status(400).json({ error: 'releaseId and at least one siteId are required.', code: 'INVALID_BATCH' });
    }
    if (new Set(rawSiteIds).size !== rawSiteIds.length || rawSiteIds.some((id) => !ObjectId.isValid(id))) {
      return res.status(400).json({ error: 'Site IDs must be valid and unique.', code: 'INVALID_BATCH_TARGETS' });
    }

    const db = getDb();
    const siteIds = rawSiteIds.map((id) => new ObjectId(id));
    const [release, sites] = await Promise.all([
      db.collection('releases').findOne({ _id: new ObjectId(releaseId) }),
      db.collection('sites').find({ _id: { $in: siteIds } }).toArray(),
    ]);
    if (!release) return res.status(404).json({ error: 'הריליס לא נמצא.' });
    const siteMap = new Map(sites.map((site) => [String(site._id), site]));
    const preflight = rawSiteIds.map((id) => {
      const site = siteMap.get(id);
      const siteBackend = site ? normalizeBackend(site.storageBackend) : null;
      const reason = !site ? 'SITE_NOT_FOUND'
        : siteBackend !== backend ? 'BACKEND_MISMATCH'
          : !releaseSupportsBackend(release, backend) ? 'RELEASE_BACKEND_INCOMPATIBLE'
            : '';
      return { siteId: id, backend: siteBackend, ready: !reason, reason };
    });
    if (preflight.some((item) => !item.ready)) {
      return res.status(409).json({ error: 'One or more Sites failed batch preflight.', code: 'BATCH_PREFLIGHT_FAILED', preflight });
    }

    const now = new Date();
    const batch = {
      backend,
      releaseId: release._id,
      siteIds,
      childJobIds: [],
      preflight,
      state: 'CREATED',
      total: siteIds.length,
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      createdBy: String(req.body?.createdBy || 'local-operator').slice(0, 120),
      options: { concurrency: 1, continueOnError: true },
    };
    const inserted = await db.collection('deployment_batches').insertOne(batch);
    const failures = [];
    for (const siteId of siteIds) {
      try {
        const job = await createDeploymentJob({ siteId, releaseId: release._id, type: 'UPDATE' });
        batch.childJobIds.push(job._id);
      } catch (error) {
        failures.push({ siteId: String(siteId), reason: error.code || 'JOB_CREATION_FAILED', error: error.message });
      }
      await db.collection('deployment_batches').updateOne(
        { _id: inserted.insertedId },
        { $set: { childJobIds: batch.childJobIds, state: 'RUNNING', failures, updatedAt: new Date() } },
      );
    }
    const stored = await db.collection('deployment_batches').findOne({ _id: inserted.insertedId });
    const jobs = batch.childJobIds.length
      ? await db.collection('deployment_jobs').find({ _id: { $in: batch.childJobIds } }).toArray()
      : [];
    return res.status(201).json(publicBatch(stored, jobs));
  } catch (error) {
    return next(error);
  }
});

deploymentBatchesRouter.get('/:id', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'האצווה לא נמצאה.' });
    const db = getDb();
    const batch = await db.collection('deployment_batches').findOne({ _id: new ObjectId(req.params.id) });
    if (!batch) return res.status(404).json({ error: 'האצווה לא נמצאה.' });
    const jobs = batch.childJobIds.length
      ? await db.collection('deployment_jobs').find({ _id: { $in: batch.childJobIds } }).toArray()
      : [];
    return res.json(publicBatch(batch, jobs));
  } catch (error) {
    return next(error);
  }
});

module.exports = { deploymentBatchesRouter, publicBatch };
