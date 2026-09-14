const { Router } = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db.js");
const jobsRouter = Router();

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

module.exports = {
  jobsRouter: jobsRouter,
};
