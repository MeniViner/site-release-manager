import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const envPath = path.join(root, '.env');
dotenv.config({ path: envPath });

const required = [
  'index.js',
  'web.config',
  'package.json',
  '.env',
  'server/package.json',
  'server/src/index.js',
  'server/src/app.js',
  'server/node_modules/express/package.json',
  'client/dist/index.html',
  'client/dist/release-manager-runtime-config.json',
  'client/dist/release-manager-runtime-config.txt',
  'sharepoint-deployer/client/dist/index.html',
];

const missing = required.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  console.error('[iis-package] Missing required files:');
  for (const rel of missing) console.error(`  - ${rel}`);
  console.error('[iis-package] Run the project build/verify first, then retry.');
  process.exit(1);
}

function copyFile(rel, targetRoot) {
  const src = path.join(root, rel);
  const dest = path.join(targetRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(rel, targetRoot) {
  const src = path.join(root, rel);
  const dest = path.join(targetRoot, rel);
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true, force: true, dereference: true });
}

function timestamp() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function find7Zip() {
  const candidates = [
    process.env.SEVEN_ZIP,
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    '7z.exe',
    '7z',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
    if (!path.isAbsolute(candidate)) {
      const check = spawnSync(candidate, ['i'], { stdio: 'ignore', shell: false });
      if (!check.error) return candidate;
    }
  }
  return '';
}

const publicApiUrl = String(process.env.PUBLIC_API_URL || '').trim();
if (!publicApiUrl || /localhost|127\.0\.0\.1/i.test(publicApiUrl)) {
  console.warn('[iis-package][WARN] PUBLIC_API_URL is still local/empty. Before production use, set it to the final HTTPS IIS URL and rebuild client runtime config.');
}

const stamp = timestamp();
const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'site-release-manager-iis-'));
const packageRoot = path.join(tempBase, 'site-release-manager-iis');
fs.mkdirSync(packageRoot, { recursive: true });

for (const rel of ['index.js', 'web.config', 'package.json', '.env', '.env.example', '.env.iis.example']) {
  if (fs.existsSync(path.join(root, rel))) copyFile(rel, packageRoot);
}

copyDir('server/src', packageRoot);
copyFile('server/package.json', packageRoot);
copyDir('server/node_modules', packageRoot);
copyDir('client/dist', packageRoot);
copyDir('sharepoint-deployer/client/dist', packageRoot);
copyDir('storage', packageRoot);

const runtimeDir = path.join(packageRoot, 'runtime');
fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(process.execPath, path.join(runtimeDir, 'node.exe'));

const readme = `SITE RELEASE MANAGER — IIS PACKAGE\n\nGenerated: ${new Date().toISOString()}\nSource project: ${root}\nNode runtime copied from: ${process.execPath}\nPUBLIC_API_URL at packaging time: ${publicApiUrl || '(empty)'}\n\nIIS METHOD (same topology that worked previously):\n1. Extract this package to the final IIS physical folder.\n2. IIS must have IISNode + URL Rewrite installed.\n3. Point the IIS Site/Application physical path at this folder.\n4. Application Pool: No Managed Code.\n5. web.config maps index.js to IISNode and rewrites non-file requests to index.js.\n6. web.config uses bundled runtime\\node.exe, so IIS does not depend on PATH.\n7. .env stays in the root and is loaded by server/src/config.js.\n8. Ensure MongoDB is reachable using MONGO_URI from .env.\n9. For SharePoint-hosted UI, PUBLIC_API_URL must be the HTTPS IIS URL reachable by the browser.\n10. Upload sharepoint-deployer\\client\\dist to the configured SharePoint deployer location.\n\nQuick checks after IIS start:\n- <IIS-URL>/api/health -> {\\"ok\\":true}\n- <IIS-URL>/api/config -> JSON\n- <IIS-URL>/ -> Release Manager UI (if using IIS-hosted UI)\n\nDo not expose .env/server/storage/node_modules directly; web.config hides them.\n`;
fs.writeFileSync(path.join(packageRoot, 'IIS-DEPLOY-README.txt'), readme, 'utf8');

const verifyRequired = [
  'index.js',
  'web.config',
  '.env',
  'runtime/node.exe',
  'server/src/app.js',
  'server/node_modules/express/package.json',
  'client/dist/index.html',
  'client/dist/release-manager-runtime-config.json',
  'client/dist/release-manager-runtime-config.txt',
  'sharepoint-deployer/client/dist/index.html',
];
const packageMissing = verifyRequired.filter((rel) => !fs.existsSync(path.join(packageRoot, rel)));
if (packageMissing.length) {
  console.error('[iis-package] Staging verification failed:', packageMissing.join(', '));
  process.exit(1);
}

const outputPath = path.resolve(root, '..', `site-release-manager-iis_${stamp}.7z`);
const sevenZip = find7Zip();
if (!sevenZip) {
  console.error('[iis-package] 7-Zip was not found. Expected C:\\Program Files\\7-Zip\\7z.exe or 7z in PATH.');
  console.error(`[iis-package] Staging folder remains available for manual compression: ${packageRoot}`);
  process.exit(1);
}

const result = spawnSync(sevenZip, ['a', '-t7z', '-mx=7', outputPath, packageRoot], {
  cwd: tempBase,
  stdio: 'inherit',
  shell: false,
});
if (result.error || result.status !== 0) {
  console.error(`[iis-package] 7-Zip failed with exit code ${result.status ?? 'unknown'}.`);
  process.exit(1);
}

console.log('');
console.log('IIS PACKAGE READY');
console.log(`File: ${outputPath}`);
console.log(`Node runtime: ${process.execPath}`);
console.log('Contains: IIS entry + web.config + server + Windows server/node_modules + client/dist + deployer dist + storage + .env');
