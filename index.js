import fs from 'node:fs';
import { config, paths } from './server/src/config.js';
import { connectDb, closeDb } from './server/src/db.js';
import { createApp } from './server/src/app.js';
import { initializeQueue } from './server/src/services/jobQueue.js';

let server;

async function start() {
  for (const directory of Object.values(paths)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  await connectDb();
  await initializeQueue();

  const app = createApp();
  const listenTarget = process.env.PORT || config.port || 4300;

  server = app.listen(listenTarget, () => {
    console.log(`[iis] Site Release Manager started. PORT=${String(listenTarget)}`);
    console.log(`[iis] MongoDB=${config.mongoUri} DB=${config.mongoDbName}`);
    console.log(`[iis] SharePoint hosts=${config.sharePointHosts.join(', ')}`);
  });
}

async function shutdown() {
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await closeDb();
  }
}

process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));

start().catch((error) => {
  console.error('[iis] Startup failed:', error);
  process.exitCode = 1;
});
