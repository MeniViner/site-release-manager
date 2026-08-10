import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv, readSimpleEnv } from './project-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appVersion = String(packageInfo.version || 'unknown');
const envPath = ensureProjectEnv(root).envPath;
const env = readSimpleEnv(envPath);
const force = process.argv.includes('--force');
const enabled = force || String(env.RELEASE_MANAGER_AUTO_SHAREPOINT_DEPLOY || 'false').trim().toLowerCase() === 'true';

const log = (message) => console.log(`[manager-sharepoint-deploy] ${message}`);

if (!enabled) {
  log('Skipped. RELEASE_MANAGER_AUTO_SHAREPOINT_DEPLOY is not true.');
  process.exit(0);
}

if (process.platform !== 'win32') {
  log('Skipped on non-Windows. SharePoint WebDAV auto-deploy runs only on the closed Windows workstation.');
  process.exit(0);
}

const host = String(env.RELEASE_MANAGER_SHAREPOINT_HOST || 'portal.army.idf').trim().replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
const targetRelRaw = String(env.RELEASE_MANAGER_SHAREPOINT_DIST_PATH || '/sites/alphateam/site_release_manager/dist').trim();
const targetRel = `/${targetRelRaw.replace(/^\/+|\/+$/g, '')}`;
if (!host || targetRel.split('/').some((part) => part === '..' || part === '.')) {
  throw new Error(`Invalid SharePoint deployment target: host=${host} path=${targetRel}`);
}

const sourceDir = path.join(root, 'client', 'dist');
const required = [
  'index.html',
  'release-manager-runtime-config.json',
  'release-manager-runtime-config.txt',
  'release-manager-build-diagnostics.txt',
];
for (const rel of required) {
  if (!fs.existsSync(path.join(sourceDir, rel))) throw new Error(`Missing client dist artifact: ${rel}`);
}
if (!fs.existsSync(path.join(sourceDir, 'assets'))) throw new Error('Missing client dist assets directory.');

const webDavRoot = `\\\\${host}@SSL\\DavWWWRoot`;
const targetDir = path.win32.join(webDavRoot, ...targetRel.split('/').filter(Boolean));
const targetIndex = path.win32.join(targetDir, 'index.html');
const sourceIndex = path.join(sourceDir, 'index.html');
log(`Source: ${sourceDir}`);
log(`Target: ${targetDir}`);
log(`Final URL: https://${host}${targetRel}/index.html`);
log('Replacing previous dist with robocopy /MIR while excluding index.html; index.html is copied last through Node/WebDAV.');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function robocopy(args, label) {
  log(`Running ${label}...`);
  const result = spawnSync('robocopy', args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  const code = Number(result.status ?? 16);
  if (code >= 0 && code < 8) {
    log(`${label} completed with robocopy code ${code}.`);
    return code;
  }
  throw new Error(`${label} failed with robocopy exit code ${code}.`);
}

function ensureTargetDirectory() {
  if (fs.existsSync(targetDir)) {
    log('Target dist already exists on WebDAV.');
    return;
  }
  log('Target dist does not exist yet; creating it through WebDAV...');
  fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(targetDir)) {
    throw new Error(`SharePoint target directory could not be created or resolved through WebDAV: ${targetDir}`);
  }
}

function copyIndexLast() {
  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      if (!fs.existsSync(targetDir)) ensureTargetDirectory();
      fs.copyFileSync(sourceIndex, targetIndex);
      log(`index.html copied last through Node/WebDAV (attempt ${attempt}).`);
      return;
    } catch (error) {
      lastError = error;
      log(`index.html copy attempt ${attempt}/6 failed: ${error.code || error.name || 'error'} ${error.message}`);
      sleep(800 * attempt);
    }
  }
  throw new Error(`index.html last copy failed after retries: ${lastError?.message || 'unknown error'}`);
}

function waitForTargetFile(rel, timeoutMs = 12000) {
  const target = path.win32.join(targetDir, ...rel.split('/'));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(target)) return true;
    sleep(400);
  }
  return false;
}

ensureTargetDirectory();
robocopy([
  sourceDir,
  targetDir,
  '/MIR',
  '/R:2',
  '/W:2',
  '/XF',
  'index.html',
  '/NFL',
  '/NDL',
  '/NJH',
  '/NJS',
  '/NP',
], 'dist mirror');

copyIndexLast();

for (const rel of required) {
  if (!waitForTargetFile(rel)) throw new Error(`Post-deploy verification failed; missing target file after timeout: ${rel}`);
}

const runtimeText = fs.readFileSync(path.win32.join(targetDir, 'release-manager-runtime-config.txt'), 'utf8');
const runtime = JSON.parse(runtimeText);
if (runtime.appVersion && runtime.appVersion !== appVersion) {
  throw new Error(`Post-deploy runtime version mismatch: expected ${appVersion}, got ${runtime.appVersion}`);
}
log(`Verified runtime apiBaseUrl=${runtime.apiBaseUrl}`);
log(`Verified runtime appVersion=${runtime.appVersion || 'unknown'} (project=${appVersion})`);
log('SharePoint manager dist deployment completed successfully.');
