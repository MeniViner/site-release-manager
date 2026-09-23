#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.resolve(process.env.SERVER_ONLY_PACKAGE_DIR || path.join(root, '..', 'site-release-manager-server-only'));
const required = ['index.cjs', 'web.config', 'package.json', 'package-lock.json', '.env.example', 'deployment-manifest.json', 'src/index.js', 'src/app.js', 'src/daily-data/v1/domain/domain.js', 'node_modules/express/package.json'];
const forbidden = ['.env', 'storage', 'client', 'sharepoint-deployer', '.git', 'test', 'tests'];
const missing = required.filter((entry) => !fs.existsSync(path.join(packageRoot, entry)));
const present = forbidden.filter((entry) => fs.existsSync(path.join(packageRoot, entry)));
if (missing.length || present.length) {
  throw new Error(`Invalid server-only artifact. Missing: ${missing.join(', ') || 'none'}; forbidden: ${present.join(', ') || 'none'}`);
}

const webConfig = fs.readFileSync(path.join(packageRoot, 'web.config'), 'utf8');
if (!/path="index\.cjs"/.test(webConfig) || !/url="index\.cjs"/.test(webConfig) || /<iisnode\b/.test(webConfig)) {
  throw new Error('web.config must target the protected index.cjs wrapper and must not contain an <iisnode> section.');
}
if (fs.readFileSync(path.join(packageRoot, 'index.cjs'), 'utf8').trim().split('\n').at(-1) !== "require('./src/index.js');") {
  throw new Error('index.cjs must be a wrapper around the canonical src/index.js startup implementation.');
}

const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'deployment-manifest.json'), 'utf8'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const entry of manifest.files || []) {
  const file = path.join(packageRoot, ...entry.path.split('/'));
  if (!fs.existsSync(file)) throw new Error(`Manifest file is missing: ${entry.path}`);
  if (fs.statSync(file).size !== entry.size || sha256(file) !== entry.sha256) {
    throw new Error(`Manifest checksum mismatch: ${entry.path}`);
  }
}
if (sha256(path.join(packageRoot, 'package-lock.json')) !== manifest.packageLockSha256) {
  throw new Error('package-lock.json does not match deployment-manifest.json.');
}

function javascriptFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? javascriptFiles(file) : entry.name.endsWith('.js') ? [file] : [];
  });
}
for (const file of javascriptFiles(path.join(packageRoot, 'src'))) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\bimport\s*\(|^\s*import\s|^\s*export\s/m.test(source)) {
    throw new Error(`Production artifact contains ESM syntax: ${path.relative(packageRoot, file)}`);
  }
}

const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-server-only-probe-'));
try {
  fs.writeFileSync(
    path.join(probeRoot, 'package.json'),
    `${JSON.stringify({ name: 'unrelated-parent-package', version: '99.0.0' }, null, 2)}\n`,
  );
  fs.cpSync(packageRoot, path.join(probeRoot, 'artifact'), { recursive: true, dereference: true });
  const probe = spawnSync(process.execPath, ['-e', "const { rootDir } = require('./src/config.js'); if (rootDir !== process.cwd()) throw new Error(`wrong root: ${rootDir}`); require('./src/app.js'); require('./src/daily-data/v1/domain/domain.js');"], {
    cwd: path.join(probeRoot, 'artifact'),
    encoding: 'utf8',
    shell: false,
  });
  if (probe.status !== 0) throw new Error(`Artifact runtime dependency probe failed:\n${probe.stderr || probe.stdout}`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const graph = spawnSync(npm, ['ls', '--omit=dev', '--all', '--json'], {
    cwd: path.join(probeRoot, 'artifact'),
    encoding: 'utf8',
    shell: false,
  });
  if (graph.status !== 0) throw new Error(`Artifact dependency graph is incomplete:\n${graph.stderr || graph.stdout}`);
} finally {
  fs.rmSync(probeRoot, { recursive: true, force: true });
}
console.log(`SERVER-ONLY PACKAGE VERIFIED: ${packageRoot}`);
