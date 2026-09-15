#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.resolve(process.env.SERVER_ONLY_PACKAGE_DIR || path.join(root, '..', 'site-release-manager-server-only'));
const required = ['server.cjs', 'web.config', 'package.json', 'package-lock.json', '.env.example', 'deployment-manifest.json', 'src/app.js', 'src/daily-data/v1/domain/domain.js', 'node_modules/express/package.json'];
const forbidden = ['.env', 'storage', 'client', 'sharepoint-deployer', '.git', 'test', 'tests'];
const missing = required.filter((entry) => !fs.existsSync(path.join(packageRoot, entry)));
const present = forbidden.filter((entry) => fs.existsSync(path.join(packageRoot, entry)));
if (missing.length || present.length) {
  throw new Error(`Invalid server-only artifact. Missing: ${missing.join(', ') || 'none'}; forbidden: ${present.join(', ') || 'none'}`);
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
  fs.cpSync(packageRoot, path.join(probeRoot, 'artifact'), { recursive: true, dereference: true });
  const probe = spawnSync(process.execPath, ['-e', "require('./src/app.js'); require('./src/daily-data/v1/domain/domain.js');"], {
    cwd: path.join(probeRoot, 'artifact'),
    encoding: 'utf8',
    shell: false,
  });
  if (probe.status !== 0) throw new Error(`Artifact runtime dependency probe failed:\n${probe.stderr || probe.stdout}`);
} finally {
  fs.rmSync(probeRoot, { recursive: true, force: true });
}
console.log(`SERVER-ONLY PACKAGE VERIFIED: ${packageRoot}`);
