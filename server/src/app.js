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

export function createApp() {
  const app = express();
  const allowedOrigins = new Set(config.clientOrigins);

  // Chrome/Edge can preflight loopback/local-network requests when the UI is hosted on SharePoint.
  // This response header keeps the local same-PC test explicit without changing SharePoint authentication.
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });

  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`Origin is not configured: ${origin}`));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
  }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, appVersion: config.appVersion, mongoDbName: config.mongoDbName, publicApiUrl: config.publicApiUrl }));
  app.get('/api/config', (_req, res) => res.json({
    sharePointHosts: config.sharePointHosts,
    sharePointDeployerPath: config.sharePointDeployerPath,
    storageType: 'txt',
    publicApiUrl: config.publicApiUrl,
    clientOrigins: config.clientOrigins,
  }));
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/sites', sitesRouter);
  app.use('/api/releases', releasesRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/deployments', deploymentsRouter);
  app.use('/api/runs', runsRouter);

  const clientDist = path.join(rootDir, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'קובץ בריליס גדול מהמגבלה.' : error.code === 'LIMIT_FILE_COUNT' ? 'התיקייה מכילה יותר מדי קבצים.' : error.message });
    }
    if (Number.isInteger(error?.statusCode)) {
      return res.status(error.statusCode).json({ error: error.message || 'הקלט אינו תקין.' });
    }
    return res.status(500).json({ error: error.message || 'שגיאת שרת.' });
  });

  return app;
}
