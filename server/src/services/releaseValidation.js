/**
 * Universal release artifact validation.
 *
 * Two rules, taken from the mission constraints:
 *
 *  - A legitimate Universal build is NOT rejected merely because minified
 *    JavaScript happens to contain SharePoint-looking strings, provided a valid
 *    Universal source manifest proves the artifact.
 *  - An artifact WITHOUT that proof that contains target identity IS rejected.
 */

import fs from 'node:fs';
import path from 'node:path';
import { collectFiles, hashFile } from '../utils/files.js';
import {
  MANIFEST_FILE, TARGET_OVERLAY_FILES, ENTRY_POINT,
  validateUniversalManifest, parseIndexReferencesFromHtml,
} from '../../../shared/universalManifest.js';

export class ReleaseValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ReleaseValidationError';
    this.statusCode = 400;
    Object.assign(this, details);
  }
}

const SCANNED_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg', '.xml', '.webmanifest']);

/** Compiled-in SharePoint target identity, e.g. "/sites/alpha/siteDB/dist". */
const IDENTITY_PATTERNS = [
  /\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/dist/ig,
  /https?:\/\/[a-z0-9.-]+\/(?:sites|teams)\/[a-z0-9][a-z0-9-]{1,80}\/[A-Za-z0-9._-]{1,80}\/dist/ig,
];

export function findTargetIdentityLeaks(distDir, limit = 8) {
  const hits = [];
  for (const file of collectFiles(distDir)) {
    if (!SCANNED_EXTENSIONS.has(path.extname(file.path).toLowerCase())) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(distDir, ...file.path.split('/')), 'utf8'); } catch { continue; }
    for (const pattern of IDENTITY_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match) hits.push({ file: file.path, match: match[0] });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** Read and validate the Site Builder source manifest that proves a Universal build. */
export function readUniversalProof(distDir) {
  const manifestPath = path.join(distDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { verified: false, reason: 'source-manifest-missing', errors: [`${MANIFEST_FILE} is not present in the artifact`], info: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { verified: false, reason: 'source-manifest-invalid', errors: [`${MANIFEST_FILE} is not valid JSON: ${error.message}`], info: null };
  }
  const report = validateUniversalManifest(parsed);
  return {
    verified: report.ok,
    reason: report.ok ? 'source-universal-manifest' : 'source-manifest-not-universal',
    errors: report.errors,
    warnings: report.warnings,
    info: report.info,
    manifest: parsed,
  };
}

/**
 * Full validation of an ingested artifact directory.
 * Throws ReleaseValidationError listing every problem found.
 */
export function validateUniversalArtifact(distDir, { sourceName = '' } = {}) {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(path.join(distDir, ENTRY_POINT))) errors.push(`the artifact is missing ${ENTRY_POINT}`);
  const files = fs.existsSync(distDir) ? collectFiles(distDir) : [];
  if (!files.some((file) => /^assets\/.*\.js$/i.test(file.path))) {
    errors.push('the artifact contains no JavaScript build under assets/');
  }

  // A source artifact must arrive without any per-target overlay.
  for (const overlay of TARGET_OVERLAY_FILES) {
    if (files.some((file) => file.path === overlay)) {
      errors.push(`the artifact contains ${overlay}; a Universal release must arrive without a per-target overlay`);
    }
  }

  const proof = readUniversalProof(distDir);
  if (!proof.verified) {
    errors.push(...proof.errors.map((problem) => `universal manifest: ${problem}`));
  }

  if (proof.verified) {
    const byPath = new Map(files.map((file) => [file.path, file]));
    for (const entry of proof.manifest.files) {
      const actual = byPath.get(entry.path);
      if (!actual) { errors.push(`manifest lists ${entry.path}, which is not present in the artifact`); continue; }
      if (Number(actual.size) !== Number(entry.size)) {
        errors.push(`size mismatch for ${entry.path}: artifact ${actual.size} vs manifest ${entry.size}`);
      }
      if (actual.sha256 !== entry.sha256) errors.push(`sha256 mismatch for ${entry.path}`);
    }

    try {
      const html = fs.readFileSync(path.join(distDir, ENTRY_POINT), 'utf8');
      for (const reference of parseIndexReferencesFromHtml(html)) {
        if (!byPath.has(reference)) errors.push(`${ENTRY_POINT} references ${reference}, which is not present in the artifact`);
      }
    } catch (error) {
      errors.push(`could not read ${ENTRY_POINT}: ${error.message}`);
    }
  }

  const identityHits = findTargetIdentityLeaks(distDir);
  if (identityHits.length) {
    if (proof.verified) {
      // Proven Universal build: minified bundle strings are diagnostics only.
      warnings.push(
        `${identityHits.length} SharePoint-like string(s) were found inside the bundle. `
        + 'The artifact is proven Universal by its build manifest, so these are recorded as diagnostics and do not block the release.',
      );
    } else {
      errors.push(
        'the artifact contains compiled-in SharePoint target identity and has no valid Universal build manifest to prove otherwise: '
        + identityHits.map((hit) => `${hit.file} -> ${hit.match}`).join(' | '),
      );
    }
  }

  if (errors.length) {
    throw new ReleaseValidationError(
      `הריליס אינו Universal dist תקין: ${errors.slice(0, 6).join(' | ')}`,
      { errors, warnings, proof, identityHits, sourceName },
    );
  }

  return { files, proof, identityHits, warnings };
}

/** Confirm a stored release is still byte-identical to what was ingested. */
export function verifyStoredReleaseIntegrity(release) {
  if (!release?.distDir || !fs.existsSync(release.distDir)) {
    throw new ReleaseValidationError('תיקיית הריליס השמור חסרה. יש להעלות את הריליס מחדש.', { statusCode: 409 });
  }
  const proof = readUniversalProof(release.distDir);
  if (!proof.verified) {
    throw new ReleaseValidationError(
      `הריליס השמור אינו נושא manifest אוניברסלי תקין: ${proof.errors.join(' | ')}`,
      { statusCode: 409, proof },
    );
  }
  const mismatches = [];
  for (const entry of proof.manifest.files) {
    const full = path.join(release.distDir, ...entry.path.split('/'));
    if (!fs.existsSync(full)) { mismatches.push(`missing ${entry.path}`); continue; }
    if (fs.statSync(full).size !== entry.size) { mismatches.push(`size ${entry.path}`); continue; }
    if (hashFile(full) !== entry.sha256) mismatches.push(`sha256 ${entry.path}`);
    if (mismatches.length >= 6) break;
  }
  if (mismatches.length) {
    throw new ReleaseValidationError(
      `הארטיפקט השמור השתנה מאז ההעלאה: ${mismatches.join(' | ')}`,
      { statusCode: 409, mismatches },
    );
  }
  return { proof, fileCount: proof.manifest.files.length };
}
