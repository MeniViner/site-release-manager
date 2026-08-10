import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv, readSimpleEnv } from './project-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'package.json',
  '.env.example',
  'scripts/dev.mjs',
  'scripts/verify-system.mjs',
  'scripts/write-client-runtime-config.mjs',
  'server/package.json',
  'server/src/index.js',
  'server/src/app.js',
  'server/src/config.js',
  'server/src/db.js',
  'server/src/services/jobQueue.js',
  'server/src/services/deploymentService.js',
  'server/src/services/runTelemetry.js',
  'server/src/routes/runs.js',
  'server/src/utils/versioning.js',
  'server/src/routes/releases.js',
  'client/package.json',
  'client/index.html',
  'client/src/main.jsx',
  'client/src/App.jsx',
  'client/src/RunsPage.jsx',
  'client/src/api.js',
  'client/src/releaseFolder.js',
  'sharepoint-deployer/package.json',
  'sharepoint-deployer/ready/index.html',
  'sharepoint-deployer/ready/app.js',
];

let failed = false;
console.log('=== Site Release Manager doctor ===');
for (const rel of requiredFiles) {
  const exists = fs.existsSync(path.join(root, rel));
  console.log(`${exists ? 'OK ' : 'MISS'} ${rel}`);
  if (!exists) failed = true;
}

for (const rel of ['client/node_modules', 'server/node_modules', 'sharepoint-deployer/node_modules']) {
  const exists = fs.existsSync(path.join(root, rel));
  console.log(`${exists ? 'OK ' : 'MISS'} ${rel}`);
  if (!exists) failed = true;
}

const envPath = ensureProjectEnv(root).envPath;
const env = readSimpleEnv(envPath);
const uri = String(env.MONGO_URI || 'mongodb://127.0.0.1:27017');
let mongoTarget = null;
try {
  const u = new URL(uri);
  mongoTarget = { host: u.hostname || '127.0.0.1', port: Number(u.port || 27017) };
} catch {}

if (mongoTarget) {
  const mongoOk = await new Promise((resolve) => {
    const socket = net.createConnection(mongoTarget);
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
  console.log(`${mongoOk ? 'OK ' : 'DOWN'} MongoDB ${mongoTarget.host}:${mongoTarget.port}`);
  if (!mongoOk) failed = true;
}

console.log(failed ? '\nDOCTOR FAILED — fix the MISS/DOWN rows above.' : '\nDOCTOR OK — source tree, dependencies and MongoDB are ready.');
process.exit(failed ? 1 : 0);
