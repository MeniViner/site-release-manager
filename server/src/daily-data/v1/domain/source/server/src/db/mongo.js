import { MongoClient } from 'mongodb';
import { safeMongoError } from './mongoTarget.js';

export const SAFE_WRITE_CONCERN = Object.freeze({ w: 'majority', j: true });
export const REQUIRED_BUILDER_COLLECTIONS = Object.freeze([
  'sites',
  'site_data_revisions',
  'site_data_audit_logs',
]);

export async function createMongoDb({ mongodbUri, mongodbDbName }) {
  if (!mongodbUri) {
    throw new Error('MONGODB_URI is required');
  }
  if (!mongodbDbName) {
    throw new Error('MONGODB_DB_NAME is required');
  }

  const client = new MongoClient(mongodbUri, {
    writeConcern: SAFE_WRITE_CONCERN,
    retryWrites: true,
  });
  try {
    await client.connect();
  } catch (error) {
    await client.close().catch(() => undefined);
    const safe = safeMongoError(error, mongodbDbName);
    throw Object.assign(new Error(safe.message), { code: safe.code });
  }
  return {
    client,
    db: client.db(mongodbDbName),
  };
}

// This check deliberately uses only read operations. Index creation belongs to
// the controlled import/bootstrap procedure, never normal process startup.
export async function inspectBuilderDataPlane(db) {
  await db.command({ ping: 1 });
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const collectionNames = new Set(collections.map(({ name }) => name));
  const missingCollections = REQUIRED_BUILDER_COLLECTIONS.filter((name) => !collectionNames.has(name));

  return {
    ok: missingCollections.length === 0,
    missingCollections,
  };
}

export async function assertBuilderDataPlaneReady(db, { requireCollections = false } = {}) {
  const result = await inspectBuilderDataPlane(db);
  if (requireCollections && !result.ok) {
    throw new Error('Builder data plane is missing required collections. Complete the verified import before starting the API.');
  }
  return result;
}
