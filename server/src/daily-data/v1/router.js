const { Router } = require('express');
const { getBuilderDataDb, getDb } = require('../../db.js');
const { config } = require('../../config.js');
const { hasRole, trustedIdentityForRequest } = require('./identity.js');
const { getDailyDataDomain, provisionSite } = require('./service.js');

function expectedVersionFrom(req, body = {}) {
  if (body.expectedVersion !== undefined) return body.expectedVersion;
  const header = req.get('if-match');
  return header ? Number(String(header).replace(/^W\//i, '').replace(/"/g, '').trim()) : undefined;
}

function requestMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') || '' };
}

function requireRole(role) {
  return (req, _res, next) => {
    if (hasRole(req.dailyDataSite, req.dailyDataPrincipal, role)) return next();
    return next(Object.assign(new Error(`The trusted identity is not authorized to ${role} this site's data.`), {
      statusCode: 403,
      code: 'site_access_forbidden',
    }));
  };
}

function writeRole(req) {
  return String(req.params.scope || '').startsWith('interaction') ? 'submitters' : 'editors';
}

function createDailyDataRouter() {
  const router = Router();

  router.use((req, _res, next) => {
    try {
      req.dailyDataPrincipal = trustedIdentityForRequest(req);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'site-release-manager-daily-data', version: 1, dataApiBaseUrl: config.dailyDataApiUrl });
  });

  router.get('/readyz', async (_req, res, next) => {
    try {
      const db = getBuilderDataDb();
      await db.command({ ping: 1 });
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      const names = new Set(collections.map(({ name }) => name));
      const required = ['sites', 'site_data_revisions', 'site_data_audit_logs'];
      const missingCollections = required.filter((name) => !names.has(name));
      res.json({ ok: missingCollections.length === 0, service: 'site-release-manager-daily-data', readiness: missingCollections.length ? 'not_ready' : 'ready', missingCollections });
    } catch (error) {
      next(error);
    }
  });

  router.param('siteId', async (req, _res, next, siteId) => {
    try {
      const site = await getDb().collection('sites').findOne({
        builderSiteId: String(siteId),
        storageBackend: 'mongo',
      });
      if (!site) {
        throw Object.assign(new Error('Mongo site was not found.'), { statusCode: 404, code: 'site_not_found' });
      }
      req.dailyDataSite = site;
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/sites/:siteId/provision-status', requireRole('administrators'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      res.json({ ok: true, provisionStatus: await domain.inspectSiteProvisioning(req.params.siteId) });
    } catch (error) { next(error); }
  });

  router.post('/sites/:siteId/provision', requireRole('administrators'), async (req, res, next) => {
    try {
      if (req.body?.repair !== true) {
        throw Object.assign(new Error('Provisioning is an explicit repair operation; pass repair=true.'), { statusCode: 400, code: 'repair_confirmation_required' });
      }
      res.json({ ok: true, ...(await provisionSite(req.dailyDataSite, req.dailyDataPrincipal)) });
    } catch (error) { next(error); }
  });

  router.get('/sites/:siteId/legacy-object', requireRole('viewers'), async (req, res, next) => {
    try {
      const key = String(req.query.key || '').trim();
      if (!key) throw Object.assign(new Error('key query parameter is required'), { statusCode: 400, code: 'bad_request' });
      const domain = await getDailyDataDomain();
      res.json({ ok: true, ...(await domain.legacyRepository.readLegacyObject(req.params.siteId, key, { allowMissing: true })) });
    } catch (error) { next(error); }
  });

  router.put('/sites/:siteId/legacy-object', requireRole('editors'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.legacyWriteSchema, req.body);
      res.json({ ok: true, ...(await domain.legacyRepository.writeLegacyObject({
        siteId: req.params.siteId, ...body, actor: req.dailyDataPrincipal, metadata: requestMeta(req),
      })) });
    } catch (error) { next(error); }
  });

  router.get('/sites/:siteId/data/:scope', requireRole('viewers'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      res.json({ ok: true, documents: await domain.repository.listDocuments(req.params.siteId, req.params.scope) });
    } catch (error) { next(error); }
  });

  router.get('/sites/:siteId/data/:scope/:entityId', requireRole('viewers'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      res.json({ ok: true, document: await domain.repository.getDocument(req.params.siteId, req.params.scope, decodeURIComponent(req.params.entityId)) });
    } catch (error) { next(error); }
  });

  router.put('/sites/:siteId/data/:scope/:entityId', (req, res, next) => requireRole(writeRole(req))(req, res, next), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.putDataSchema, req.body);
      res.json({ ok: true, document: await domain.repository.replaceDocument({
        siteId: req.params.siteId, scope: req.params.scope, entityId: decodeURIComponent(req.params.entityId),
        data: body.data, expectedVersion: expectedVersionFrom(req, body), allowEmptyOverwrite: body.allowEmptyOverwrite === true,
        actor: req.dailyDataPrincipal, metadata: requestMeta(req),
      }) });
    } catch (error) { next(error); }
  });

  router.patch('/sites/:siteId/data/:scope/:entityId', (req, res, next) => requireRole(writeRole(req))(req, res, next), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.patchDataSchema, req.body);
      res.json({ ok: true, document: await domain.repository.patchDocument({
        siteId: req.params.siteId, scope: req.params.scope, entityId: decodeURIComponent(req.params.entityId),
        patch: body.patch ?? body.data, expectedVersion: expectedVersionFrom(req, body), allowEmptyOverwrite: body.allowEmptyOverwrite === true,
        actor: req.dailyDataPrincipal, metadata: requestMeta(req),
      }) });
    } catch (error) { next(error); }
  });

  router.delete('/sites/:siteId/data/:scope/:entityId', (req, res, next) => requireRole(writeRole(req))(req, res, next), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      res.json({ ok: true, document: await domain.repository.softDeleteDocument({
        siteId: req.params.siteId, scope: req.params.scope, entityId: decodeURIComponent(req.params.entityId),
        expectedVersion: expectedVersionFrom(req, req.body || {}), actor: req.dailyDataPrincipal, metadata: requestMeta(req),
      }) });
    } catch (error) { next(error); }
  });

  router.post('/sites/:siteId/data/batch-read', requireRole('viewers'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.batchReadSchema, req.body);
      res.json({ ok: true, results: await domain.repository.batchRead(req.params.siteId, body.items) });
    } catch (error) { next(error); }
  });

  router.post('/sites/:siteId/data/batch-write', requireRole('editors'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.batchWriteSchema, req.body);
      const results = await domain.repository.batchWrite(req.params.siteId, body.operations, req.dailyDataPrincipal);
      const hasFailure = results.some((result) => !result.ok);
      res.status(hasFailure ? 207 : 200).json({ ok: !hasFailure, results });
    } catch (error) { next(error); }
  });

  router.post('/sites/:siteId/legacy/batch-read', requireRole('viewers'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.legacyBatchReadSchema, req.body);
      const results = await Promise.all(body.keys.map(async (key) => {
        try {
          return { ok: true, ...(await domain.legacyRepository.readLegacyObject(req.params.siteId, key, { allowMissing: true })) };
        } catch (error) {
          return { ok: false, key, error: error.code || 'read_failed', message: error.message };
        }
      }));
      res.json({ ok: results.every((result) => result.ok), results });
    } catch (error) { next(error); }
  });

  router.post('/sites/:siteId/legacy/batch-write', requireRole('editors'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.legacyBatchWriteSchema, req.body);
      const results = await Promise.all(body.items.map(async (item) => {
        try {
          return {
            ok: true,
            ...(await domain.legacyRepository.writeLegacyObject({
              siteId: req.params.siteId, ...item, actor: req.dailyDataPrincipal, metadata: requestMeta(req),
            })),
          };
        } catch (error) {
          return { ok: false, key: item.key, error: error.code || 'write_failed', message: error.message };
        }
      }));
      const hasFailure = results.some((result) => !result.ok);
      res.status(hasFailure ? 207 : 200).json({ ok: !hasFailure, results });
    } catch (error) { next(error); }
  });

  router.get('/sites/:siteId/backups', requireRole('administrators'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      res.json({ ok: true, backups: await domain.backupRepository.listBackups(req.params.siteId) });
    } catch (error) { next(error); }
  });

  router.get('/sites/:siteId/backups/:backupId', requireRole('administrators'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      res.json({ ok: true, backup: await domain.backupRepository.getBackup(req.params.siteId, decodeURIComponent(req.params.backupId)) });
    } catch (error) { next(error); }
  });

  router.delete('/sites/:siteId/backups/:backupId', requireRole('administrators'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.backupDeleteSchema, req.body || {});
      res.json({ ok: true, backup: await domain.backupRepository.deleteBackup({
        siteId: req.params.siteId, backupId: decodeURIComponent(req.params.backupId),
        expectedVersion: expectedVersionFrom(req, body || {}), actor: req.dailyDataPrincipal, metadata: requestMeta(req),
      }) });
    } catch (error) { next(error); }
  });

  router.post('/sites/:siteId/backups/:backupId/restore', requireRole('administrators'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.backupRestoreSchema, req.body || {});
      res.json({ ok: true, ...(await domain.backupRepository.restoreBackup({
        siteId: req.params.siteId, backupId: decodeURIComponent(req.params.backupId), ...body,
        actor: req.dailyDataPrincipal, metadata: requestMeta(req),
      })) });
    } catch (error) { next(error); }
  });

  router.post('/sites/:siteId/backups', requireRole('administrators'), async (req, res, next) => {
    try {
      const domain = await getDailyDataDomain();
      const body = domain.schemas.parseOrBadRequest(domain.schemas.backupCreateSchema, req.body);
      res.status(201).json({ ok: true, backup: await domain.backupRepository.createBackup({
        siteId: req.params.siteId, ...body, actor: req.dailyDataPrincipal, metadata: requestMeta(req),
      }) });
    } catch (error) { next(error); }
  });

  router.use((error, _req, res, _next) => {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    res.status(status).json({
      ok: false,
      error: {
        code: error?.code || 'internal_error',
        message: status === 500 ? 'Internal server error' : error.message,
        ...(error?.details === undefined ? {} : { details: error.details }),
      },
    });
  });

  return router;
}

module.exports = { createDailyDataRouter };
