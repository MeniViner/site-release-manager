import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { prepareDeploymentJob } from './deploymentService.js';
import { appendRunEvent, RUN_STAGES } from './runTelemetry.js';

async function markFailed(jobId, error) {
  const db = getDb();
  const objectId = new ObjectId(jobId);
  const job = await db.collection('deployment_jobs').findOne({ _id: objectId });
  const now = new Date();
  await appendRunEvent(objectId, {
    stage: job?.currentStage || RUN_STAGES.RELEASE_VALIDATED,
    status: 'failed',
    source: 'server',
    message: error.message,
    details: { stack: error.stack || '' },
  });
  await db.collection('deployment_jobs').updateOne(
    { _id: objectId },
    {
      $set: { state: 'FAILED', progress: 100, error: error.message, finishedAt: now, updatedAt: now },
      $push: { logs: `[${now.toISOString()}] ERROR: ${error.message}` },
    },
  );
  if (job?.siteId) {
    await db.collection('sites').updateOne(
      { _id: job.siteId },
      { $set: { status: 'FAILED', activeJobId: null, updatedAt: now } },
    );
  }
}

export async function createDeploymentJob({ siteId, releaseId, type = 'UPDATE', force = false }) {
  const db = getDb();
  const normalizedSiteId = new ObjectId(siteId);
  const normalizedReleaseId = new ObjectId(releaseId);
  const release = await db.collection('releases').findOne({ _id: normalizedReleaseId });
  if (!release) throw new Error('הריליס לא נמצא.');
  if (release.artifactType !== 'universal-dist') {
    throw new Error('הריליס נוצר במודל הישן של קוד מקור. העלה Universal dist חדש.');
  }

  const active = await db.collection('deployment_jobs').findOne({
    siteId: normalizedSiteId,
    state: { $in: ['PREPARING_RELEASE', 'READY_FOR_SHAREPOINT', 'DEPLOYING'] },
  });
  if (active && !force) {
    const error = new Error('כבר קיימת משימה פעילה לאתר הזה.');
    error.code = 'ACTIVE_JOB_EXISTS';
    error.activeJobId = String(active._id);
    throw error;
  }
  if (active && force) {
    const supersededAt = new Date();
    await appendRunEvent(active._id, {
      stage: active.currentStage || 'SUPERSEDED',
      stageLabel: 'הריצה הוחלפה',
      status: 'warning',
      source: 'server',
      message: 'המשימה הוחלפה בהרצה חדשה לפי בקשת המשתמש.',
    });
    await db.collection('deployment_jobs').updateOne(
      { _id: active._id },
      {
        $set: {
          state: 'INTERRUPTED',
          progress: 100,
          message: 'המשימה הוחלפה בהרצה חדשה לפי בקשת המשתמש.',
          error: null,
          finishedAt: supersededAt,
          updatedAt: supersededAt,
        },
        $push: { logs: `[${supersededAt.toISOString()}] Superseded by a new deployment request.` },
      },
    );
  }

  const now = new Date();
  const initialEvent = {
    eventId: `${Date.now()}-created`,
    stage: RUN_STAGES.JOB_CREATED,
    stageLabel: 'יצירת משימת פריסה',
    status: 'success',
    source: 'server',
    message: `נוצרה משימת ${type === 'INSTALL' ? 'התקנה' : 'עדכון'} חדשה.`,
    at: now,
  };
  const document = {
    siteId: normalizedSiteId,
    releaseId: normalizedReleaseId,
    type,
    state: 'PREPARING_RELEASE',
    progress: 10,
    message: 'מכין את הריליס לפריסה.',
    currentStage: RUN_STAGES.JOB_CREATED,
    currentStageLabel: 'יצירת משימת פריסה',
    runEvents: [initialEvent],
    logs: [],
    error: null,
    failureInfo: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
  };
  const result = await db.collection('deployment_jobs').insertOne(document);
  await db.collection('sites').updateOne(
    { _id: normalizedSiteId },
    { $set: { status: 'PREPARING_RELEASE', activeJobId: result.insertedId, updatedAt: now } },
  );

  try {
    await prepareDeploymentJob(String(result.insertedId));
  } catch (error) {
    await markFailed(String(result.insertedId), error);
    throw error;
  }
  return db.collection('deployment_jobs').findOne({ _id: result.insertedId });
}

export async function initializeQueue() {
  const db = getDb();
  const now = new Date();
  const interrupted = await db.collection('deployment_jobs').find({ state: 'PREPARING_RELEASE' }).toArray();
  for (const job of interrupted) {
    await appendRunEvent(job._id, {
      stage: job.currentStage || 'SERVER_RESTART',
      stageLabel: 'אתחול שרת בזמן משימה',
      status: 'failed',
      source: 'server',
      message: 'השרת אותחל בזמן הכנת הריליס.',
    });
  }
  await db.collection('deployment_jobs').updateMany(
    { state: 'PREPARING_RELEASE' },
    { $set: { state: 'INTERRUPTED', error: 'Server restarted while preparing deployment metadata.', finishedAt: now, updatedAt: now } },
  );
}
