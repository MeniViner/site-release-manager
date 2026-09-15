const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { config, rootDir } = require("./config.js");
const { dashboardRouter } = require("./routes/dashboard.js");
const { sitesRouter } = require("./routes/sites.js");
const { releasesRouter } = require("./routes/releases.js");
const { jobsRouter } = require("./routes/jobs.js");
const { deploymentsRouter } = require("./routes/deployments.js");
const { runsRouter } = require("./routes/runs.js");
const { backupsRouter } = require("./routes/backups.js");
const { deploymentBatchesRouter } = require("./routes/deploymentBatches.js");
const { migrationsRouter } = require("./routes/migrations.js");
const { createDailyDataRouter } = require("./daily-data/v1/router.js");
/**
 * Headers the browser worker sends. X-SRM-Lease carries the exclusive write
 * lease; without it in the allow-list every cross-origin deployment request
 * from SharePoint would be blocked by the preflight.
 */
const ALLOWED_REQUEST_HEADERS = Object.freeze(['Content-Type', 'Accept', 'X-SRM-Lease']);
const DAILY_DATA_REQUEST_HEADERS = Object.freeze(['Content-Type', 'Accept', 'If-Match']);

function createApp() {
  const app = express();
  const allowedOrigins = new Set(config.clientOrigins);

  app.disable('x-powered-by');

  // Release Manager is opened from SharePoint while its API runs on the user's
  // own Windows machine. Chrome/Edge preflight such loopback calls under Private
  // Network Access, and refuse them unless this header comes back.
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });

  const isAllowedOrigin = (origin) => !origin || allowedOrigins.has(origin.replace(/\/+$/, ''));
  // Daily Site Builder data is intentionally isolated from the management API:
  // it needs credentialed PUT/PATCH for the SharePoint/IIS identity flow, while
  // management keeps its existing non-credentialed browser boundary.
  app.use('/api/daily-data/v1', express.json({ limit: '10mb' }));
  app.use('/api/daily-data/v1', cors({
    origin(origin, callback) {
      return callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: DAILY_DATA_REQUEST_HEADERS,
    maxAge: 600,
    optionsSuccessStatus: 204,
  }));
  app.use('/api/daily-data/v1', (req, res, next) => {
    const origin = req.get('origin');
    if (isAllowedOrigin(origin)) return next();
    console.warn(`[daily-data] Rejected request from unconfigured origin: ${origin}`);
    return res.status(403).json({
      ok: false,
      error: { code: 'origin_not_configured', message: 'Origin is not configured for daily data access.' },
    });
  });
  app.use('/api/daily-data/v1', createDailyDataRouter());

  app.use(cors({
    origin(origin, callback) {
      // A same-origin or tool request has no Origin header and is always allowed.
      if (isAllowedOrigin(origin)) return callback(null, true);
      // Reject by NOT setting CORS headers rather than by throwing: throwing
      // turned a configuration problem into an opaque HTTP 500.
      return callback(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ALLOWED_REQUEST_HEADERS,
    maxAge: 600,
    optionsSuccessStatus: 204,
  }));

  // An origin that is not configured gets an actionable answer instead of a
  // silent browser-side CORS failure with no server-side trace.
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (!origin || allowedOrigins.has(origin.replace(/\/+$/, ''))) return next();
    console.warn(`[api] Rejected request from unconfigured origin: ${origin}`);
    return res.status(403).json({
      error: `ה-Origin ${origin} אינו מוגדר ב-CLIENT_ORIGINS.`,
      code: 'ORIGIN_NOT_CONFIGURED',
      configuredOrigins: config.clientOrigins,
      fix: 'הוסף את ה-Origin ל-CLIENT_ORIGINS בקובץ .env והפעל מחדש את npm run sharepoint:local.',
    });
  });

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({
    ok: true,
    appVersion: config.appVersion,
    mongoDbName: config.mongoDbName,
    builderDataMongoDbName: config.builderDataMongoDbName,
    publicApiUrl: config.publicApiUrl,
    clientOrigins: config.clientOrigins,
    sharePointHosts: config.sharePointHosts,
    storageRoot: config.storageRoot,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
  }));

  app.get('/api/config', (_req, res) => res.json({
    sharePointHosts: config.sharePointHosts,
    sharePointDeployerPath: config.sharePointDeployerPath,
    storageType: 'txt',
    publicApiUrl: config.publicApiUrl,
    clientOrigins: config.clientOrigins,
    appVersion: config.appVersion,
    dailyDataApiUrl: config.dailyDataApiUrl,
  }));

  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/sites', sitesRouter);
  app.use('/api/releases', releasesRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/deployments', deploymentsRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/backups', backupsRouter);
  app.use('/api/deployment-batches', deploymentBatchesRouter);
  app.use('/api/migrations', migrationsRouter);

  // An unknown /api route must never fall through to the SPA fallback, which
  // would answer HTML and make a typo look like a broken API.
  app.use('/api', (req, res) => res.status(404).json({ error: `לא קיים API בנתיב ${req.originalUrl}`, code: 'UNKNOWN_API_ROUTE' }));

  const clientDist = path.join(rootDir, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        error: error.code === 'LIMIT_FILE_SIZE' ? 'קובץ בריליס גדול מהמגבלה.'
          : error.code === 'LIMIT_FILE_COUNT' ? 'התיקייה מכילה יותר מדי קבצים.'
            : error.message,
      });
    }
    if (Number.isInteger(error?.statusCode)) {
      return res.status(error.statusCode).json({ error: error.message || 'הקלט אינו תקין.', code: error.code || undefined });
    }
    return res.status(500).json({ error: error.message || 'שגיאת שרת.' });
  });

  return app;
}

const startedAt = new Date();

module.exports = {
  createApp: createApp,
  ALLOWED_REQUEST_HEADERS: ALLOWED_REQUEST_HEADERS,
};
