const fs = require('node:fs');
const { config, paths } = require('./server/src/config.js');
const { connectDb, closeDb } = require('./server/src/db.js');
const { createApp } = require('./server/src/app.js');
const { initializeQueue } = require('./server/src/services/jobQueue.js');

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
