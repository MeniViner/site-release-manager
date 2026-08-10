import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv } from './project-env.mjs';
import { resolveNpmInvocation } from './npm-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const includeDeployer = process.argv.includes('--all');
const apiOnly = process.argv.includes('--api-only');
const children = [];

ensureProjectEnv(root);

for (const required of ['server/src/index.js', 'client/index.html', 'client/src/main.jsx']) {
  const fullPath = path.join(root, required);
  if (!fs.existsSync(fullPath)) {
    console.error(`[dev] Missing required project file: ${fullPath}`);
    console.error('[dev] Apply the full source repair package; npm install cannot recreate missing source files.');
    process.exit(1);
  }
}

const mongoResult = spawnSync(process.execPath, [path.join(root, 'scripts', 'mongo.mjs'), 'start'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});
if (mongoResult.status !== 0) {
  console.error('\n[dev] Development stack was not started because MongoDB is unavailable.');
  process.exit(mongoResult.status ?? 1);
}

function start(name, cwd, args) {
  const npmCall = resolveNpmInvocation(args);
  console.log(`[dev] Starting ${name}: npm ${args.join(' ')}`);
  const child = spawn(npmCall.command, npmCall.args, {
    cwd,
    stdio: 'inherit',
    shell: npmCall.shell,
  });
  child.on('error', (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    console.error(`[${name}] invocation: ${npmCall.description}`);
    stopAll(1);
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      stopAll(code);
    }
  });
  children.push(child);
}

function stopAll(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

start('server', path.join(root, 'server'), ['run', 'dev']);
if (apiOnly) {
  console.log('[dev] SharePoint local-test API mode is active. Keep this terminal open while the UI is running from SharePoint.');
  console.log('[dev] Expected API: http://127.0.0.1:4300/api/health');
} else {
  start('client', path.join(root, 'client'), ['run', 'dev']);
  if (includeDeployer) start('deployer', path.join(root, 'sharepoint-deployer'), ['run', 'dev']);
}
