import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv, readSimpleEnv } from './project-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const targetDir = path.win32.join(`\\\\${host}@SSL\\DavWWWRoot`, ...targetRel.split('/').filter(Boolean));
log(`Source: ${sourceDir}`);
log(`Target: ${targetDir}`);
log(`Final URL: https://${host}${targetRel}/index.html`);
log('Replacing previous dist with robocopy /MIR; index.html is copied last.');

function robocopy(args, label) {
  log(`Running ${label}...`);
  const result = spawnSync('robocopy', args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  const code = Number(result.status ?? 16);
  if (code >= 0 && code < 8) {
    log(`${label} completed with robocopy code ${code}.`);
    return;
  }
  throw new Error(`${label} failed with robocopy exit code ${code}.`);
}

fs.mkdirSync(targetDir, { recursive: true });
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
robocopy([
  sourceDir,
  targetDir,
  'index.html',
  '/R:2',
  '/W:2',
  '/NFL',
  '/NDL',
  '/NJH',
  '/NJS',
  '/NP',
], 'index.html last');

for (const rel of required) {
  const target = path.win32.join(targetDir, ...rel.split('/'));
  if (!fs.existsSync(target)) throw new Error(`Post-deploy verification failed; missing target file: ${rel}`);
}

const runtimeText = fs.readFileSync(path.win32.join(targetDir, 'release-manager-runtime-config.txt'), 'utf8');
const runtime = JSON.parse(runtimeText);
log(`Verified runtime apiBaseUrl=${runtime.apiBaseUrl}`);
log('SharePoint manager dist deployment completed successfully.');
