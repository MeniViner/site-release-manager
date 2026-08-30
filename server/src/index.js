import fs from 'node:fs';
import { config, paths } from './config.js';
import { connectDb, closeDb } from './db.js';
import { createApp } from './app.js';
import { initializeQueue } from './services/jobQueue.js';

let server;

async function start() {
  for (const directory of Object.values(paths)) fs.mkdirSync(directory, { recursive: true });

  try {
    await connectDb();
  } catch (error) {
    // Be precise about WHICH thing is wrong. On the closed Windows workstation
    // MongoDB runs as a service, so "mongod is not in PATH" is not the problem
    // and telling the operator to install MongoDB would be actively misleading.
    console.error('[server] Could not connect to the Release Manager tracking database.');
    console.error(`[server]   URI:      ${config.mongoUri}`);
    console.error(`[server]   Database: ${config.mongoDbName}`);
    console.error(`[server]   Reason:   ${error.message}`);
    console.error('[server]');
    console.error('[server] This database is used ONLY by Release Manager. It is not Site Builder application data.');
    console.error('[server] Windows, MongoDB installed as a service:');
    console.error('[server]   1. Check the service is running:  sc query MongoDB');
    console.error('[server]   2. Start it if needed:            net start MongoDB');
    console.error('[server]   3. Keep AUTO_START_MONGO=false in .env so this project never starts a second mongod.');
    console.error('[server] Development machine without a service:  npm run mongo:start');
    process.exit(1);
  }

  await initializeQueue();
  const app = createApp();
  server = app.listen(config.port, () => {
    console.log(`Site Release Manager API: http://localhost:${config.port}`);
    console.log(`SharePoint hosts: ${config.sharePointHosts.join(', ')}`);
  });
}

async function shutdown() {
  if (!server) {
    await closeDb();
    process.exit(0);
    return;
  }
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await start();
