import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv, readSimpleEnv } from './project-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appVersion = String(packageInfo.version || 'unknown');
const distDir = path.join(root, 'client', 'dist');
if (!fs.existsSync(distDir)) {
  throw new Error(`client/dist does not exist: ${distDir}`);
}

const envPath = ensureProjectEnv(root).envPath;
const env = readSimpleEnv(envPath);
const configured = String(env.PUBLIC_API_URL || '').trim().replace(/\/+$/g, '');
const apiBaseUrl = configured || 'same-origin';

if (apiBaseUrl !== 'same-origin') {
  let parsed;
  try { parsed = new URL(apiBaseUrl); } catch { throw new Error(`PUBLIC_API_URL is invalid: ${apiBaseUrl}`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PUBLIC_API_URL must use HTTP(S).');
}

const payload = {
  schemaVersion: 1,
  apiBaseUrl,
  generatedAt: new Date().toISOString(),
  generatedBy: 'site-release-manager-build',
  appVersion,
};
const serialized = `${JSON.stringify(payload, null, 2)}\n`;

const jsonTarget = path.join(distDir, 'release-manager-runtime-config.json');
const txtTarget = path.join(distDir, 'release-manager-runtime-config.txt');
fs.writeFileSync(jsonTarget, serialized, 'utf8');
fs.writeFileSync(txtTarget, serialized, 'utf8');

const diagnosticTarget = path.join(distDir, 'release-manager-build-diagnostics.txt');
fs.writeFileSync(diagnosticTarget, [
  `generatedAt=${payload.generatedAt}`,
  `appVersion=${appVersion}`,
  `apiBaseUrl=${apiBaseUrl}`,
  'viteBase=./',
  'router=HashRouter',
  'runtimeConfigPrimary=release-manager-runtime-config.txt',
  'runtimeConfigFallback=release-manager-runtime-config.json',
  'localSharePointApiCommand=npm run sharepoint:local',
].join('\n') + '\n', 'utf8');

console.log(`[runtime-config] ${jsonTarget}`);
console.log(`[runtime-config] ${txtTarget}`);
console.log(`[runtime-config] apiBaseUrl=${apiBaseUrl}`);
console.log('[runtime-config] SharePoint-safe TXT fallback generated.');
