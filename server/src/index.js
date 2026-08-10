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
    console.error(`[server] MongoDB connection failed: ${error.message}`);
    console.error(`[server] Expected MongoDB at: ${config.mongoUri}`);
    console.error('[server] From the project root run: npm run mongo:start');
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
