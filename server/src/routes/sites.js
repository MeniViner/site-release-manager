/**
 * Site (deployment target) CRUD.
 *
 * A Site record TRACKS a SharePoint target. Deleting it removes Release Manager
 * tracking only — it never deletes SharePoint libraries, folders or data.
 *
 * Release Manager does not create SharePoint Site Collections or Webs. It
 * provisions Document Libraries and folders inside a Web that already exists;
 * that boundary is reported explicitly rather than being attempted silently.
 */

import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { createDeploymentJob, findActiveJobForTarget, SITE_IDENTITY_EDIT_TTL_MS } from '../services/jobQueue.js';
import { TargetLockedError } from '../services/targetLock.js';
import { buildSiteIdentity, canonicalTargetKey, SiteIdentityError, requiredLibraries, requiredFolders, buildTxtSeedPlan } from '../../../shared/siteRuntime.js';
import { canonicalState, isResumable, stateLabel } from '../services/jobState.js';
import { publicBackup } from '../services/backupService.js';
import { parseReleaseVersion } from '../utils/versioning.js';

export const sitesRouter = Router();

const toDateOrNull = (value) => (value ? new Date(value) : null);

function isNewerRelease(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  const a = parseReleaseVersion(candidate.version);
  const b = parseReleaseVersion(current.version);
  if (!a || !b) return new Date(candidate.createdAt || 0) > new Date(current.createdAt || 0);
  return a.major > b.major
    || (a.major === b.major && a.minor > b.minor)
    || (a.major === b.major && a.minor === b.minor && a.patch > b.patch);
}

function identityChanged(before, after) {
  if (!before) return true;
  return [
    'host',
    'siteCode',
    'siteDbFolder',
    'usersDbFolder',
    'siteAssetsFolder',
    'imagesFolder',
    'widgetsDbTarget',
    'bootstrapLibrary',
    'bootstrapFolder',
    'storageBackend',
  ].some((key) => String(before[key] || '') !== String(after[key] || ''));
}

/**
 * Release Manager provisions libraries and folders inside an existing
 * SharePoint Web. Creating the Web itself is out of scope and is surfaced to
 * the UI rather than attempted.
 */
export const PROVISIONING_BOUNDARY = Object.freeze({
  createsDocumentLibraries: true,
  createsFolders: true,
  createsTxtSeeds: true,
  createsSharePointWeb: false,
  note: 'Release Manager אינו יוצר אתר SharePoint (Web/Site Collection) חדש. ה-Web חייב להתקיים מראש; Release Manager יוצר בתוכו את ספריות המסמכים, התיקיות וקובצי ה-TXT.',
});

function publicSite(site) {
  if (!site) return null;
  const base = { ...site, id: String(site._id), _id: undefined, identityEdit: undefined };
  try {
    const identity = buildSiteIdentity(site);
    return { ...base, identity, targetKey: canonicalTargetKey(identity), finalUrl: identity.finalAppUrl };
  } catch (error) {
    // A stored record with an invalid identity must still be visible so it can be fixed.
    return { ...base, identity: null, identityError: error.message, targetKey: '', finalUrl: '' };
  }
}

/** Validate the submitted target identity through the single canonical builder. */
function resolveIdentity(candidate) {
  if (!config.sharePointHosts.includes(String(candidate.host || '').trim().toLowerCase())) {
    throw Object.assign(new Error('Host אינו מופיע ברשימת ה-Hosts המוגדרת.'), { statusCode: 400 });
  }
  return buildSiteIdentity(candidate);
}

sitesRouter.get('/', async (_req, res, next) => {
  try {
    const sites = await getDb().collection('sites').find({}).sort({ updatedAt: -1 }).toArray();
    res.json(sites.map(publicSite));
  } catch (error) {
    next(error);
  }
});

sitesRouter.get('/provisioning-boundary', (_req, res) => res.json(PROVISIONING_BOUNDARY));

/** Full site details: derived identity, what will be provisioned, and run history. */
sitesRouter.get('/:id', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'האתר לא נמצא.' });
    const db = getDb();
    const site = await db.collection('sites').findOne({ _id: new ObjectId(req.params.id) });
    if (!site) return res.status(404).json({ error: 'האתר לא נמצא.' });

    const payload = publicSite(site);
    let plan = null;
    let active = null;
    if (payload.identity) {
      plan = {
        libraries: requiredLibraries(payload.identity),
        folders: requiredFolders(payload.identity),
        txtSeeds: buildTxtSeedPlan(payload.identity).map((seed) => ({ fileName: seed.fileName, path: seed.path })),
        boundary: PROVISIONING_BOUNDARY,
      };
      const owner = await findActiveJobForTarget(payload.targetKey);
      if (owner) {
        active = {
          jobId: String(owner.job._id),
          state: canonicalState(owner.job.state),
          stateLabel: stateLabel(owner.job.state),
          stale: owner.stale,
          resumable: isResumable(owner.job.state),
        };
      }
    }

    const targetScopedQuery = payload.targetKey
      ? {
        siteId: site._id,
        $or: [
          { targetKey: payload.targetKey },
          { targetKey: { $exists: false } },
          { targetKey: null },
          { targetKey: '' },
        ],
      }
      : { siteId: site._id };
    const backupQuery = payload.targetKey
      ? { siteId: site._id, targetKey: payload.targetKey }
      : { siteId: site._id };
    const [runs, release, availableReleases, backups] = await Promise.all([
      db.collection('deployment_jobs').find(targetScopedQuery).sort({ createdAt: -1 }).limit(30).toArray(),
      site.currentReleaseId ? db.collection('releases').findOne({ _id: site.currentReleaseId }) : null,
      db.collection('releases').find({ status: 'READY' }).toArray(),
      db.collection('backups').find(backupQuery).sort({ createdAt: -1 }).limit(10).toArray(),
    ]);
    const runReleaseIds = [...new Set(runs.map((job) => String(job.releaseId || '')).filter(Boolean))]
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const runReleases = runReleaseIds.length
      ? await db.collection('releases').find({ _id: { $in: runReleaseIds } }).toArray()
      : [];
    const releaseMap = new Map(runReleases.map((item) => [String(item._id), item]));
    const lastSuccessful = runs.find((job) => canonicalState(job.state) === 'SUCCEEDED') || null;
    const latestRelease = availableReleases.reduce(
      (latest, candidate) => (isNewerRelease(candidate, latest) ? candidate : latest),
      null,
    );
    const currentReleaseBaseline = release || (site.currentVersion
      ? { version: site.currentVersion, createdAt: site.lastPublishedAt || site.updatedAt }
      : null);

    return res.json({
      ...payload,
      plan,
      activeRun: active,
      currentRelease: release ? {
        id: String(release._id),
        version: release.version,
        notes: release.notes || '',
        buildId: release.buildId || release.universalProof?.buildId || '',
        createdAt: release.createdAt,
        deployedAt: site.lastPublishedAt,
      } : null,
      latestAvailableRelease: isNewerRelease(latestRelease, currentReleaseBaseline) ? {
        id: String(latestRelease._id),
        version: latestRelease.version,
        buildId: latestRelease.buildId || latestRelease.universalProof?.buildId || '',
        createdAt: latestRelease.createdAt,
      } : null,
      lastSuccessfulRun: lastSuccessful ? {
        id: String(lastSuccessful._id),
        finishedAt: lastSuccessful.finishedAt,
        finalUrl: lastSuccessful.finalUrl || payload.finalUrl,
      } : null,
      runs: runs.map((job) => ({
        release: releaseMap.has(String(job.releaseId)) ? {
          id: String(job.releaseId),
          version: releaseMap.get(String(job.releaseId)).version,
          buildId: releaseMap.get(String(job.releaseId)).buildId || releaseMap.get(String(job.releaseId)).universalProof?.buildId || '',
        } : null,
        id: String(job._id),
        targetKey: job.targetKey || payload.targetKey || '',
        state: canonicalState(job.state),
        stateLabel: stateLabel(job.state),
        type: job.type,
        progress: job.progress || 0,
        error: job.error || '',
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        finalUrl: job.finalUrl || payload.finalUrl,
      })),
      backups: backups.map((backup) => publicBackup(backup, site)),
    });
  } catch (error) {
    return next(error);
  }
});

sitesRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const { mode = 'existing', unit, name, managerName, currentVersion, firstPublishedAt, lastPublishedAt, releaseId } = body;
    if (!unit || !name || !managerName) return res.status(400).json({ error: 'יחידה, שם האתר ומנהל האתר הם שדות חובה.' });

    const identity = resolveIdentity(body);
    const now = new Date();
    const document = {
      mode: mode === 'install' ? 'install' : 'existing',
      unit: String(unit).trim(),
      name: String(name).trim(),
      managerName: String(managerName).trim(),
      host: identity.host,
      siteCode: identity.siteCode,
      storageType: identity.storageBackend,
      storageBackend: identity.storageBackend,
      siteDbFolder: identity.siteDbFolder,
      usersDbFolder: identity.usersDbFolder,
      siteAssetsFolder: identity.siteAssetsFolder,
      imagesFolder: identity.imagesFolder,
      widgetsDbTarget: identity.widgetsDbTarget,
      bootstrapLibrary: identity.bootstrapLibrary,
      bootstrapFolder: identity.bootstrapFolder,
      targetKey: canonicalTargetKey(identity),
      status: mode === 'install' ? 'DRAFT' : 'TRACKED',
      currentVersion: currentVersion ? String(currentVersion).trim() : null,
      currentReleaseId: null,
      firstPublishedAt: toDateOrNull(firstPublishedAt),
      lastPublishedAt: toDateOrNull(lastPublishedAt),
      finalUrl: identity.finalAppUrl,
      activeJobId: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await getDb().collection('sites').insertOne(document);
    let job = null;
    if (mode === 'install' && releaseId) {
      job = await createDeploymentJob({ siteId: result.insertedId, releaseId, type: 'INSTALL' });
    }
    return res.status(201).json({ site: publicSite({ ...document, _id: result.insertedId }), job, boundary: PROVISIONING_BOUNDARY });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'קיים כבר אתר שמצביע לאותו יעד פיזי: Host, siteCode, ספריית אתר וספריית משתמשים זהים.' });
    if (error instanceof SiteIdentityError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

sitesRouter.patch('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'האתר לא נמצא.' });
    const objectId = new ObjectId(req.params.id);
    const existing = await db.collection('sites').findOne({ _id: objectId });
    if (!existing) return res.status(404).json({ error: 'האתר לא נמצא.' });

    const body = req.body || {};
    const merged = {
      host: 'host' in body ? body.host : existing.host,
      siteCode: 'siteCode' in body ? body.siteCode : existing.siteCode,
      siteDbFolder: 'siteDbFolder' in body ? body.siteDbFolder : existing.siteDbFolder,
      usersDbFolder: 'usersDbFolder' in body ? body.usersDbFolder : existing.usersDbFolder,
      siteAssetsFolder: 'siteAssetsFolder' in body ? body.siteAssetsFolder : existing.siteAssetsFolder,
      imagesFolder: 'imagesFolder' in body ? body.imagesFolder : existing.imagesFolder,
      widgetsDbTarget: 'widgetsDbTarget' in body ? body.widgetsDbTarget : existing.widgetsDbTarget,
      bootstrapLibrary: 'bootstrapLibrary' in body ? body.bootstrapLibrary : existing.bootstrapLibrary,
      bootstrapFolder: 'bootstrapFolder' in body ? body.bootstrapFolder : existing.bootstrapFolder,
      storageBackend: existing.storageBackend || 'txt',
    };
    const identity = resolveIdentity(merged);
    let previousIdentity = null;
    try { previousIdentity = buildSiteIdentity(existing); } catch { /* Invalid legacy records remain repairable. */ }
    const previousTargetKey = existing.targetKey || (previousIdentity ? canonicalTargetKey(previousIdentity) : '');
    const changesIdentity = identityChanged(previousIdentity, identity);

    const metadataPatch = { updatedAt: new Date() };
    for (const key of ['unit', 'name', 'managerName', 'currentVersion']) {
      if (key in body) metadataPatch[key] = String(body[key] ?? '').trim() || (key === 'currentVersion' ? null : '');
    }
    for (const key of ['firstPublishedAt', 'lastPublishedAt']) {
      if (key in body) metadataPatch[key] = toDateOrNull(body[key]);
    }

    const patch = {
      host: identity.host,
      siteCode: identity.siteCode,
      siteDbFolder: identity.siteDbFolder,
      usersDbFolder: identity.usersDbFolder,
      siteAssetsFolder: identity.siteAssetsFolder,
      imagesFolder: identity.imagesFolder,
      widgetsDbTarget: identity.widgetsDbTarget,
      bootstrapLibrary: identity.bootstrapLibrary,
      bootstrapFolder: identity.bootstrapFolder,
      // Derived values are never editable on their own; they always follow identity.
      targetKey: canonicalTargetKey(identity),
      finalUrl: identity.finalAppUrl,
      ...metadataPatch,
    };

    if (!changesIdentity) {
      const result = await db.collection('sites').findOneAndUpdate(
        { _id: objectId },
        { $set: metadataPatch },
        { returnDocument: 'after' },
      );
      return res.json(publicSite(result));
    }

    // Coordinate with createDeploymentJob in both directions. The edit guard
    // closes the gap between checking the target lock and changing targetKey;
    // the job creator re-reads the guarded Site after taking its lock.
    const editToken = new ObjectId().toString();
    const staleBefore = new Date(Date.now() - SITE_IDENTITY_EDIT_TTL_MS);
    const guarded = await db.collection('sites').findOneAndUpdate(
      {
        _id: objectId,
        $or: [
          { identityEdit: { $exists: false } },
          { identityEdit: null },
          { 'identityEdit.acquiredAt': { $lt: staleBefore } },
        ],
      },
      { $set: { identityEdit: { token: editToken, acquiredAt: new Date() } } },
      { returnDocument: 'after' },
    );
    if (!guarded) {
      return res.status(409).json({
        error: 'שינוי אחר של זהות היעד כבר מתבצע. נסה שוב בעוד רגע.',
        code: 'SITE_IDENTITY_EDIT_IN_PROGRESS',
      });
    }

    try {
      const owner = previousTargetKey ? await findActiveJobForTarget(previousTargetKey) : null;
      if (owner) {
        return res.status(409).json({
          error: 'לא ניתן לשנות את זהות היעד בזמן שריצת פריסה פעילה. עדיין ניתן לערוך שם, יחידה ומנהל.',
          code: 'TARGET_LOCKED',
          activeJobId: String(owner.job._id),
        });
      }
      const result = await db.collection('sites').findOneAndUpdate(
        { _id: objectId, 'identityEdit.token': editToken },
        { $set: patch, $unset: { identityEdit: '' } },
        { returnDocument: 'after' },
      );
      if (!result) {
        return res.status(409).json({
          error: 'זהות היעד השתנתה במקביל. טען מחדש ונסה שוב.',
          code: 'SITE_IDENTITY_EDIT_CONFLICT',
        });
      }
      return res.json(publicSite(result));
    } finally {
      await db.collection('sites').updateOne(
        { _id: objectId, 'identityEdit.token': editToken },
        { $unset: { identityEdit: '' } },
      );
    }
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'קיים כבר אתר שמצביע לאותו יעד פיזי: Host, siteCode, ספריית אתר וספריית משתמשים זהים.' });
    if (error instanceof SiteIdentityError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

/**
 * Delete the Release Manager tracking record ONLY.
 * SharePoint libraries, folders and TXT data are deliberately untouched.
 */
sitesRouter.delete('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'האתר לא נמצא.' });
    const objectId = new ObjectId(req.params.id);
    const site = await db.collection('sites').findOne({ _id: objectId });
    if (!site) return res.status(404).json({ error: 'האתר לא נמצא.' });

    const owner = site.targetKey ? await findActiveJobForTarget(site.targetKey) : null;
    if (owner) {
      return res.status(409).json({
        error: 'לא ניתן למחוק אתר בזמן שריצת פריסה פעילה.',
        code: 'TARGET_LOCKED',
        activeJobId: String(owner.job._id),
      });
    }
    if (String(req.query.confirm || req.body?.confirm || '') !== 'delete-tracking-record') {
      return res.status(400).json({
        error: 'נדרש אישור מפורש למחיקת רשומת המעקב.',
        code: 'CONFIRMATION_REQUIRED',
        confirmWith: 'delete-tracking-record',
        note: 'המחיקה מסירה את רשומת המעקב ב-Release Manager בלבד ואינה מוחקת ספריות, תיקיות או נתוני TXT ב-SharePoint.',
      });
    }

    await db.collection('sites').deleteOne({ _id: objectId });
    return res.json({
      ok: true,
      deletedSharePointData: false,
      preservedRunHistory: true,
      preservedBackupMetadata: true,
    });
  } catch (error) {
    return next(error);
  }
});

sitesRouter.post('/:id/deploy', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'האתר לא נמצא.' });
    const site = await getDb().collection('sites').findOne({ _id: new ObjectId(req.params.id) });
    if (!site) return res.status(404).json({ error: 'האתר לא נמצא.' });
    if (!req.body?.releaseId) return res.status(400).json({ error: 'יש לבחור ריליס.' });

    const job = await createDeploymentJob({
      siteId: site._id,
      releaseId: req.body.releaseId,
      type: site.firstPublishedAt ? 'UPDATE' : 'INSTALL',
      force: req.body?.force === true,
    });
    return res.status(202).json({ ...job, id: String(job._id), _id: undefined });
  } catch (error) {
    if (error instanceof TargetLockedError) {
      // History never blocks a deployment; only a live owner does, and the UI is
      // told exactly what it may offer the user.
      return res.status(409).json({
        error: error.message,
        code: error.code,
        activeJobId: error.activeJobId,
        activeJobState: error.activeJobState || '',
        stale: error.stale,
        resumable: Boolean(error.resumable),
        canForce: true,
        actions: ['open', 'supersede', 'cancel'],
      });
    }
    if (error instanceof SiteIdentityError) return res.status(400).json({ error: error.message });
    return next(error);
  }
});
