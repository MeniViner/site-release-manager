import fs from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { config, paths } from '../config.js';
import { getDb } from '../db.js';
import { collectFiles, ensureDirectory, hashFile, removeDirectory } from '../utils/files.js';
import { appendRunEvent, RUN_STAGES } from './runTelemetry.js';

const OVERLAY_NAMES = [
  'sitebuilder-runtime-config.json',
  'sitebuilder-deployment.json',
  'sharepoint-deploy-manifest.json',
];

const UNIVERSAL_SCAN_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg', '.xml', '.webmanifest']);

function findUniversalIdentityLeaks(distDir) {
  const hits = [];
  const patterns = [
    /\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/dist/ig,
    /https?:\/\/[a-z0-9.-]+\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/dist/ig,
  ];
  for (const file of collectFiles(distDir)) {
    if (!UNIVERSAL_SCAN_EXTENSIONS.has(path.extname(file.path).toLowerCase())) continue;
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

function deploymentLog(jobId, message) {
  const line = `[${new Date().toISOString()}] [prepare] ${message}`;
  console.log(`[job ${jobId}] ${line}`);
  return line;
}

export function buildSiteRuntime(site, release, jobId, deployedAt) {
  const siteRoot = `/sites/${site.siteCode}`;
  const siteDbFolder = String(site.siteDbFolder || 'siteDB').trim();
  const usersDbFolder = String(site.usersDbFolder || 'siteUsersDb').trim();
  const siteAssetsFolder = String(site.siteAssetsFolder || 'siteAssets').trim();
  const imagesFolder = String(site.imagesFolder || 'images').trim();
  const widgetsDbTarget = String(site.widgetsDbTarget || 'users').trim().toLowerCase() === 'site' ? 'site' : 'users';
  const siteDbRoot = `${siteRoot}/${siteDbFolder}`;
  const usersDbRoot = `${siteRoot}/${usersDbFolder}`;
  const siteAssetsRoot = `${siteDbRoot}/${siteAssetsFolder}`;
  const imagesRoot = `${siteDbRoot}/${imagesFolder}`;
  const targetDistPath = `${siteDbRoot}/dist`;
  const sharePointSiteUrl = `https://${site.host}${siteRoot}`;
  return {
    schemaVersion: 2,
    storageBackend: 'txt',
    host: site.host,
    siteCode: site.siteCode,
    siteId: site.siteCode,
    siteDbFolder,
    usersDbFolder,
    siteAssetsFolder,
    imagesFolder,
    widgetsDbTarget,
    bootstrapLibrary: 'SiteAssets',
    bootstrapFolder: 'sitebuilder-bootstrap',
    siteRoot,
    siteApiRoot: siteRoot,
    siteDbRoot,
    usersDbRoot,
    siteAssetsRoot,
    imagesRoot,
    sharePointSiteUrl,
    allowedSiteRoot: sharePointSiteUrl,
    targetDistPath,
    finalAppUrl: `${sharePointSiteUrl}/${siteDbFolder}/dist/index.html`,
    releaseVersion: release.version,
    releaseId: String(release._id),
    deployedAt,
    deploymentGeneratedBy: 'site-release-manager',
    deploymentJobId: jobId,
  };
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function fileInfo(root, name) {
  const filePath = path.join(root, name);
  return { path: name, size: fs.statSync(filePath).size, sha256: hashFile(filePath), source: 'overlay' };
}

export async function prepareDeploymentJob(jobId) {
  const db = getDb();
  const objectId = new ObjectId(jobId);
  const job = await db.collection('deployment_jobs').findOne({ _id: objectId });
  if (!job) throw new Error('Job not found.');
  const [site, release] = await Promise.all([
    db.collection('sites').findOne({ _id: job.siteId }),
    db.collection('releases').findOne({ _id: job.releaseId }),
  ]);
  if (!site || !release) throw new Error('Site or release not found.');
  if (release.artifactType !== 'universal-dist' || !release.distDir || !fs.existsSync(release.distDir)) {
    throw new Error('הריליס אינו Universal dist תקין. העלה מחדש את תיקיית dist שנבנתה לאחר מעבר Site Builder ל-Runtime Config.');
  }
  const identityLeaks = findUniversalIdentityLeaks(release.distDir);
  const manifestVerified = release.universalProof?.verified === true;
  if (identityLeaks.length && !manifestVerified) {
    throw new Error(`הריליס אינו Universal dist נקי: נמצאו נתיבי SharePoint צרובים ללא הוכחת manifest של build:universal (${identityLeaks.map((hit) => `${hit.file} -> ${hit.match}`).join(' | ')}). צור npm run build:universal חדש והעלה את dist-universal.`);
  }
  if (identityLeaks.length && manifestVerified) {
    console.warn(`[job ${jobId}] Universal manifest verified; preserving ${identityLeaks.length} SharePoint-like bundle string(s) as diagnostics only.`);
  }
  await appendRunEvent(objectId, {
    stage: RUN_STAGES.RELEASE_VALIDATED,
    status: 'success',
    source: 'server',
    message: `Universal dist ${release.version} נמצא ותקין להכנת פריסה.`,
    details: { releaseSha256: release.sha256, distDir: release.distDir },
  });

  const buildRoot = path.join(paths.builds, jobId);
  const overlayDir = path.join(buildRoot, 'overlay');
  removeDirectory(buildRoot);
  ensureDirectory(overlayDir);
  const now = new Date();
  const deployedAt = now.toISOString();
  const prepareLogs = [
    deploymentLog(jobId, `START universal-dist preparation | release=${release.version} | site=${site.host}/sites/${site.siteCode}`),
    deploymentLog(jobId, `releaseDist=${release.distDir}`),
    deploymentLog(jobId, `releaseSha256=${release.sha256}`),
  ];

  await db.collection('deployment_jobs').updateOne(
    { _id: objectId },
    { $set: { state: 'PREPARING_RELEASE', progress: 25, buildRoot, overlayDir, updatedAt: now } },
  );

  const runtimeConfig = buildSiteRuntime(site, release, jobId, deployedAt);
  writeJson(path.join(overlayDir, 'sitebuilder-runtime-config.json'), runtimeConfig);
  await appendRunEvent(objectId, {
    stage: RUN_STAGES.RUNTIME_CONFIG,
    status: 'success',
    source: 'server',
    message: 'Runtime Config פר-אתר נוצר ונגזר מהיעד.',
    details: { host: runtimeConfig.host, siteCode: runtimeConfig.siteCode, siteRoot: runtimeConfig.siteRoot, targetDistPath: runtimeConfig.targetDistPath, finalAppUrl: runtimeConfig.finalAppUrl },
  });
  prepareLogs.push(deploymentLog(jobId, `runtime host=${runtimeConfig.host} siteCode=${runtimeConfig.siteCode} siteRoot=${runtimeConfig.siteRoot}`));
  prepareLogs.push(deploymentLog(jobId, `runtime siteDbRoot=${runtimeConfig.siteDbRoot} usersDbRoot=${runtimeConfig.usersDbRoot} siteAssetsRoot=${runtimeConfig.siteAssetsRoot}`));
  prepareLogs.push(deploymentLog(jobId, `runtime imagesRoot=${runtimeConfig.imagesRoot} targetDistPath=${runtimeConfig.targetDistPath}`));
  prepareLogs.push(deploymentLog(jobId, `runtime finalAppUrl=${runtimeConfig.finalAppUrl}`));

  const deploymentMetadata = {
    kind: 'sitebuilder-deployment',
    schemaVersion: 2,
    generatedBy: 'site-release-manager',
    jobId,
    releaseId: String(release._id),
    releaseVersion: release.version,
    releaseSha256: release.sha256,
    siteCode: site.siteCode,
    host: site.host,
    storageBackend: 'txt',
    deployedAt,
    targetDistPath: runtimeConfig.targetDistPath,
    finalAppUrl: runtimeConfig.finalAppUrl,
  };
  writeJson(path.join(overlayDir, 'sitebuilder-deployment.json'), deploymentMetadata);

  const staticFiles = collectFiles(release.distDir)
    .filter((file) => !OVERLAY_NAMES.includes(file.path))
    .map((file) => ({ ...file, source: 'release' }));
  if (!staticFiles.some((file) => file.path === 'index.html')) throw new Error('Release dist is missing index.html.');
  if (!staticFiles.some((file) => /^assets\/.*\.js$/i.test(file.path))) throw new Error('Release dist contains no JavaScript asset.');
  const totalStaticBytes = staticFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
  prepareLogs.push(deploymentLog(jobId, `universal dist files=${staticFiles.length} bytes=${totalStaticBytes}`));

  const preManifestOverlays = [
    fileInfo(overlayDir, 'sitebuilder-runtime-config.json'),
    fileInfo(overlayDir, 'sitebuilder-deployment.json'),
  ];
  const manifestPayload = {
    kind: 'sitebuilder-release-manifest',
    schemaVersion: 2,
    artifactKind: 'site-builder-frontend',
    storageCompatibility: ['txt'],
    releaseId: String(release._id),
    releaseVersion: release.version,
    releaseSha256: release.sha256,
    site: { host: site.host, siteCode: site.siteCode },
    files: [...staticFiles, ...preManifestOverlays].map(({ path: filePath, size, sha256 }) => ({ path: filePath, size, sha256 })),
  };
  writeJson(path.join(overlayDir, 'sharepoint-deploy-manifest.json'), manifestPayload);
  const overlays = [...preManifestOverlays, fileInfo(overlayDir, 'sharepoint-deploy-manifest.json')];
  const files = [...staticFiles, ...overlays].sort((a, b) => a.path.localeCompare(b.path));
  const normalFiles = files.filter((file) => file.path !== 'index.html');
  const uploadOrder = [...normalFiles.map((file) => file.path), 'index.html'];

  const artifactManifest = {
    kind: 'site-release-manager-artifact',
    schemaVersion: 2,
    jobId,
    release: { id: String(release._id), version: release.version, sha256: release.sha256 },
    site: {
      host: site.host,
      siteCode: site.siteCode,
      siteRoot: runtimeConfig.siteRoot,
      siteDbRoot: runtimeConfig.siteDbRoot,
      usersDbRoot: runtimeConfig.usersDbRoot,
      finalDistRoot: runtimeConfig.targetDistPath,
      finalUrl: runtimeConfig.finalAppUrl,
    },
    files,
    uploadOrder,
  };
  const manifestPath = path.join(buildRoot, 'artifact-manifest.json');
  writeJson(manifestPath, artifactManifest);
  await appendRunEvent(objectId, {
    stage: RUN_STAGES.MANIFEST,
    status: 'success',
    source: 'server',
    message: `Manifest וסדר העלאה נוצרו עבור ${files.length} קבצים.`,
    details: { fileCount: files.length, uploadOrderCount: uploadOrder.length, firstFile: uploadOrder[0] || '', lastFile: uploadOrder.at(-1) || '' },
  });

  const deployerUrl = `https://${site.host}${config.sharePointDeployerPath}?jobId=${encodeURIComponent(jobId)}&apiBase=${encodeURIComponent(config.publicApiUrl)}`;
  prepareLogs.push(deploymentLog(jobId, `artifact files=${files.length} uploadOrder=${uploadOrder.length} first=${uploadOrder[0] || '—'} last=${uploadOrder.at(-1) || '—'}`));
  prepareLogs.push(deploymentLog(jobId, `overlays=${OVERLAY_NAMES.join(',')}`));
  prepareLogs.push(deploymentLog(jobId, `deployerUrl=${deployerUrl}`));
  prepareLogs.push(deploymentLog(jobId, 'READY_FOR_SHAREPOINT'));
  await appendRunEvent(objectId, {
    stage: RUN_STAGES.READY_FOR_SHAREPOINT,
    status: 'success',
    source: 'server',
    message: 'כל קבצי הפריסה מוכנים; אפשר לפתוח את SharePoint Deployer.',
    details: { deployerUrl, manifestPath },
  });
  await db.collection('deployment_jobs').updateOne(
    { _id: objectId },
    {
      $set: {
        state: 'READY_FOR_SHAREPOINT',
        progress: 40,
        manifestPath,
        deployerUrl,
        message: 'צד השרת מוכן. ממתין למנוע הפריסה בדפדפן SharePoint.',
        updatedAt: new Date(),
      },
      $push: { logs: { $each: prepareLogs, $slice: -500 } },
    },
  );
  await db.collection('sites').updateOne(
    { _id: site._id },
    { $set: { status: 'READY_FOR_SHAREPOINT', activeJobId: objectId, updatedAt: new Date() } },
  );
}

export function resolveDeploymentFile(job, release, relativePath) {
  if (OVERLAY_NAMES.includes(relativePath)) return path.join(job.overlayDir, relativePath);
  return path.join(release.distDir, ...relativePath.split('/'));
}
