/**
 * Site Builder Universal artifact contract.
 *
 * Site Builder is authoritative. This module mirrors the manifest that
 * `npm run build:universal` writes into `dist-universal/` so Release Manager
 * can prove an artifact is a genuine Universal build before it is ever staged.
 *
 * Compatibility with the real Site Builder output is asserted by
 * server/test/siteBuilderContract.test.js against the on-disk dist-universal.
 */

export const MANIFEST_FILE = 'sharepoint-deploy-manifest.json';
export const RUNTIME_CONFIG_FILE = 'sitebuilder-runtime-config.json';
export const DEPLOYMENT_METADATA_FILE = 'sitebuilder-deployment.json';

/** Files Release Manager generates per target. They must never ship inside a release. */
export const TARGET_OVERLAY_FILES = Object.freeze([RUNTIME_CONFIG_FILE, DEPLOYMENT_METADATA_FILE]);

export const MANIFEST_KIND = 'sitebuilder-release-manifest';
export const UNIVERSAL_BUILD_MODE = 'universal';
export const UNIVERSAL_ARTIFACT_KIND = 'site-builder-universal-frontend';
export const ENTRY_POINT = 'index.html';
export const COMMIT_FILE = 'index.html';

/**
 * Schema versions Release Manager understands. Site Builder currently emits 4.
 * Older releases already stored in this installation used 2 and 3.
 */
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = Object.freeze([2, 3, 4]);
export const CURRENT_MANIFEST_SCHEMA_VERSION = 4;

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

const asString = (value) => String(value ?? '').trim();

/**
 * Validate a parsed Site Builder Universal manifest.
 *
 * Returns a structured report instead of throwing so callers can surface every
 * problem at once rather than one per upload attempt.
 *
 * @returns {{ok:boolean, errors:string[], warnings:string[], info:object}}
 */
export function validateUniversalManifest(manifest, options = {}) {
  const { requireUniversal = true } = options;
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest is not a JSON object'], warnings, info: {} };
  }

  const kind = asString(manifest.kind);
  if (kind !== MANIFEST_KIND) errors.push(`manifest kind must be "${MANIFEST_KIND}" (got "${kind || 'missing'}")`);

  const schemaVersion = Number(manifest.schemaVersion);
  if (!Number.isInteger(schemaVersion)) {
    errors.push('manifest schemaVersion is missing or not an integer');
  } else if (!SUPPORTED_MANIFEST_SCHEMA_VERSIONS.includes(schemaVersion)) {
    errors.push(`manifest schemaVersion ${schemaVersion} is not supported (supported: ${SUPPORTED_MANIFEST_SCHEMA_VERSIONS.join(', ')})`);
  }

  const buildMode = asString(manifest.buildMode).toLowerCase();
  const artifactKind = asString(manifest.artifactKind).toLowerCase();
  if (requireUniversal) {
    if (buildMode !== UNIVERSAL_BUILD_MODE) {
      errors.push(`buildMode must be "${UNIVERSAL_BUILD_MODE}" (got "${buildMode || 'missing'}")`);
    }
    if (!artifactKind.includes('universal')) {
      errors.push(`artifactKind must identify a universal artifact (got "${artifactKind || 'missing'}")`);
    }
    if (manifest.requiresRuntimeConfig !== true) {
      errors.push('requiresRuntimeConfig must be true for a universal artifact');
    }
  }

  const buildId = asString(manifest.buildId);
  if (!buildId) errors.push('buildId is missing or empty');

  const entryPoint = asString(manifest.entryPoint) || ENTRY_POINT;
  if (entryPoint !== ENTRY_POINT) errors.push(`entryPoint must be "${ENTRY_POINT}" (got "${entryPoint}")`);
  const commitFile = asString(manifest.commitFile) || COMMIT_FILE;
  if (commitFile !== COMMIT_FILE) errors.push(`commitFile must be "${COMMIT_FILE}" (got "${commitFile}")`);

  const files = Array.isArray(manifest.files) ? manifest.files : null;
  if (!files || files.length === 0) {
    errors.push('manifest.files must be a non-empty array');
  } else {
    const seen = new Set();
    for (const entry of files) {
      const filePath = asString(entry?.path);
      if (!filePath) { errors.push('manifest contains a file record without a path'); continue; }
      if (seen.has(filePath)) errors.push(`manifest lists ${filePath} more than once`);
      seen.add(filePath);
      const size = Number(entry?.size);
      if (!Number.isInteger(size) || size < 0) errors.push(`invalid size for ${filePath}`);
      const sha256 = asString(entry?.sha256);
      if (!SHA256_PATTERN.test(sha256)) errors.push(`invalid sha256 for ${filePath}`);
    }
    if (!seen.has(ENTRY_POINT)) errors.push(`manifest does not list ${ENTRY_POINT}`);
    for (const overlay of TARGET_OVERLAY_FILES) {
      if (seen.has(overlay)) errors.push(`manifest lists ${overlay}; a universal source artifact must not carry a target overlay`);
    }
    const declaredCount = Number(manifest.fileCount);
    if (Number.isInteger(declaredCount) && declaredCount !== files.length) {
      errors.push(`fileCount ${declaredCount} does not match ${files.length} file records`);
    }
  }

  const indexReferences = Array.isArray(manifest.indexReferences) ? manifest.indexReferences.map(asString).filter(Boolean) : [];
  if (files && indexReferences.length) {
    const paths = new Set(files.map((entry) => asString(entry?.path)));
    for (const reference of indexReferences) {
      if (!paths.has(reference)) errors.push(`indexReferences entry ${reference} is not present in manifest.files`);
    }
  } else if (files && !indexReferences.length && schemaVersion >= 4) {
    warnings.push('manifest declares no indexReferences; index reference verification will parse index.html directly');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info: {
      kind,
      schemaVersion: Number.isInteger(schemaVersion) ? schemaVersion : null,
      buildId,
      buildMode,
      artifactKind,
      entryPoint,
      commitFile,
      fileCount: files ? files.length : 0,
      requiresRuntimeConfig: manifest.requiresRuntimeConfig === true,
      preservesRuntimeConfig: manifest.preservesRuntimeConfig === true,
      storageCompatibility: Array.isArray(manifest.storageCompatibility) ? manifest.storageCompatibility.map(asString) : [],
      requiredFolders: Array.isArray(manifest.requiredFolders) ? manifest.requiredFolders.map(asString) : [],
      indexReferences,
      generatedAt: asString(manifest.generatedAt) || null,
    },
  };
}

/** Extract the local (non-absolute) asset references from an index.html body. */
export function parseIndexReferencesFromHtml(html) {
  const text = String(html || '');
  const references = new Set();
  const attributePattern = /<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let match = attributePattern.exec(text);
  while (match) {
    const raw = match[2] ?? match[3] ?? '';
    const cleaned = raw.split(/[?#]/)[0].replace(/^\.\//, '').trim();
    if (cleaned && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(cleaned)) references.add(cleaned);
    match = attributePattern.exec(text);
  }
  return [...references];
}
