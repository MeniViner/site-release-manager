import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { config, rootDir } from './config.js';
import { dashboardRouter } from './routes/dashboard.js';
import { sitesRouter } from './routes/sites.js';
import { releasesRouter } from './routes/releases.js';
import { jobsRouter } from './routes/jobs.js';
import { deploymentsRouter } from './routes/deployments.js';
import { runsRouter } from './routes/runs.js';
import { backupsRouter } from './routes/backups.js';

/**
 * Headers the browser worker sends. X-SRM-Lease carries the exclusive write
 * lease; without it in the allow-list every cross-origin deployment request
 * from SharePoint would be blocked by the preflight.
 */
export const ALLOWED_REQUEST_HEADERS = Object.freeze(['Content-Type', 'Accept', 'X-SRM-Lease']);

export function createApp() {
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

  app.use(cors({
    origin(origin, callback) {
      // A same-origin or tool request has no Origin header and is always allowed.
      if (!origin || allowedOrigins.has(origin.replace(/\/+$/, ''))) return callback(null, true);
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
  }));

  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/sites', sitesRouter);
  app.use('/api/releases', releasesRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/deployments', deploymentsRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/backups', backupsRouter);

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
