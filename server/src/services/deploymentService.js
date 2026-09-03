/**
 * Server-side deployment preparation.
 *
 * NODE/BROWSER BOUNDARY: everything in this file runs in Node and touches only
 * local Mongo and the local filesystem. It never performs an authenticated
 * SharePoint mutation — Node has no SharePoint cookie, no FormDigest and no
 * JSOM. All SharePoint work belongs to the browser worker.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { config, paths } from '../config.js';
import { getDb } from '../db.js';
import { STAGE } from '../../../shared/deploymentStages.js';
import { buildSiteIdentity, buildTxtSeedPlan, requiredLibraries, requiredFolders, canonicalTargetKey } from '../../../shared/siteRuntime.js';
import { RUNTIME_CONFIG_FILE, DEPLOYMENT_METADATA_FILE, RUNTIME_BOOTSTRAP_FILE } from '../../../shared/universalManifest.js';
import { verifyStoredReleaseIntegrity } from './releaseValidation.js';
import {
  createStaging, writeTargetOverlay, injectRuntimeBootstrap, regenerateManifest, verifyStaging,
  buildDeploymentFiles, buildUploadOrder, resolveStagedFile, destroyStaging,
} from './stagingService.js';
import { appendRunEvent } from './runTelemetry.js';
import { JOB_STATE } from './jobState.js';

function log(jobId, message) {
  const line = `[${new Date().toISOString()}] [prepare] ${message}`;
  console.log(`[job ${jobId}] ${line}`);
  return line;
}

/** Canonical per-target runtime identity. Nothing downstream re-derives paths. */
export function buildSiteRuntime(site, release, jobId, deployedAt) {
  const identity = buildSiteIdentity(site);
  return {
    schemaVersion: 2,
    ...identity,
    releaseVersion: release.version,
    releaseId: String(release._id),
    deployedAt,
    deploymentGeneratedBy: 'site-release-manager',
    deploymentJobId: String(jobId),
  };
}

export function stagingRootForJob(jobId) {
  return path.join(paths.builds, String(jobId));
}

/**
 * Prepare a job: validate the release, validate the target, create a fresh
 * private staging directory, generate this target's overlay, regenerate the
 * manifest and re-verify every hash. Only then is the job handed to the browser.
 */
export async function prepareDeploymentJob(jobId) {
  const db = getDb();
  const objectId = new ObjectId(jobId);
  const job = await db.collection('deployment_jobs').findOne({ _id: objectId });
  if (!job) throw new Error('Job not found.');

  const [site, release] = await Promise.all([
    db.collection('sites').findOne({ _id: job.siteId }),
    db.collection('releases').findOne({ _id: job.releaseId }),
  ]);
  if (!site) throw new Error('האתר לא נמצא.');
  if (!release) throw new Error('הריליס לא נמצא.');

  const logs = [log(jobId, `START prepare | release=${release.version} | site=${site.host}/sites/${site.siteCode}`)];

  // --- 1. RELEASE_VALIDATE ------------------------------------------------
  await appendRunEvent(objectId, { stage: STAGE.RELEASE_VALIDATE, status: 'started', source: 'server', message: 'מאמת את ארטיפקט הריליס.' });
  if (release.artifactType !== 'universal-dist') {
    throw new Error('הריליס נוצר במודל הישן של קוד מקור. העלה Universal dist חדש.');
  }
  const integrity = verifyStoredReleaseIntegrity(release);
  await appendRunEvent(objectId, {
    stage: STAGE.RELEASE_VALIDATE,
    status: 'success',
    source: 'server',
    message: `ארטיפקט Universal ${release.version} אומת (${integrity.fileCount} קבצים).`,
    details: { releaseSha256: release.sha256, buildId: integrity.proof.info.buildId, fileCount: integrity.fileCount },
  });
  logs.push(log(jobId, `release verified sha256=${release.sha256} buildId=${integrity.proof.info.buildId}`));

  // --- 2. TARGET_VALIDATE -------------------------------------------------
  await appendRunEvent(objectId, { stage: STAGE.TARGET_VALIDATE, status: 'started', source: 'server', message: 'מאמת את זהות אתר היעד.' });
  const identity = buildSiteIdentity(site);
  const targetKey = canonicalTargetKey(identity);
  await appendRunEvent(objectId, {
    stage: STAGE.TARGET_VALIDATE,
    status: 'success',
    source: 'server',
    message: `היעד ${identity.host}${identity.siteRoot} תקין.`,
    target: identity.targetDistPath,
    details: {
      targetKey,
      siteDbRoot: identity.siteDbRoot,
      usersDbRoot: identity.usersDbRoot,
      siteAssetsRoot: identity.siteAssetsRoot,
      imagesRoot: identity.imagesRoot,
      widgetsDbTarget: identity.widgetsDbTarget,
      storageBackend: identity.storageBackend,
    },
  });
  logs.push(log(jobId, `target siteDbRoot=${identity.siteDbRoot} usersDbRoot=${identity.usersDbRoot} dist=${identity.targetDistPath}`));

  const deployedAt = new Date().toISOString();
  const stagingRoot = stagingRootForJob(jobId);

  await db.collection('deployment_jobs').updateOne(
    { _id: objectId },
    { $set: { state: JOB_STATE.PREPARING_RELEASE, progress: 15, stagingRoot, targetKey, updatedAt: new Date() } },
  );

  // --- 3. STAGING_CREATE --------------------------------------------------
  await appendRunEvent(objectId, { stage: STAGE.STAGING_CREATE, status: 'started', source: 'server', message: 'יוצר Staging ייעודי לריצה.' });
  const staging = createStaging({ releaseDistDir: release.distDir, stagingRoot });
  await appendRunEvent(objectId, {
    stage: STAGE.STAGING_CREATE,
    status: 'success',
    source: 'server',
    message: `Staging נוצר עם ${staging.fileCount} קבצים; הארטיפקט השמור לא נגע.`,
    details: { stagingDist: staging.distDir, fileCount: staging.fileCount, removedOverlays: staging.removedOverlays.join(',') || 'none' },
  });
  logs.push(log(jobId, `staging=${staging.distDir} files=${staging.fileCount}`));

  // --- 4. RUNTIME_CONFIG_CREATE -------------------------------------------
  await appendRunEvent(objectId, { stage: STAGE.RUNTIME_CONFIG_CREATE, status: 'started', source: 'server', message: 'מייצר Runtime Config פר-אתר.' });
  const overlay = writeTargetOverlay({
    distDir: staging.distDir,
    identity,
    release,
    jobId,
    deployedAt,
    backendApiUrl: site.backendApiUrl || '',
  });
  await appendRunEvent(objectId, {
    stage: STAGE.RUNTIME_CONFIG_CREATE,
    status: 'success',
    source: 'server',
    message: 'Runtime Config, Deployment Metadata ו-Runtime Bootstrap נוצרו ונגזרו מהיעד הזה בלבד.',
    details: {
      host: overlay.runtimeConfig.host,
      siteCode: overlay.runtimeConfig.siteCode,
      targetDistPath: overlay.runtimeConfig.targetDistPath,
      finalAppUrl: overlay.runtimeConfig.finalAppUrl,
      storageBackend: overlay.runtimeConfig.storageBackend,
      runtimeBootstrapFile: overlay.runtimeBootstrapFile,
      runtimeBootstrapBytes: overlay.runtimeBootstrapBytes,
    },
  });
  logs.push(log(jobId, `runtime finalAppUrl=${overlay.runtimeConfig.finalAppUrl}`));

  // --- 4b. Reference the bootstrap from index.html ------------------------
  // Must happen BEFORE the manifest is regenerated so the manifest describes
  // the modified index.html and carries the bootstrap's size and SHA-256.
  const injection = injectRuntimeBootstrap({ distDir: staging.distDir });
  await appendRunEvent(objectId, {
    stage: STAGE.RUNTIME_CONFIG_CREATE,
    status: 'success',
    source: 'server',
    message: `index.html טוען את ${RUNTIME_BOOTSTRAP_FILE} לפני חבילת המודולים של Site Builder.`,
    details: {
      runtimeBootstrapFile: RUNTIME_BOOTSTRAP_FILE,
      injected: injection.injected,
      anchor: injection.anchor,
      bootstrapIndex: injection.bootstrapIndex,
      moduleIndex: injection.moduleIndex,
    },
  });
  logs.push(log(jobId, `bootstrap injected=${injection.injected} anchor=${injection.anchor} before module script at ${injection.moduleIndex}`));

  // --- 5. MANIFEST_CREATE -------------------------------------------------
  await appendRunEvent(objectId, { stage: STAGE.MANIFEST_CREATE, status: 'started', source: 'server', message: 'מייצר Manifest מחדש כולל ה-overlay.' });
  const manifest = regenerateManifest({
    distDir: staging.distDir,
    release,
    identity,
    jobId,
    sourceProof: integrity.proof.info,
  });
  verifyStaging({ distDir: staging.distDir, manifest });
  // The manifest itself is deployed too, even though it cannot appear inside
  // its own file list.
  const deploymentFiles = buildDeploymentFiles(staging.distDir, manifest);
  const uploadOrder = buildUploadOrder(deploymentFiles);
  const manifestPath = path.join(stagingRoot, 'artifact-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    kind: 'site-release-manager-artifact',
    schemaVersion: 3,
    jobId: String(jobId),
    targetKey,
    release: { id: String(release._id), version: release.version, sha256: release.sha256 },
    site: {
      host: identity.host,
      siteCode: identity.siteCode,
      siteRoot: identity.siteRoot,
      siteDbRoot: identity.siteDbRoot,
      usersDbRoot: identity.usersDbRoot,
      siteAssetsRoot: identity.siteAssetsRoot,
      imagesRoot: identity.imagesRoot,
      finalDistRoot: identity.targetDistPath,
      finalUrl: identity.finalAppUrl,
    },
    manifest,
    // The deployable file list, which includes the manifest file itself; the
    // nested `manifest` above remains the full Site Builder-shaped document.
    files: deploymentFiles,
    uploadOrder,
  }, null, 2)}\n`, 'utf8');

  await appendRunEvent(objectId, {
    stage: STAGE.MANIFEST_CREATE,
    status: 'success',
    source: 'server',
    message: `Manifest אומת מחדש עבור ${deploymentFiles.length} קבצים; ${manifest.commitFile} יעלה אחרון.`,
    details: {
      fileCount: deploymentFiles.length,
      indexReferences: manifest.indexReferences.length,
      firstUpload: uploadOrder[0] || '',
      lastUpload: uploadOrder.at(-1) || '',
    },
  });
  logs.push(log(jobId, `manifest files=${manifest.files.length} uploadOrder=${uploadOrder.length} last=${uploadOrder.at(-1)}`));

  // --- 6. READY_FOR_SHAREPOINT --------------------------------------------
  const deployerUrl = `https://${identity.host}${config.sharePointDeployerPath}`
    + `?jobId=${encodeURIComponent(String(jobId))}&apiBase=${encodeURIComponent(config.publicApiUrl)}`;
  await appendRunEvent(objectId, {
    stage: STAGE.READY_FOR_SHAREPOINT,
    status: 'success',
    source: 'server',
    message: 'הכנת השרת הושלמה. ממתין למנוע הפריסה בדפדפן SharePoint.',
    details: { deployerUrl, manifestPath, targetKey },
  });
  logs.push(log(jobId, 'READY_FOR_SHAREPOINT'));

  await db.collection('deployment_jobs').updateOne(
    { _id: objectId },
    {
      $set: {
        state: JOB_STATE.READY_FOR_SHAREPOINT,
        progress: 35,
        manifestPath,
        stagingDistDir: staging.distDir,
        deployerUrl,
        finalDistRoot: identity.targetDistPath,
        finalUrl: identity.finalAppUrl,
        message: 'צד השרת מוכן. ממתין למנוע הפריסה בדפדפן SharePoint.',
        error: null,
        updatedAt: new Date(),
      },
      $push: { logs: { $each: logs, $slice: -500 } },
    },
  );
  await db.collection('sites').updateOne(
    { _id: site._id },
    { $set: { status: JOB_STATE.READY_FOR_SHAREPOINT, activeJobId: objectId, updatedAt: new Date() } },
  );
}

/**
 * The complete instruction set the browser worker needs. Derived fresh from the
 * job's own staging and identity so it can never carry another target's values.
 */
export function buildDeploymentDescriptor({ job, site, release, manifest, uploadOrder }) {
  const identity = buildSiteIdentity(site);
  return {
    job: {
      id: String(job._id),
      state: job.state,
      progress: job.progress || 0,
      type: job.type,
      currentStage: job.currentStage || '',
      currentStageLabel: job.currentStageLabel || '',
      targetKey: job.targetKey || canonicalTargetKey(identity),
      browserLease: job.browserLease || null,
    },
    site: {
      id: String(site._id),
      name: site.name,
      ...identity,
      finalDistRoot: identity.targetDistPath,
      finalUrl: identity.finalAppUrl,
    },
    release: { id: String(release._id), version: release.version, notes: release.notes || '' },
    libraries: requiredLibraries(identity),
    folders: requiredFolders(identity, distSubFolders(manifest)),
    seedFiles: buildTxtSeedPlan(identity),
    permissionsMarker: `${identity.usersDbRoot}/.permissions-setup.json`,
    runtimeVerification: {
      runtimeConfigFile: RUNTIME_CONFIG_FILE,
      deploymentMetadataFile: DEPLOYMENT_METADATA_FILE,
      runtimeBootstrapFile: RUNTIME_BOOTSTRAP_FILE,
      // Server-relative paths, read through SharePoint REST `$value`. This farm
      // does not reliably serve .json through a direct Document Library URL.
      runtimeConfigPath: `${identity.targetDistPath}/${RUNTIME_CONFIG_FILE}`,
      deploymentMetadataPath: `${identity.targetDistPath}/${DEPLOYMENT_METADATA_FILE}`,
      runtimeBootstrapPath: `${identity.targetDistPath}/${RUNTIME_BOOTSTRAP_FILE}`,
      runtimeConfigUrl: `${identity.siteBaseUrl}/${RUNTIME_CONFIG_FILE}`,
      deploymentMetadataUrl: `${identity.siteBaseUrl}/${DEPLOYMENT_METADATA_FILE}`,
      // The one runtime file that MUST work through a direct browser request,
      // because that is exactly how index.html loads it.
      runtimeBootstrapUrl: `${identity.siteBaseUrl}/${RUNTIME_BOOTSTRAP_FILE}`,
      expected: {
        host: identity.host,
        siteCode: identity.siteCode,
        siteDbFolder: identity.siteDbFolder,
        siteDbRoot: identity.siteDbRoot,
        usersDbFolder: identity.usersDbFolder,
        usersDbRoot: identity.usersDbRoot,
        siteAssetsFolder: identity.siteAssetsFolder,
        siteAssetsRoot: identity.siteAssetsRoot,
        widgetsDbTarget: identity.widgetsDbTarget,
        storageBackend: identity.storageBackend,
        targetDistPath: identity.targetDistPath,
        finalAppUrl: identity.finalAppUrl,
        deploymentJobId: String(job._id),
        releaseId: String(release._id),
        releaseVersion: release.version,
      },
    },
    manifest: { ...manifest, uploadOrder },
  };
}

/** Every folder the staged dist needs beneath the target dist root. */
function distSubFolders(manifest) {
  const folders = new Set();
  for (const file of manifest.files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join('/'));
    }
  }
  return [...folders];
}

/**
 * Resolve a file for the browser worker.
 * Files are always served from the job's own staging, never from the immutable
 * stored release directory.
 */
export function resolveDeploymentFile(job, _release, relativePath) {
  const distDir = job.stagingDistDir || path.join(stagingRootForJob(job._id), 'dist');
  return resolveStagedFile(distDir, relativePath);
}

export { destroyStaging };
