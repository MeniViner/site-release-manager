import { Router } from 'express';
import { getDb } from '../db.js';
import { BACKUP_OUTCOMES, objectIdOrNull, publicBackup } from '../services/backupService.js';

export const backupsRouter = Router();

backupsRouter.get('/', async (req, res, next) => {
  try {
    const query = {};
    if (req.query.siteId) {
      const siteId = objectIdOrNull(req.query.siteId);
      if (!siteId) return res.status(400).json({ error: 'מזהה האתר אינו תקין.' });
      query.siteId = siteId;
    }
    if (req.query.backend) query.storageBackend = String(req.query.backend).toLowerCase();
    if (req.query.outcome) {
      const outcome = String(req.query.outcome).toUpperCase();
      if (!BACKUP_OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'תוצאת הגיבוי אינה תקינה.' });
      query.outcome = outcome;
    }

    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const db = getDb();
    const records = await db.collection('backups').find(query).sort({ createdAt: -1 }).limit(limit).toArray();
    const siteIds = [...new Set(records.map((record) => String(record.siteId)))].map(objectIdOrNull).filter(Boolean);
    const sites = siteIds.length ? await db.collection('sites').find({ _id: { $in: siteIds } }).toArray() : [];
    const siteMap = new Map(sites.map((site) => [String(site._id), site]));
    return res.json(records.map((record) => publicBackup(record, siteMap.get(String(record.siteId)))));
  } catch (error) {
    return next(error);
  }
});

backupsRouter.get('/:id', async (req, res, next) => {
  try {
    const objectId = objectIdOrNull(req.params.id);
    if (!objectId) return res.status(404).json({ error: 'הגיבוי לא נמצא.' });
    const db = getDb();
    const record = await db.collection('backups').findOne({ _id: objectId });
    if (!record) return res.status(404).json({ error: 'הגיבוי לא נמצא.' });
    const site = await db.collection('sites').findOne({ _id: record.siteId });
    return res.json(publicBackup(record, site));
  } catch (error) {
    return next(error);
  }
});
