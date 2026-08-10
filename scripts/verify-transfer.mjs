import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv, readSimpleEnv } from './project-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = ensureProjectEnv(root).envPath;
const env = readSimpleEnv(envPath);
const errors = [];
const warnings = [];
const full = (relative) => path.join(root, relative);
const exists = (relative) => fs.existsSync(full(relative));
const requirePath = (relative, description = relative) => { if (!exists(relative)) errors.push(`חסר: ${description} (${relative})`); };
const requireNonEmptyDirectory = (relative, description = relative) => { const value = full(relative); if (!fs.existsSync(value) || !fs.statSync(value).isDirectory() || fs.readdirSync(value).length === 0) errors.push(`התיקייה חסרה או ריקה: ${description} (${relative})`); };

requirePath('.env', '.env');
requirePath('client/dist/index.html', 'Build של ממשק הניהול');
requirePath('client/dist/release-manager-runtime-config.json', 'Runtime API config JSON של ממשק הניהול');
requirePath('client/dist/release-manager-runtime-config.txt', 'Runtime API config TXT fallback של ממשק הניהול');
requirePath('client/dist/release-manager-build-diagnostics.txt', 'Build diagnostics של ממשק הניהול');
requirePath('sharepoint-deployer/client/dist/index.html', 'SharePoint Deployer');
requirePath('sharepoint-deployer/client/dist/app.js', 'קוד SharePoint Deployer');
requireNonEmptyDirectory('server/node_modules', 'תלויות השרת');

const publicApiUrl = String(env.PUBLIC_API_URL || '').trim();
if (!publicApiUrl) errors.push('PUBLIC_API_URL חסר ב-.env');
else if (/^http:\/\/(localhost|127\.0\.0\.1)/i.test(publicApiUrl)) warnings.push('PUBLIC_API_URL עדיין מקומי. לפני SharePoint יש להגדיר כתובת HTTPS נגישה מתוך הרשת הסגורה.');
else if (!/^https:\/\//i.test(publicApiUrl)) warnings.push('PUBLIC_API_URL אינו HTTPS; דף SharePoint עלול לחסום אותו כ-Mixed Content.');

const hosts = String(env.SHAREPOINT_HOSTS || '').split(',').map((value) => value.trim()).filter(Boolean);
if (hosts.length === 0) errors.push('SHAREPOINT_HOSTS ריק.');

console.log('\n=== Site Release Manager transfer verification ===');
console.log(`Platform: ${process.platform}/${process.arch}`);
console.log(`Node: ${process.version}`);
console.log(`SharePoint hosts: ${hosts.join(', ') || '—'}`);
console.log(`PUBLIC_API_URL: ${publicApiUrl || '—'}`);
console.log('Site Builder build tooling: not required (releases are universal dist artifacts).');
if (warnings.length) { console.log('\nWarnings:'); for (const warning of warnings) console.log(`- ${warning}`); }
if (errors.length) { console.error('\nFAILED:'); for (const error of errors) console.error(`- ${error}`); process.exit(1); }
console.log('\nREADY: החבילה כוללת את כל רכיבי Release Manager הנדרשים.');
