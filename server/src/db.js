import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client;
let database;

export async function connectDb() {
  if (database) return database;
  client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  database = client.db(config.mongoDbName);

  await Promise.all([
    database.collection('sites').createIndex({ host: 1, siteCode: 1 }, { unique: true }),
    database.collection('releases').createIndex({ version: 1 }, { unique: true }),
    database.collection('deployment_jobs').createIndex({ siteId: 1, createdAt: -1 }),
    database.collection('deployment_jobs').createIndex({ state: 1, createdAt: 1 }),
  ]);

  return database;
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
