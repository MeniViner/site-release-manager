#!/usr/bin/env node
/**
 * Vendors the Site Builder Mongo data domain into the Release Manager package.
 *
 * This is intentionally source-to-source rather than a runtime dependency:
 * the IIS package contains the generated module and never needs a Site Builder
 * checkout.  Run with SITE_BUILDER_SOURCE_ROOT set to a checked-out Builder
 * revision when deliberately refreshing the embedded domain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const releaseManagerRoot = path.resolve(scriptDir, '..');
const sourceRoot = path.resolve(process.env.SITE_BUILDER_SOURCE_ROOT || '');
const destinationRoot = path.join(releaseManagerRoot, 'server', 'src', 'daily-data', 'v1', 'domain', 'source');

if (!process.env.SITE_BUILDER_SOURCE_ROOT || !fs.existsSync(path.join(sourceRoot, 'server', 'src'))) {
  throw new Error('Set SITE_BUILDER_SOURCE_ROOT to the root of a Site Builder checkout.');
}

const entries = [
  'server/src/repository/SiteDataRepository.js',
  'server/src/repository/LegacyCompatibilityRepository.js',
  'server/src/repository/SiteBackupRepository.js',
  'server/src/provisioning/siteProvisioning.js',
  'server/src/validation/schemas.js',
];
const importPattern = /((?:import|export)\s+(?:[^'"]+\s+from\s+)?)(['"])(\.[^'"]+)\2/g;
const copied = new Set();

function resolveImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  return [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function copyFile(relativePath) {
  const sourceFile = path.join(sourceRoot, relativePath);
  if (copied.has(relativePath)) return;
  copied.add(relativePath);
  let content = fs.readFileSync(sourceFile, 'utf8');
  // Canonical seeds use only the pure constants/helpers from widgetDisplay.
  // Strip its frontend hook implementation so the server module does not ship
  // or load React while preserving the upstream defaults verbatim.
  if (relativePath === 'src/utils/widgetDisplay.js') {
    content = content
      .replace(/^import \{ useEffect, useMemo, useState \} from 'react';\n\n/, '')
      .replace(/\nfunction getWrappedSlice[\s\S]*$/, '\n');
  }
  content = content.replace(/\n+$/, '\n');
  content = content.replace(importPattern, (whole, prefix, quote, specifier) => {
    const resolved = resolveImport(sourceFile, specifier);
    if (!resolved) return whole;
    const resolvedRelative = path.relative(sourceRoot, resolved);
    copyFile(resolvedRelative);
    const targetFile = path.join(destinationRoot, relativePath);
    let targetSpecifier = path.relative(path.dirname(targetFile), path.join(destinationRoot, resolvedRelative))
      .split(path.sep)
      .join('/');
    if (!targetSpecifier.startsWith('.')) targetSpecifier = `./${targetSpecifier}`;
    return `${prefix}${quote}${targetSpecifier}${quote}`;
  });
  const targetFile = path.join(destinationRoot, relativePath);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, content);
}

fs.rmSync(destinationRoot, { recursive: true, force: true });
for (const entry of entries) copyFile(entry);

let sourceRevision = 'unknown';
try {
  sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
} catch {
  // The source module remains usable when generated from an exported checkout.
}
const manifest = {
  module: 'site-builder-daily-data',
  version: 1,
  sourceRevision,
  generatedAt: new Date().toISOString(),
  files: [...copied].sort(),
};
fs.writeFileSync(path.join(destinationRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Embedded ${manifest.files.length} Site Builder source files from ${sourceRevision}.`);
