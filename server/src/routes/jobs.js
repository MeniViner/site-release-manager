import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../db.js';

export const jobsRouter = Router();

jobsRouter.get('/site/:siteId', async (req, res, next) => {
  try {
    const jobs = await getDb().collection('deployment_jobs')
      .find({ siteId: new ObjectId(req.params.siteId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    return res.json(jobs.map((job) => ({ ...job, id: String(job._id), _id: undefined })));
  } catch (error) {
    return next(error);
  }
});

jobsRouter.get('/:id', async (req, res, next) => {
  try {
    const job = await getDb().collection('deployment_jobs').findOne({ _id: new ObjectId(req.params.id) });
    if (!job) return res.status(404).json({ error: 'המשימה לא נמצאה.' });
    return res.json({ ...job, id: String(job._id), _id: undefined });
  } catch (error) {
    return next(error);
  }
});
