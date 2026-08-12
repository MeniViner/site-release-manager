import fs from 'node:fs';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';
import { buildSeedFiles } from '../services/seedData.js';
import { isSafeRelativePath, normalizeRelativePath } from '../utils/files.js';
import { resolveDeploymentFile } from '../services/deploymentService.js';
import { runLocalDeploymentVerification } from '../services/localVerificationService.js';
import { appendRunEvent, RUN_STAGES } from '../services/runTelemetry.js';

export const deploymentsRouter = Router();

async function loadContext(jobId) {
  const db = getDb();
  const job = await db.collection('deployment_jobs').findOne({ _id: new ObjectId(jobId) });
  if (!job) return null;
  const [site, release] = await Promise.all([
    db.collection('sites').findOne({ _id: job.siteId }),
    db.collection('releases').findOne({ _id: job.releaseId }),
  ]);
  return { db, job, site, release };
}

function ensureActive(job, site) {
  if (job.state === 'INTERRUPTED' || String(site?.activeJobId || '') !== String(job._id)) {
    const error = new Error('המשימה הזו כבר אינה המשימה הפעילה של האתר. פריסה ישנה לא יכולה לדרוס הרצה חדשה.');
    error.statusCode = 409;
    throw error;
  }
}

deploymentsRouter.get('/:jobId', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    const { job, site, release } = context;
    if (!job.manifestPath || !fs.existsSync(job.manifestPath)) {
      return res.status(409).json({ error: 'הריליס עדיין אינו מוכן לפריסה.' });
    }
    const manifest = JSON.parse(fs.readFileSync(job.manifestPath, 'utf8'));
    const siteRoot = `/sites/${site.siteCode}`;
    const siteDbFolder = String(site.siteDbFolder || 'siteDB').trim();
    const usersDbFolder = String(site.usersDbFolder || 'siteUsersDb').trim();
    const siteAssetsFolder = String(site.siteAssetsFolder || 'siteAssets').trim();
    const imagesFolder = String(site.imagesFolder || 'images').trim();
    const siteDbRoot = `${siteRoot}/${siteDbFolder}`;
    const usersDbRoot = `${siteRoot}/${usersDbFolder}`;
    const finalDistRoot = `${siteDbRoot}/dist`;
    return res.json({
      job: { id: String(job._id), state: job.state, progress: job.progress, type: job.type, currentStage: job.currentStage, currentStageLabel: job.currentStageLabel },
      site: {
        id: String(site._id), name: site.name, host: site.host, siteCode: site.siteCode,
        siteRoot, siteDbFolder, usersDbFolder, siteAssetsFolder, imagesFolder,
        widgetsDbTarget: site.widgetsDbTarget || 'users',
        siteDbRoot, usersDbRoot, finalDistRoot,
        finalUrl: site.finalUrl || `https://${site.host}${finalDistRoot}/index.html`,
      },
      release: { id: String(release._id), version: release.version, notes: release.notes },
      libraries: [
        { title: siteDbFolder, root: siteDbRoot },
        { title: usersDbFolder, root: usersDbRoot },
      ],
      folders: [
        finalDistRoot,
        `${siteDbRoot}/${siteAssetsFolder}`,
        `${siteDbRoot}/${imagesFolder}`,
      ],
      seedFiles: buildSeedFiles(site),
      manifest,
    });
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.get('/:jobId/file', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    const relativePath = normalizeRelativePath(req.query.path || '');
    if (!isSafeRelativePath(relativePath)) return res.status(400).json({ error: 'נתיב הקובץ אינו תקין.' });
    const filePath = resolveDeploymentFile(context.job, context.release, relativePath);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'הקובץ לא נמצא.' });
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

// Structured SharePoint/deployer telemetry. This is intentionally separate from
// high-frequency progress so each logical stage has a durable diagnostic event.
deploymentsRouter.post('/:jobId/event', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    if (context.job.state === 'INTERRUPTED') return res.status(409).json({ error: 'המשימה הוחלפה בהרצה חדשה ואינה פעילה יותר.' });
    const event = await appendRunEvent(context.job._id, {
      ...req.body,
      source: req.body?.source || 'sharepoint-deployer',
    });
    return res.json({ ok: true, event });
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.post('/:jobId/progress', async (req, res, next) => {
  try {
    const progress = Math.max(0, Math.min(99, Number(req.body?.progress || 0)));
    const message = String(req.body?.message || '').slice(0, 500);
    const currentFile = String(req.body?.currentFile || '').slice(0, 500);
    const stage = String(req.body?.stage || '').slice(0, 80);
    const db = getDb();
    const objectId = new ObjectId(req.params.jobId);
    const job = await db.collection('deployment_jobs').findOne({ _id: objectId });
    if (!job) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    if (job.state === 'INTERRUPTED') return res.status(409).json({ error: 'המשימה הוחלפה בהרצה חדשה ואינה פעילה יותר.' });
    const set = { state: 'DEPLOYING', progress, message, currentFile, updatedAt: new Date() };
    if (stage) set.currentStage = stage;
    await db.collection('deployment_jobs').updateOne(
      { _id: objectId },
      {
        $set: set,
        $push: { logs: { $each: [`[${new Date().toISOString()}] ${message}${currentFile ? ` | ${currentFile}` : ''}`], $slice: -500 } },
      },
    );
    await db.collection('sites').updateOne(
      { _id: job.siteId },
      { $set: { status: 'DEPLOYING', updatedAt: new Date() } },
    );
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
    ensureActive(job, site);
    const now = new Date();
    await appendRunEvent(job._id, {
      stage: RUN_STAGES.COMPLETE,
      status: 'success',
      source: 'sharepoint-deployer',
      message: 'SharePoint Deployer דיווח שהפריסה הושלמה ואומתה.',
      details: req.body || {},
    });
    await db.collection('deployment_jobs').updateOne(
      { _id: job._id },
      {
        $set: {
          state: 'SUCCEEDED',
          progress: 100,
          message: 'הפריסה הושלמה בהצלחה.',
          deploymentSummary: req.body || {},
          finishedAt: now,
          updatedAt: now,
          error: null,
        },
        $push: { logs: `[${now.toISOString()}] SharePoint deployment completed.` },
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
        },
      },
    );
    if (!site.firstPublishedAt) {
      await db.collection('sites').updateOne({ _id: site._id }, { $set: { firstPublishedAt: now } });
    }
    return res.json({ ok: true, finalUrl: site.finalUrl });
  } catch (error) {
    return next(error);
  }
});

deploymentsRouter.post('/:jobId/fail', async (req, res, next) => {
  try {
    const context = await loadContext(req.params.jobId);
    if (!context) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    const message = String(req.body?.error || 'SharePoint deployment failed.').slice(0, 2000);
    const now = new Date();
    const alreadyCaptured = req.body?.eventAlreadyReported === true && context.job.failureInfo?.stage === (req.body?.stage || context.job.currentStage);
    if (!alreadyCaptured) {
      await appendRunEvent(context.job._id, {
        stage: req.body?.stage || context.job.currentStage || 'SHAREPOINT_DEPLOYMENT',
        stageLabel: req.body?.stageLabel || context.job.currentStageLabel || 'פריסת SharePoint',
        status: 'failed',
        source: 'sharepoint-deployer',
        message,
        currentFile: req.body?.currentFile || context.job.currentFile || '',
        operation: req.body?.operation || '',
        method: req.body?.method || '',
        url: req.body?.url || '',
        httpStatus: req.body?.httpStatus,
        durationMs: req.body?.durationMs,
        details: req.body?.details || null,
      });
    }
    await context.db.collection('deployment_jobs').updateOne(
      { _id: context.job._id },
      {
        $set: { state: 'FAILED', progress: 100, error: message, message: 'הפריסה נכשלה.', finishedAt: now, updatedAt: now },
        $push: { logs: `[${now.toISOString()}] ERROR: ${message}` },
      },
    );
    await context.db.collection('sites').updateOne(
      { _id: context.site._id },
      { $set: { status: 'FAILED', activeJobId: null, updatedAt: now } },
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});
