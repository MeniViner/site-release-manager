import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv, readSimpleEnv } from './project-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = readSimpleEnv(ensureProjectEnv(root).envPath);
const log = (message) => console.log(`[deployer-sharepoint-publish] ${message}`);

if (process.platform !== 'win32') {
  log('Skipped on non-Windows. SharePoint WebDAV publish runs only on the closed Windows workstation.');
  process.exit(0);
}

const host = String(env.SHAREPOINT_DEPLOYER_HOST || env.RELEASE_MANAGER_SHAREPOINT_HOST || 'portal.army.idf')
  .trim().replace(/^https?:\/\//i, '').replace(/\/+$/g, '');
const targetRel = `/${String(env.SHAREPOINT_DEPLOYER_PUBLISH_PATH || '/sites/tools/SiteAssets/site-release-deployer').trim().replace(/^\/+|\/+$/g, '')}`;
if (!host || targetRel.split('/').some((part) => part === '.' || part === '..')) throw new Error(`Invalid deployer SharePoint target: ${host}${targetRel}`);

const sourceDir = path.join(root, 'sharepoint-deployer', 'client', 'dist');
const required = ['index.html', 'app.js', 'styles.css'];
for (const rel of required) if (!fs.existsSync(path.join(sourceDir, rel))) throw new Error(`Missing SharePoint deployer build artifact: ${rel}`);

const webDavRoot = `\\\\${host}@SSL\\DavWWWRoot`;
const targetDir = path.win32.join(webDavRoot, ...targetRel.split('/').filter(Boolean));
const sourceIndex = path.join(sourceDir, 'index.html');
const targetIndex = path.win32.join(targetDir, 'index.html');

log(`Source: ${sourceDir}`);
log(`Target: ${targetDir}`);
log(`URL: https://${host}${targetRel}/index.html`);

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function robocopy(args, label) {
  const result = spawnSync('robocopy', args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  const code = Number(result.status ?? 16);
  if (code >= 0 && code < 8) { log(`${label} completed with code ${code}.`); return; }
  throw new Error(`${label} failed with robocopy code ${code}.`);
}

fs.mkdirSync(targetDir, { recursive: true });
robocopy([sourceDir, targetDir, '/MIR', '/R:2', '/W:2', '/XF', 'index.html', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], 'deployer mirror');

let lastError = null;
for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    fs.copyFileSync(sourceIndex, targetIndex);
    log(`index.html copied last (attempt ${attempt}).`);
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    log(`index copy attempt ${attempt}/6 failed: ${error.code || error.name} ${error.message}`);
    sleep(700 * attempt);
  }
}
if (lastError) throw lastError;

for (const rel of required) {
  const target = path.win32.join(targetDir, rel);
  if (!fs.existsSync(target)) throw new Error(`Publish verification failed; missing ${target}`);
}

const indexText = fs.readFileSync(targetIndex, 'utf8');
if (!indexText.includes('./app.js') || !indexText.includes('./styles.css')) throw new Error('Published deployer index.html is not the expected deployer UI.');
log('SharePoint Deployer publish verified successfully.');
