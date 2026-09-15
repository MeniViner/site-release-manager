#!/usr/bin/env node
/**
 * Compiles the authoritative Site Builder data domain into a self-contained
 * CommonJS module consumed by the IISNode server. This script is build-time
 * only; the shipped server does not need a Site Builder checkout or esbuild.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const releaseManagerRoot = path.resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const { build } = require(path.join(releaseManagerRoot, 'server', 'node_modules', 'esbuild'));
const sourceRoot = path.resolve(process.env.SITE_BUILDER_SOURCE_ROOT || '');
const outputRoot = path.join(releaseManagerRoot, 'server', 'src', 'daily-data', 'v1', 'domain');
const outputFile = path.join(outputRoot, 'domain.js');

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
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-site-builder-domain-'));

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
  // Canonical seeds only use the pure widget constants/helpers. Removing the
  // React hook keeps the server domain independent of frontend dependencies.
  if (relativePath === 'src/utils/widgetDisplay.js') {
    content = content
      .replace(/^import \{ useEffect, useMemo, useState \} from 'react';\n\n/, '')
      .replace(/\nfunction getWrappedSlice[\s\S]*$/, '\n');
  }
  content = content.replace(importPattern, (whole, prefix, quote, specifier) => {
    const resolved = resolveImport(sourceFile, specifier);
    if (!resolved) return whole;
    const resolvedRelative = path.relative(sourceRoot, resolved);
    copyFile(resolvedRelative);
    const temporaryFile = path.join(temporaryRoot, relativePath);
    let targetSpecifier = path.relative(path.dirname(temporaryFile), path.join(temporaryRoot, resolvedRelative))
      .split(path.sep)
      .join('/');
    if (!targetSpecifier.startsWith('.')) targetSpecifier = `./${targetSpecifier}`;
    return `${prefix}${quote}${targetSpecifier}${quote}`;
  }).replace(/\n+$/, '\n');
  const temporaryFile = path.join(temporaryRoot, relativePath);
  fs.mkdirSync(path.dirname(temporaryFile), { recursive: true });
  fs.writeFileSync(temporaryFile, content);
}

try {
  for (const entry of entries) copyFile(entry);
  const adapter = path.join(temporaryRoot, 'adapter.js');
  fs.writeFileSync(adapter, `import { SiteDataRepository } from './server/src/repository/SiteDataRepository.js';
import { LegacyCompatibilityRepository } from './server/src/repository/LegacyCompatibilityRepository.js';
import { SiteBackupRepository } from './server/src/repository/SiteBackupRepository.js';
import { inspectSiteProvisioning, provisionSiteDefaults } from './server/src/provisioning/siteProvisioning.js';
import * as schemas from './server/src/validation/schemas.js';

export async function createDailyDataDomain({ db, collectionPrefix }) {
  const repository = new SiteDataRepository(db, { collectionPrefix });
  const legacyRepository = new LegacyCompatibilityRepository(repository);
  const backupRepository = new SiteBackupRepository(repository, legacyRepository);
  await repository.initIndexes();
  return Object.freeze({
    repository,
    legacyRepository,
    backupRepository,
    inspectSiteProvisioning: (siteId) => inspectSiteProvisioning({ siteId, repository, legacyRepository }),
    provisionSiteDefaults: (options) => provisionSiteDefaults({ ...options, repository, legacyRepository }),
    schemas,
  });
}
`);
  fs.mkdirSync(outputRoot, { recursive: true });
  await build({
    entryPoints: [adapter],
    outfile: outputFile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    external: ['mongodb', 'zod'],
    legalComments: 'none',
  });
  let sourceRevision = 'unknown';
  try {
    sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  } catch {
    // Exported source trees do not have a Git revision but still compile.
  }
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
    module: 'site-builder-daily-data',
    version: 1,
    format: 'commonjs',
    sourceRevision,
    files: [...copied].sort(),
  }, null, 2)}\n`);
  console.log(`Compiled ${copied.size} Site Builder source files from ${sourceRevision} to CommonJS.`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
