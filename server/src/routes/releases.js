import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import { paths, config } from '../config.js';
import { getDb } from '../db.js';
import {
  collectFiles,
  copyDistWithoutDeploymentOverlay,
  directoryStats,
  distExclusionReason,
  ensureDirectory,
  extractReleaseZip,
  findDistRoot,
  hashDirectory,
  isSafeRelativePath,
  normalizeRelativePath,
  removeDirectory,
  safeResolve,
} from '../utils/files.js';
import { nextReleaseVersions, parseReleaseVersion } from '../utils/versioning.js';

class ReleaseValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseValidationError';
    this.statusCode = 400;
  }
}

ensureDirectory(paths.temp);

const zipUpload = multer({
  dest: paths.temp,
  limits: { fileSize: config.maxReleaseBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!/\.zip$/i.test(file.originalname)) {
      return callback(new ReleaseValidationError('יש להעלות ZIP שמכיל את תיקיית dist בלבד.'));
    }
    return callback(null, true);
  },
});

const folderUpload = multer({
  dest: paths.temp,
  limits: {
    fileSize: config.maxReleaseBytes,
    files: config.maxReleaseFiles,
    fields: 20,
    fieldSize: 8 * 1024 * 1024,
  },
});

export const releasesRouter = Router();

const UNIVERSAL_TEXT_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg', '.xml', '.webmanifest']);

const SOURCE_MANIFEST_FILE = 'sharepoint-deploy-manifest.json';

function readUniversalBuildProof(distDir, sourceName = '') {
  const manifestPath = path.join(distDir, SOURCE_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { verified: false, reason: 'source-manifest-missing', file: null, buildId: null };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const mode = String(
      manifest.buildMode
      || manifest.mode
      || manifest.artifactMode
      || manifest.buildKind
      || manifest.build?.mode
      || manifest.build?.buildMode
      || '',
    ).trim().toLowerCase();
    const artifactKind = String(manifest.artifactKind || manifest.kind || '').trim().toLowerCase();
    const requiresRuntimeConfig = manifest.requiresRuntimeConfig === true
      || manifest.runtime?.required === true
      || manifest.runtimeConfigRequired === true;
    const sourceLooksUniversal = /dist[-_]?universal/i.test(String(sourceName || ''));
    const explicitUniversal = mode === 'universal'
      || mode === 'universal-production'
      || artifactKind.includes('universal');
    const compatibleUniversalManifest = requiresRuntimeConfig
      && !mode.includes('legacy')
      && (artifactKind.includes('sitebuilder') || artifactKind.includes('site-builder') || artifactKind.includes('frontend') || artifactKind.includes('release-manifest'));
    const structurallyValid = Array.isArray(manifest.files) && manifest.files.length > 0;
    const verified = structurallyValid && (explicitUniversal || compatibleUniversalManifest || sourceLooksUniversal);
    return {
      verified,
      reason: verified ? 'source-universal-manifest' : 'source-manifest-not-universal',
      file: SOURCE_MANIFEST_FILE,
      buildId: manifest.buildId || manifest.build?.id || manifest.releaseBuildId || null,
      mode: mode || null,
      artifactKind: artifactKind || null,
      requiresRuntimeConfig,
      fileCount: manifest.files.length,
    };
  } catch (error) {
    return { verified: false, reason: `source-manifest-invalid:${error.message}`, file: SOURCE_MANIFEST_FILE, buildId: null };
  }
}

function findCompiledSiteIdentity(distDir) {
  const hits = [];
  const patterns = [
    /\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/dist/ig,
    /https?:\/\/[a-z0-9.-]+\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/dist/ig,
  ];
  for (const file of collectFiles(distDir)) {
    if (!UNIVERSAL_TEXT_EXTENSIONS.has(path.extname(file.path).toLowerCase())) continue;
    const filePath = path.join(distDir, ...file.path.split('/'));
    let text = '';
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    for (const regex of patterns) {
      regex.lastIndex = 0;
      const match = regex.exec(text);
      if (match) hits.push({ file: file.path, match: match[0] });
      if (hits.length >= 8) return hits;
    }
  }
  return hits;
}

const publicRelease = (release) => ({
  ...release,
  id: String(release._id),
  _id: undefined,
  releaseRoot: undefined,
  distDir: undefined,
});

function validateUniversalDist(distDir, { sourceName = '' } = {}) {
  const indexPath = path.join(distDir, 'index.html');
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(indexPath)) throw new ReleaseValidationError('חסר dist/index.html.');
  if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) {
    throw new ReleaseValidationError('חסרה תיקיית dist/assets.');
  }
  const files = collectFiles(distDir);
  if (!files.some((file) => /^assets\/.*\.js$/i.test(file.path))) {
    throw new ReleaseValidationError('לא נמצא JavaScript build תחת dist/assets.');
  }
  if (files.some((file) => file.path === 'sitebuilder-runtime-config.json')) {
    throw new ReleaseValidationError('ה-dist מכיל sitebuilder-runtime-config.json. ריליס אוניברסלי חייב להגיע ללא Runtime Config פר-אתר.');
  }

  const proof = readUniversalBuildProof(distDir, sourceName);
  const identityHits = findCompiledSiteIdentity(distDir);
  if (identityHits.length && !proof.verified) {
    throw new ReleaseValidationError(`ה-dist אינו אוניברסלי: נמצאה זהות SharePoint צרובה (${identityHits.map((hit) => `${hit.file} -> ${hit.match}`).join(' | ')}). הרץ npm run build:universal מחדש והעלה את dist-universal החדש.`);
  }

  return {
    files,
    proof,
    identityHits,
    warnings: identityHits.length
      ? [`נמצאו ${identityHits.length} מחרוזות SharePoint בתוך bundle, אך ה-artifact אומת באמצעות manifest של build:universal. המחרוזות נשמרו לאבחון ואינן חוסמות את הריליס.`]
      : [],
  };
}
async function ensureUniqueVersion(version, excludeId = null) {
  const query = { version };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await getDb().collection('releases').findOne(query);
  if (existing) throw Object.assign(new Error('ריליס עם מספר הגרסה הזה כבר קיים.'), { statusCode: 409 });
}

function baseReleaseDocument({ releaseId, releaseRoot, distDir, version, notes, uploadType, originalFileName }) {
  const validation = validateUniversalDist(distDir, { sourceName: originalFileName });
  const stats = directoryStats(distDir);
  return {
    _id: releaseId,
    version,
    notes,
    status: 'READY',
    artifactType: 'universal-dist',
    uploadType,
    originalFileName,
    releaseRoot,
    distDir,
    sha256: hashDirectory(distDir),
    fileCount: stats.fileCount,
    totalBytes: stats.totalBytes,
    universalProof: validation.proof,
    validationWarnings: validation.warnings,
    identityDiagnostics: validation.identityHits,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
function parseUploadedPaths(raw, expectedCount) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || '[]'));
  } catch {
    throw new ReleaseValidationError('רשימת נתיבי ה-dist אינה תקינה.');
  }
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) {
    throw new ReleaseValidationError('מספר הקבצים אינו תואם לרשימת הנתיבים שהתקבלה. בחר את dist מחדש.');
  }
  return parsed.map((value) => normalizeRelativePath(value));
}

function cleanupTempFiles(files = []) {
  for (const file of files) {
    if (file?.path && fs.existsSync(file.path)) fs.rmSync(file.path, { force: true });
  }
}

releasesRouter.get('/', async (_req, res, next) => {
  try {
    const releases = await getDb().collection('releases').find({}).sort({ createdAt: -1 }).toArray();
    res.json(releases.map(publicRelease));
  } catch (error) {
    next(error);
  }
});

releasesRouter.get('/version-suggestions', async (_req, res, next) => {
  try {
    const releases = await getDb().collection('releases').find({}).sort({ createdAt: -1 }).toArray();
    const latest = releases[0] || null;
    const semanticBase = releases.find((release) => parseReleaseVersion(release.version)) || null;
    const suggestions = nextReleaseVersions(semanticBase?.version || '');
    return res.json({
      latestVersion: latest?.version || null,
      baseVersion: semanticBase?.version || null,
      ...suggestions,
    });
  } catch (error) {
    return next(error);
  }
});

releasesRouter.post('/upload-folder', folderUpload.array('files', config.maxReleaseFiles), async (req, res, next) => {
  let releaseRoot;
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) return res.status(400).json({ error: 'לא התקבלו קבצים מתיקיית dist.' });

    const version = String(req.body?.version || '').trim();
    const notes = String(req.body?.notes || '').trim();
    const rootName = String(req.body?.rootName || 'dist').trim().slice(0, 180);
    if (!version) return res.status(400).json({ error: 'מספר גרסה הוא שדה חובה.' });
    await ensureUniqueVersion(version);

    const relativePaths = parseUploadedPaths(req.body?.paths, files.length);
    const releaseId = new ObjectId();
    releaseRoot = path.join(paths.releases, String(releaseId));
    const distDir = path.join(releaseRoot, 'dist');
    ensureDirectory(distDir);

    let includedBytes = 0;
    let includedCount = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const relativePath = relativePaths[index];
      if (!isSafeRelativePath(relativePath)) throw new ReleaseValidationError(`נתיב קובץ אינו תקין: ${relativePath}`);
      if (distExclusionReason(relativePath)) {
        fs.rmSync(file.path, { force: true });
        continue;
      }
      includedBytes += Number(file.size || 0);
      if (includedBytes > config.maxReleaseBytes) {
        throw new ReleaseValidationError(`גודל ה-dist חורג מהמגבלה (${Math.round(config.maxReleaseBytes / 1024 / 1024)}MB).`);
      }
      const target = safeResolve(distDir, relativePath);
      ensureDirectory(path.dirname(target));
      fs.renameSync(file.path, target);
      includedCount += 1;
    }
    cleanupTempFiles(files);
    if (!includedCount) throw new ReleaseValidationError('לא נשארו קבצי dist להעלאה.');

    const document = baseReleaseDocument({ releaseId, releaseRoot, distDir, version, notes, uploadType: 'folder', originalFileName: rootName || 'dist' });
    await getDb().collection('releases').insertOne(document);
    return res.status(201).json(publicRelease(document));
  } catch (error) {
    cleanupTempFiles(req.files);
    if (releaseRoot) removeDirectory(releaseRoot);
    if (error?.code === 11000) return res.status(409).json({ error: 'ריליס עם מספר הגרסה הזה כבר קיים.' });
    return next(error);
  }
});

releasesRouter.post('/upload', zipUpload.single('file'), async (req, res, next) => {
  let releaseRoot;
  try {
    if (!req.file) return res.status(400).json({ error: 'יש לבחור ZIP של dist.' });
    const version = String(req.body?.version || '').trim();
    const notes = String(req.body?.notes || '').trim();
    if (!version) return res.status(400).json({ error: 'מספר גרסה הוא שדה חובה.' });
    await ensureUniqueVersion(version);

    const releaseId = new ObjectId();
    releaseRoot = path.join(paths.releases, String(releaseId));
    const extractedRoot = path.join(releaseRoot, 'incoming');
    const distDir = path.join(releaseRoot, 'dist');
    ensureDirectory(releaseRoot);

    const sourceZipPath = path.join(releaseRoot, 'dist.zip');
    fs.renameSync(req.file.path, sourceZipPath);
    try {
      extractReleaseZip(sourceZipPath, extractedRoot);
      const discoveredDist = findDistRoot(extractedRoot);
      copyDistWithoutDeploymentOverlay(discoveredDist, distDir);
    } catch (error) {
      throw new ReleaseValidationError(`לא ניתן לקרוא את ה-ZIP כ-dist: ${error.message}`);
    }
    fs.rmSync(extractedRoot, { recursive: true, force: true });
    fs.rmSync(sourceZipPath, { force: true });

    const document = baseReleaseDocument({ releaseId, releaseRoot, distDir, version, notes, uploadType: 'zip', originalFileName: req.file.originalname });
    await getDb().collection('releases').insertOne(document);
    return res.status(201).json(publicRelease(document));
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.rmSync(req.file.path, { force: true });
    if (releaseRoot) removeDirectory(releaseRoot);
    if (error?.code === 11000) return res.status(409).json({ error: 'ריליס עם מספר הגרסה הזה כבר קיים.' });
    return next(error);
  }
});

releasesRouter.patch('/:id', async (req, res, next) => {
  try {
    const releaseId = new ObjectId(req.params.id);
    const db = getDb();
    const release = await db.collection('releases').findOne({ _id: releaseId });
    if (!release) return res.status(404).json({ error: 'הריליס לא נמצא.' });

    const version = String(req.body?.version ?? release.version).trim();
    const notes = String(req.body?.notes ?? release.notes ?? '').trim();
    if (!version) return res.status(400).json({ error: 'מספר גרסה הוא שדה חובה.' });
    await ensureUniqueVersion(version, releaseId);

    const versionChanged = version !== release.version;
    const now = new Date();
    await db.collection('releases').updateOne(
      { _id: releaseId },
      { $set: { version, notes, updatedAt: now } },
    );

    if (versionChanged) {
      await db.collection('sites').updateMany(
        { currentReleaseId: releaseId },
        { $set: { currentVersion: version, updatedAt: now } },
      );

      const activeJobs = await db.collection('deployment_jobs').find({
        releaseId,
        state: { $in: ['PREPARING_RELEASE', 'READY_FOR_SHAREPOINT', 'DEPLOYING'] },
      }).toArray();
      if (activeJobs.length) {
        const activeIds = activeJobs.map((job) => job._id);
        await db.collection('deployment_jobs').updateMany(
          { _id: { $in: activeIds } },
          {
            $set: {
              state: 'INTERRUPTED',
              progress: 100,
              message: 'המשימה הופסקה כי מספר גרסת הריליס נערך. יש להריץ את הפריסה מחדש.',
              error: null,
              finishedAt: now,
              updatedAt: now,
            },
            $push: { logs: `[${now.toISOString()}] Release version changed from ${release.version} to ${version}; deployment must be prepared again.` },
          },
        );
        for (const job of activeJobs) {
          const site = await db.collection('sites').findOne({ _id: job.siteId });
          if (!site) continue;
          await db.collection('sites').updateOne(
            { _id: site._id, activeJobId: job._id },
            { $set: { activeJobId: null, status: site.firstPublishedAt ? 'ACTIVE' : 'TRACKED', updatedAt: now } },
          );
        }
      }
    }

    const updated = await db.collection('releases').findOne({ _id: releaseId });
    return res.json(publicRelease(updated));
  } catch (error) {
    return next(error);
  }
});

releasesRouter.delete('/:id', async (req, res, next) => {
  try {
    const release = await getDb().collection('releases').findOne({ _id: new ObjectId(req.params.id) });
    if (!release) return res.status(404).json({ error: 'הריליס לא נמצא.' });
    const inUse = await getDb().collection('sites').countDocuments({ currentReleaseId: release._id });
    if (inUse > 0) return res.status(409).json({ error: 'לא ניתן למחוק ריליס שמותקן כרגע באתר.' });
    await getDb().collection('releases').deleteOne({ _id: release._id });
    removeDirectory(release.releaseRoot || (release.distDir ? path.dirname(release.distDir) : ''));
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});
