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
// --- effective authentication / preflight chain in the GENERATED package ---
// Checked here rather than on the repository template, because the artifact is
// what an operator installs and the two can drift.
{
  const webConfig = fs.readFileSync(path.join(packageRoot, 'web.config'), 'utf8');
  const handler = /<add name="iisnode" path="([^"]+)"/.exec(webConfig);
  if (!handler) throw new Error('Packaged web.config declares no iisnode handler.');

  const ruleStart = webConfig.indexOf('<rule name="AnonymousCorsPreflight"');
  if (ruleStart < 0) throw new Error('Packaged web.config has no anonymous CORS preflight rule.');
  const rule = webConfig.slice(ruleStart, webConfig.indexOf('</rule>', ruleStart));
  const rewrite = /<action type="Rewrite" url="([^"]+)" \/>/.exec(rule);
  if (!rewrite) throw new Error('The preflight rule does not rewrite anywhere.');
  // stopProcessing means no later rule maps the URL onto a handler, so this rule
  // must target the handler entrypoint itself or the preflight 404s.
  if (rewrite[1] !== handler[1]) {
    throw new Error(
      `The preflight rewrites to "${rewrite[1]}" but the iisnode handler is mapped to "${handler[1]}". `
      + 'With stopProcessing="true" nothing maps that URL onto a handler, so OPTIONS would never reach Node.',
    );
  }
  if (!/REQUEST_METHOD/.test(rule) || !/OPTIONS/.test(rule)) {
    throw new Error('The preflight rule must be restricted to OPTIONS.');
  }
  if (webConfig.indexOf('StampTrustedIdentityHeaders') > ruleStart) {
    throw new Error('Trusted headers must be re-stamped before any rule can stop processing.');
  }
  const locations = [...webConfig.matchAll(/<location path="([^"]+)"/g)].map((m) => m[1]).sort();
  const expected = ['api/auth/session', 'api/daily-data/v1/sites'];
  if (JSON.stringify(locations) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected Windows-authenticated locations: ${JSON.stringify(locations)}`);
  }
  if (/<iisnode\b/.test(webConfig)) throw new Error('Packaged web.config must carry no local <iisnode> section.');
  if (!webConfig.includes('629145600')) throw new Error('The IIS upload ceiling is missing.');

  const readme = fs.readFileSync(path.join(packageRoot, 'IIS-DEPLOY-README.txt'), 'utf8');
  if (/disable Anonymous Authentication for the API application/i.test(readme)) {
    throw new Error('The generated README still instructs blanket Windows Authentication, contradicting web.config.');
  }
  if (/TRUSTED_SITE_ACCESS/.test(readme)) {
    throw new Error('The generated README still references the removed per-site access header mechanism.');
  }
  for (const [needle, what] of [
    ['allowedServerVariables', 'the URL Rewrite allow-list prerequisite'],
    ['RandomNumberGenerator', 'cryptographic secret generation'],
    ['WINDOWS_ACCEPTANCE_CHECKLIST', 'the canonical acceptance entry point'],
    ['--offline', 'the offline dependency workflow'],
    ['Preserve the existing .env and storage', 'destination .env/storage preservation'],
  ]) {
    if (!readme.includes(needle)) throw new Error(`The generated README no longer documents ${what}.`);
  }
}

console.log(`SERVER-ONLY PACKAGE VERIFIED: ${packageRoot}`);
