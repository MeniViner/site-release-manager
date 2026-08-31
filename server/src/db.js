import { MongoClient } from 'mongodb';
import { config } from './config.js';
import { buildSiteIdentity, canonicalTargetKey } from '../../shared/siteRuntime.js';

let client;
let database;

export async function connectDb() {
  if (database) return database;
  client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  database = client.db(config.mongoDbName);
  await migrateIndexes(database);
  return database;
}

/**
 * Index migration.
 *
 * The original unique index was { host, siteCode }. That made the required
 * multi-target model impossible: /sites/schedule can host several INDEPENDENT
 * logical Site Builder installations (siteDB + siteUsersDb, siteDBFinance +
 * siteUsersDBFinance, ...), which share host and siteCode but are separate
 * targets. Uniqueness now lives on the canonical target key.
 */
export async function migrateIndexes(db) {
  await backfillTargetKeys(db);

  const sites = db.collection('sites');
  const existing = await sites.indexes().catch(() => []);
  for (const index of existing) {
    const keys = Object.keys(index.key || {});
    const isLegacyUnique = index.unique && keys.length === 2 && keys.includes('host') && keys.includes('siteCode');
    if (isLegacyUnique) {
      console.log(`[db] Dropping legacy unique index ${index.name} (host+siteCode) so one SharePoint Web can host several logical targets.`);
      await sites.dropIndex(index.name).catch((error) => {
        console.warn(`[db] Could not drop ${index.name}: ${error.message}`);
      });
    }
  }

  await Promise.all([
    sites.createIndex({ targetKey: 1 }, { unique: true, sparse: true }),
    sites.createIndex({ host: 1, siteCode: 1 }),
    db.collection('releases').createIndex({ version: 1 }, { unique: true }),
    db.collection('deployment_jobs').createIndex({ siteId: 1, createdAt: -1 }),
    db.collection('deployment_jobs').createIndex({ state: 1, createdAt: 1 }),
    db.collection('deployment_jobs').createIndex({ targetKey: 1, createdAt: -1 }),
    db.collection('deployment_locks').createIndex({ targetKey: 1 }, { unique: true }),
    db.collection('deployment_locks').createIndex({ jobId: 1 }),
    db.collection('backups').createIndex({ runId: 1, trigger: 1 }, { unique: true }),
    db.collection('backups').createIndex({ siteId: 1, createdAt: -1 }),
    db.collection('backups').createIndex({ storageBackend: 1, outcome: 1, createdAt: -1 }),
    db.collection('backups').createIndex({ targetKey: 1, createdAt: -1 }),
  ]);
}

/** Existing site records predate targetKey and are backfilled in place. */
async function backfillTargetKeys(db) {
  const sites = db.collection('sites');
  const pending = await sites.find({ $or: [{ targetKey: { $exists: false } }, { targetKey: null }, { targetKey: '' }] }).toArray();
  let updated = 0;
  for (const site of pending) {
    try {
      const targetKey = canonicalTargetKey(buildSiteIdentity(site));
      await sites.updateOne({ _id: site._id }, { $set: { targetKey } });
      updated += 1;
    } catch (error) {
      // A record with an unusable identity is left alone so it stays visible
      // and repairable in the UI instead of blocking startup.
      console.warn(`[db] Site ${site._id} has an invalid target identity and was not backfilled: ${error.message}`);
    }
  }
  if (updated) console.log(`[db] Backfilled targetKey on ${updated} site record(s).`);
}

export function getDb() {
  if (!database) throw new Error('MongoDB is not connected.');
  return database;
}

export async function closeDb() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}
