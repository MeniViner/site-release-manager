/**
 * Fresh per-run deployment staging.
 *
 * The stored release is immutable at the artifact level and is NEVER deployed
 * from directly. Every run owns a private staging directory: the Universal
 * artifact is copied in, any target overlay is defensively removed, this
 * target's overlay is generated, the manifest is regenerated, and every hash is
 * re-verified before the job is handed to the browser.
 *
 * That is what guarantees target B can never inherit target A's runtime
 * identity, no matter what a previous run left behind.
 */

import fs from 'node:fs';
import path from 'node:path';
import { collectFiles, ensureDirectory, hashFile, removeDirectory, safeResolve } from '../utils/files.js';
import {
  MANIFEST_FILE, RUNTIME_CONFIG_FILE, DEPLOYMENT_METADATA_FILE,
  TARGET_OVERLAY_FILES, CURRENT_MANIFEST_SCHEMA_VERSION, MANIFEST_KIND,
  UNIVERSAL_BUILD_MODE, UNIVERSAL_ARTIFACT_KIND, ENTRY_POINT, COMMIT_FILE,
  parseIndexReferencesFromHtml,
} from '../../../shared/universalManifest.js';

/** Files regenerated per target. None of them may survive from the source artifact. */
export const REGENERATED_FILES = Object.freeze([...TARGET_OVERLAY_FILES, MANIFEST_FILE]);

export class StagingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StagingError';
    this.statusCode = 500;
    Object.assign(this, details);
  }
}

function writeJson(filePath, payload) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Copy the immutable release artifact into a private staging directory,
 * excluding every per-target file.
 */
export function createStaging({ releaseDistDir, stagingRoot }) {
  if (!releaseDistDir || !fs.existsSync(releaseDistDir)) {
    throw new StagingError(`Release artifact directory is missing: ${releaseDistDir}`);
  }
  // A staging directory is owned by exactly one run and always starts empty.
  removeDirectory(stagingRoot);
  const distDir = path.join(stagingRoot, 'dist');
  ensureDirectory(distDir);

  let copied = 0;
  for (const file of collectFiles(releaseDistDir)) {
    if (REGENERATED_FILES.includes(file.path)) continue;
    const target = safeResolve(distDir, file.path);
    ensureDirectory(path.dirname(target));
    fs.copyFileSync(path.join(releaseDistDir, ...file.path.split('/')), target);
    copied += 1;
  }
  if (!copied) throw new StagingError('The release artifact contains no deployable files.');

  // Defensive second pass: nothing target-specific may exist in staging, even if
  // it somehow survived the copy filter.
  const leaked = [];
  for (const name of REGENERATED_FILES) {
    const candidate = path.join(distDir, name);
    if (fs.existsSync(candidate)) { fs.rmSync(candidate, { force: true }); leaked.push(name); }
  }

  if (!fs.existsSync(path.join(distDir, ENTRY_POINT))) {
    throw new StagingError(`Staging is missing ${ENTRY_POINT}.`);
  }
  return { stagingRoot, distDir, fileCount: copied, removedOverlays: leaked };
}

/**
 * Write this target's runtime config and deployment metadata into staging.
 * `identity` comes from buildSiteIdentity, so nothing here re-derives a path.
 */
export function writeTargetOverlay({ distDir, identity, release, jobId, deployedAt, backendApiUrl = '' }) {
  const runtimeConfig = {
    schemaVersion: 2,
    storageBackend: identity.storageBackend,
    host: identity.host,
    siteCode: identity.siteCode,
    siteId: identity.siteId,
    siteRoot: identity.siteRoot,
    siteApiRoot: identity.siteApiRoot,
    siteDbFolder: identity.siteDbFolder,
    siteDbRoot: identity.siteDbRoot,
    usersDbFolder: identity.usersDbFolder,
    usersDbRoot: identity.usersDbRoot,
    siteAssetsFolder: identity.siteAssetsFolder,
    siteAssetsRoot: identity.siteAssetsRoot,
    imagesFolder: identity.imagesFolder,
    imagesRoot: identity.imagesRoot,
    widgetsDbTarget: identity.widgetsDbTarget,
    bootstrapLibrary: identity.bootstrapLibrary,
    bootstrapFolder: identity.bootstrapFolder,
    sharePointSiteUrl: identity.sharePointSiteUrl,
    allowedSiteRoot: identity.allowedSiteRoot,
    targetDistPath: identity.targetDistPath,
    finalAppUrl: identity.finalAppUrl,
    siteBaseUrl: identity.siteBaseUrl,
    releaseVersion: release.version,
    releaseId: String(release._id),
    deployedAt,
    deploymentGeneratedBy: 'site-release-manager',
    deploymentJobId: String(jobId),
  };
  // Only a Mongo-backed target carries a backend URL. TXT targets must not.
  if (identity.storageBackend === 'mongo' && backendApiUrl) runtimeConfig.backendApiUrl = backendApiUrl;

  const deploymentMetadata = {
    kind: 'sitebuilder-deployment',
    schemaVersion: 3,
    generatedBy: 'site-release-manager',
    deployedAt,
    releaseVersion: release.version,
    releaseId: String(release._id),
    releaseSha256: release.sha256 || '',
    storageBackend: identity.storageBackend,
    storageBackendSource: 'deployment-target',
    host: identity.host,
    siteCode: identity.siteCode,
    siteId: identity.siteId,
    siteRoot: identity.siteRoot,
    siteDbRoot: identity.siteDbRoot,
    usersDbRoot: identity.usersDbRoot,
    siteAssetsRoot: identity.siteAssetsRoot,
    imagesRoot: identity.imagesRoot,
    targetDistPath: identity.targetDistPath,
    finalAppUrl: identity.finalAppUrl,
    deploymentJobId: String(jobId),
  };

  writeJson(path.join(distDir, RUNTIME_CONFIG_FILE), runtimeConfig);
  writeJson(path.join(distDir, DEPLOYMENT_METADATA_FILE), deploymentMetadata);
  return { runtimeConfig, deploymentMetadata };
}

/**
 * Regenerate the deployment manifest over the complete staging tree, including
 * the freshly written overlays, and preserve the source build's provenance.
 */
export function regenerateManifest({ distDir, release, identity, jobId, sourceProof = null }) {
  const files = collectFiles(distDir).filter((file) => file.path !== MANIFEST_FILE);
  const indexHtml = fs.readFileSync(path.join(distDir, ENTRY_POINT), 'utf8');
  const indexReferences = parseIndexReferencesFromHtml(indexHtml).sort();

  const manifest = {
    kind: MANIFEST_KIND,
    schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
    buildId: sourceProof?.buildId || `srm-${String(jobId)}`,
    buildMode: UNIVERSAL_BUILD_MODE,
    artifactKind: UNIVERSAL_ARTIFACT_KIND,
    generatedAt: new Date().toISOString(),
    generatedBy: 'site-release-manager',
    storageCompatibility: sourceProof?.storageCompatibility?.length ? sourceProof.storageCompatibility : ['txt'],
    requiresRuntimeConfig: true,
    preservesRuntimeConfig: true,
    runtimeConfigFiles: [RUNTIME_CONFIG_FILE, DEPLOYMENT_METADATA_FILE],
    manifestFile: MANIFEST_FILE,
    entryPoint: ENTRY_POINT,
    commitFile: COMMIT_FILE,
    fileCount: files.length,
    requiredFolders: [...new Set(files.map((file) => file.path.split('/').slice(0, -1).join('/')).filter(Boolean))].sort(),
    indexReferences,
    // Provenance of the immutable source artifact this staging was derived from.
    sourceBuild: sourceProof ? { buildId: sourceProof.buildId, generatedAt: sourceProof.generatedAt || null, schemaVersion: sourceProof.schemaVersion ?? null } : null,
    release: { id: String(release._id), version: release.version, sha256: release.sha256 || '' },
    target: {
      host: identity.host,
      siteCode: identity.siteCode,
      siteDbRoot: identity.siteDbRoot,
      usersDbRoot: identity.usersDbRoot,
      targetDistPath: identity.targetDistPath,
      finalAppUrl: identity.finalAppUrl,
    },
    files: files.map(({ path: filePath, size, sha256 }) => ({ path: filePath, size, sha256 })),
  };

  writeJson(path.join(distDir, MANIFEST_FILE), manifest);
  return manifest;
}

/**
 * Re-verify the staged tree against the regenerated manifest: every declared
 * file must exist with the declared size and SHA-256, and every reference in
 * index.html must be present.
 */
export function verifyStaging({ distDir, manifest }) {
  const problems = [];
  const declared = new Set();

  for (const entry of manifest.files) {
    declared.add(entry.path);
    const full = path.join(distDir, ...entry.path.split('/'));
    if (!fs.existsSync(full)) { problems.push(`missing in staging: ${entry.path}`); continue; }
    const size = fs.statSync(full).size;
    if (size !== entry.size) { problems.push(`size mismatch for ${entry.path}: ${size} != ${entry.size}`); continue; }
    const sha256 = hashFile(full);
    if (sha256 !== entry.sha256) problems.push(`sha256 mismatch for ${entry.path}`);
  }

  for (const reference of manifest.indexReferences || []) {
    if (!declared.has(reference)) problems.push(`index.html references ${reference}, which is not staged`);
  }
  if (!declared.has(ENTRY_POINT)) problems.push(`staging manifest is missing ${ENTRY_POINT}`);
  for (const overlay of TARGET_OVERLAY_FILES) {
    if (!declared.has(overlay)) problems.push(`staging manifest is missing the generated overlay ${overlay}`);
  }

  if (problems.length) {
    throw new StagingError(`Staging verification failed: ${problems.slice(0, 8).join(' | ')}`, { problems });
  }
  return { verifiedFiles: declared.size };
}

/**
 * The complete set of files to deploy.
 *
 * A manifest can never list itself (its own hash would be unstable), but Site
 * Builder DOES expect `sharepoint-deploy-manifest.json` to be present next to
 * index.html at the target — its deployment-overlay assertion requires all
 * three of runtime config, deployment metadata and the manifest. So the
 * deployment plan carries one more entry than the manifest does.
 */
export function buildDeploymentFiles(distDir, manifest) {
  const manifestPath = path.join(distDir, MANIFEST_FILE);
  return [
    ...manifest.files,
    { path: MANIFEST_FILE, size: fs.statSync(manifestPath).size, sha256: hashFile(manifestPath) },
  ];
}

/** Upload order: every asset first, the commit file last. */
export function buildUploadOrder(files) {
  const paths = (Array.isArray(files) ? files : files.files).map((file) => file.path);
  return [...paths.filter((filePath) => filePath !== COMMIT_FILE).sort(), COMMIT_FILE];
}

/** Resolve one staged file for serving to the browser worker. */
export function resolveStagedFile(distDir, relativePath) {
  return safeResolve(distDir, relativePath);
}

export function destroyStaging(stagingRoot) {
  removeDirectory(stagingRoot);
}
