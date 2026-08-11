import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { createDeploymentJob } from '../services/jobQueue.js';

export const sitesRouter = Router();

const validSiteCode = (value) => /^[a-z0-9][a-z0-9-]{1,49}$/.test(String(value || '').trim());
const validPathSegment = (value) => /^[A-Za-z0-9._-]{1,80}$/.test(String(value || '').trim());
const toDateOrNull = (value) => (value ? new Date(value) : null);

function publicSite(site) {
  return site ? { ...site, id: String(site._id), _id: undefined } : null;
}

sitesRouter.get('/', async (_req, res, next) => {
  try {
    const sites = await getDb().collection('sites').find({}).sort({ updatedAt: -1 }).toArray();
    res.json(sites.map(publicSite));
  } catch (error) {
    next(error);
  }
});

sitesRouter.get('/:id', async (req, res, next) => {
  try {
    const site = await getDb().collection('sites').findOne({ _id: new ObjectId(req.params.id) });
    if (!site) return res.status(404).json({ error: 'האתר לא נמצא.' });
    return res.json(publicSite(site));
  } catch (error) {
    return next(error);
  }
});

sitesRouter.post('/', async (req, res, next) => {
  try {
    const { mode = 'existing', unit, name, host, siteCode, managerName, currentVersion, firstPublishedAt, lastPublishedAt, releaseId, siteDbFolder = 'siteDB', usersDbFolder = 'siteUsersDb', siteAssetsFolder = 'siteAssets', imagesFolder = 'images', widgetsDbTarget = 'users' } = req.body || {};
    const normalizedHost = String(host || '').trim().toLowerCase();
    const normalizedCode = String(siteCode || '').trim().toLowerCase();
    if (!unit || !name || !managerName) return res.status(400).json({ error: 'יחידה, שם האתר ומנהל האתר הם שדות חובה.' });
    if (!config.sharePointHosts.includes(normalizedHost)) return res.status(400).json({ error: 'Host אינו מופיע ברשימת ה-Hosts המוגדרת.' });
    if (!validSiteCode(normalizedCode)) return res.status(400).json({ error: 'קוד האתר חייב להכיל אותיות אנגליות קטנות, מספרים או מקף.' });
    const normalizedSiteDbFolder = String(siteDbFolder || 'siteDB').trim();
    const normalizedUsersDbFolder = String(usersDbFolder || 'siteUsersDb').trim();
    const normalizedSiteAssetsFolder = String(siteAssetsFolder || 'siteAssets').trim();
    const normalizedImagesFolder = String(imagesFolder || 'images').trim();
    const normalizedWidgetsDbTarget = String(widgetsDbTarget || 'users').trim().toLowerCase() === 'site' ? 'site' : 'users';
    for (const [label, value] of [
      ['siteDbFolder', normalizedSiteDbFolder],
      ['usersDbFolder', normalizedUsersDbFolder],
      ['siteAssetsFolder', normalizedSiteAssetsFolder],
      ['imagesFolder', normalizedImagesFolder],
    ]) {
      if (!validPathSegment(value)) return res.status(400).json({ error: `${label} חייב להיות שם תיקייה/ספרייה יחיד ללא נתיב מלא.` });
    }

    const now = new Date();
    const document = {
      mode: mode === 'install' ? 'install' : 'existing',
      unit: String(unit).trim(),
      name: String(name).trim(),
      host: normalizedHost,
      siteCode: normalizedCode,
      managerName: String(managerName).trim(),
      storageType: 'txt',
      siteDbFolder: normalizedSiteDbFolder,
      usersDbFolder: normalizedUsersDbFolder,
      siteAssetsFolder: normalizedSiteAssetsFolder,
      imagesFolder: normalizedImagesFolder,
      widgetsDbTarget: normalizedWidgetsDbTarget,
      status: mode === 'install' ? 'DRAFT' : 'TRACKED',
      currentVersion: currentVersion ? String(currentVersion).trim() : null,
      currentReleaseId: null,
      firstPublishedAt: toDateOrNull(firstPublishedAt),
      lastPublishedAt: toDateOrNull(lastPublishedAt),
      finalUrl: `https://${normalizedHost}/sites/${normalizedCode}/${normalizedSiteDbFolder}/dist/index.html`,
      activeJobId: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await getDb().collection('sites').insertOne(document);
    let job = null;
    if (mode === 'install' && releaseId) {
      job = await createDeploymentJob({ siteId: result.insertedId, releaseId, type: 'INSTALL' });
    }
    res.status(201).json({ site: publicSite({ ...document, _id: result.insertedId }), job });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'האתר כבר קיים ברשימת המעקב.' });
    return next(error);
  }
});

sitesRouter.patch('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const objectId = new ObjectId(req.params.id);
    const existing = await db.collection('sites').findOne({ _id: objectId });
    if (!existing) return res.status(404).json({ error: 'האתר לא נמצא.' });
    if (existing.activeJobId) return res.status(409).json({ error: 'לא ניתן לערוך אתר בזמן שריצת פריסה פעילה. סיים או הפסק את הריצה קודם.' });

    const body = req.body || {};
    const nextHost = 'host' in body ? String(body.host || '').trim().toLowerCase() : existing.host;
    const nextCode = 'siteCode' in body ? String(body.siteCode || '').trim().toLowerCase() : existing.siteCode;
    if (!config.sharePointHosts.includes(nextHost)) return res.status(400).json({ error: 'Host אינו מופיע ברשימת ה-Hosts המוגדרת.' });
    if (!validSiteCode(nextCode)) return res.status(400).json({ error: 'קוד האתר חייב להכיל אותיות אנגליות קטנות, מספרים או מקף.' });

    const patch = {};
    for (const key of ['unit', 'name', 'managerName', 'currentVersion']) {
      if (key in body) patch[key] = String(body[key] ?? '').trim() || (key === 'currentVersion' ? null : '');
    }
    if ('host' in body) patch.host = nextHost;
    if ('siteCode' in body) patch.siteCode = nextCode;
    for (const key of ['firstPublishedAt', 'lastPublishedAt']) if (key in body) patch[key] = toDateOrNull(body[key]);

    const folders = {
      siteDbFolder: 'siteDB', usersDbFolder: 'siteUsersDb', siteAssetsFolder: 'siteAssets', imagesFolder: 'images',
    };
    for (const [key, fallback] of Object.entries(folders)) {
      if (!(key in body)) continue;
      const value = String(body[key] || fallback).trim();
      if (!validPathSegment(value)) return res.status(400).json({ error: `${key} חייב להיות שם תיקייה/ספרייה יחיד ללא נתיב מלא.` });
      patch[key] = value;
    }
    if ('widgetsDbTarget' in body) patch.widgetsDbTarget = String(body.widgetsDbTarget || 'users').trim().toLowerCase() === 'site' ? 'site' : 'users';

    const finalHost = patch.host || existing.host;
    const finalCode = patch.siteCode || existing.siteCode;
    const finalSiteDb = patch.siteDbFolder || existing.siteDbFolder || 'siteDB';
    patch.finalUrl = `https://${finalHost}/sites/${finalCode}/${finalSiteDb}/dist/index.html`;
    patch.updatedAt = new Date();

    const result = await db.collection('sites').findOneAndUpdate(
      { _id: objectId }, { $set: patch }, { returnDocument: 'after' },
    );
    return res.json(publicSite(result));
  } catch (error) { return next(error); }
});

sitesRouter.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const objectId = new ObjectId(req.params.id);
    const site = await db.collection('sites').findOne({ _id: objectId });
    if (!site) return res.status(404).json({ error: 'האתר לא נמצא.' });
    if (site.activeJobId) return res.status(409).json({ error: 'לא ניתן למחוק אתר בזמן שריצת פריסה פעילה.' });
    await db.collection('deployment_jobs').deleteMany({ siteId: objectId });
    await db.collection('sites').deleteOne({ _id: objectId });
    return res.status(204).end();
  } catch (error) { return next(error); }
});

sitesRouter.post('/:id/deploy', async (req, res, next) => {
  try {
    const site = await getDb().collection('sites').findOne({ _id: new ObjectId(req.params.id) });
    if (!site) return res.status(404).json({ error: 'האתר לא נמצא.' });
    if (!req.body?.releaseId) return res.status(400).json({ error: 'יש לבחור ריליס.' });
    const job = await createDeploymentJob({
      siteId: site._id,
      releaseId: req.body.releaseId,
      type: site.firstPublishedAt ? 'UPDATE' : 'INSTALL',
      force: req.body?.force === true,
    });
    return res.status(202).json(job);
  } catch (error) {
    if (error?.code === 'ACTIVE_JOB_EXISTS' || /משימה פעילה/.test(error.message)) {
      return res.status(409).json({
        error: error.message,
        code: 'ACTIVE_JOB_EXISTS',
        activeJobId: error.activeJobId || null,
        canForce: true,
      });
    }
    return next(error);
  }
});
