import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { createDeploymentJob } from '../services/jobQueue.js';

export const sitesRouter = Router();

const validSiteCode = (value) => /^[a-z0-9][a-z0-9-]{1,49}$/.test(String(value || '').trim());
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
    const { mode = 'existing', unit, name, host, siteCode, managerName, currentVersion, firstPublishedAt, lastPublishedAt, releaseId } = req.body || {};
    const normalizedHost = String(host || '').trim().toLowerCase();
    const normalizedCode = String(siteCode || '').trim().toLowerCase();
    if (!unit || !name || !managerName) return res.status(400).json({ error: 'יחידה, שם האתר ומנהל האתר הם שדות חובה.' });
    if (!config.sharePointHosts.includes(normalizedHost)) return res.status(400).json({ error: 'Host אינו מופיע ברשימת ה-Hosts המוגדרת.' });
    if (!validSiteCode(normalizedCode)) return res.status(400).json({ error: 'קוד האתר חייב להכיל אותיות אנגליות קטנות, מספרים או מקף.' });

    const now = new Date();
    const document = {
      mode: mode === 'install' ? 'install' : 'existing',
      unit: String(unit).trim(),
      name: String(name).trim(),
      host: normalizedHost,
      siteCode: normalizedCode,
      managerName: String(managerName).trim(),
      storageType: 'txt',
      status: mode === 'install' ? 'DRAFT' : 'TRACKED',
      currentVersion: currentVersion ? String(currentVersion).trim() : null,
      currentReleaseId: null,
      firstPublishedAt: toDateOrNull(firstPublishedAt),
      lastPublishedAt: toDateOrNull(lastPublishedAt),
      finalUrl: `https://${normalizedHost}/sites/${normalizedCode}/siteDB/dist/index.html`,
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
    const allowed = ['unit', 'name', 'managerName', 'currentVersion', 'firstPublishedAt', 'lastPublishedAt'];
    const patch = {};
    for (const key of allowed) {
      if (!(key in (req.body || {}))) continue;
      patch[key] = key.endsWith('At') ? toDateOrNull(req.body[key]) : req.body[key];
    }
    patch.updatedAt = new Date();
    const result = await getDb().collection('sites').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: patch },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ error: 'האתר לא נמצא.' });
    return res.json(publicSite(result));
  } catch (error) {
    return next(error);
  }
});

sitesRouter.delete('/:id', async (req, res, next) => {
  try {
    const result = await getDb().collection('sites').deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ error: 'האתר לא נמצא.' });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
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
