const { Router } = require("express");
const { ObjectId } = require("mongodb");
const { getDb } = require("../db.js");
const { normalizeBackend } = require("../utils/backendMode.js");

const migrationsRouter = Router();

const publicPlan = (plan) => ({
  ...plan,
  id: String(plan._id),
  _id: undefined,
  sourceSiteId: String(plan.sourceSiteId),
  destinationSiteId: String(plan.destinationSiteId),
});

migrationsRouter.get('/', async (_req, res, next) => {
  try {
    const plans = await getDb().collection('migration_plans').find({}).sort({ updatedAt: -1 }).toArray();
    return res.json(plans.map(publicPlan));
  } catch (error) {
    return next(error);
  }
});

migrationsRouter.post('/', async (req, res, next) => {
  try {
    const sourceId = String(req.body?.sourceSiteId || '');
    const destinationId = String(req.body?.destinationSiteId || '');
    if (!ObjectId.isValid(sourceId) || !ObjectId.isValid(destinationId) || sourceId === destinationId) {
      return res.status(400).json({ error: 'Source and destination Sites must be different valid records.', code: 'INVALID_MIGRATION_PAIR' });
    }
    const db = getDb();
    const [source, destination] = await Promise.all([
      db.collection('sites').findOne({ _id: new ObjectId(sourceId) }),
      db.collection('sites').findOne({ _id: new ObjectId(destinationId) }),
    ]);
    if (!source || !destination) return res.status(404).json({ error: 'Source or destination Site was not found.' });
    if (normalizeBackend(source.storageBackend) !== 'txt' || normalizeBackend(destination.storageBackend) !== 'mongo') {
      return res.status(409).json({ error: 'Migration requires a TXT source and Mongo destination.', code: 'INVALID_MIGRATION_BACKENDS' });
    }
    if (!destination.migrationRehearsal) {
      return res.status(409).json({ error: 'Mongo destination must be explicitly marked in the Migration workflow as a rehearsal Site.', code: 'REHEARSAL_REQUIRED' });
    }
    if (source.targetKey === destination.targetKey || source.builderSiteId === destination.builderSiteId) {
      return res.status(409).json({ error: 'Rehearsal destination must use a different logical and Mongo target.', code: 'REHEARSAL_TARGET_CONFLICT' });
    }
    const now = new Date();
    const document = {
      sourceSiteId: source._id,
      sourceTargetKey: source.targetKey,
      sourceBackend: 'txt',
      destinationSiteId: destination._id,
      destinationTargetKey: destination.targetKey,
      destinationBackend: 'mongo',
      state: 'PREFLIGHT_REQUIRED',
      notes: String(req.body?.notes || '').slice(0, 2000),
      inventory: null,
      warnings: [],
      validation: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.collection('migration_plans').insertOne(document);
    return res.status(201).json(publicPlan({ ...document, _id: result.insertedId }));
  } catch (error) {
    return next(error);
  }
});

// Rehearsal is migration-only metadata; ordinary site creation and editing can
// neither set nor change it.
migrationsRouter.post('/destinations/:id/rehearsal', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Mongo destination Site was not found.' });
    const result = await getDb().collection('sites').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), storageBackend: 'mongo' },
      { $set: { migrationRehearsal: true, migrationRehearsalMarkedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ error: 'Mongo destination Site was not found.' });
    return res.json({ id: String(result._id), migrationRehearsal: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = { migrationsRouter };
