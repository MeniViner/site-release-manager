/**
 * Run the full test suite against a THROWAWAY MongoDB.
 *
 * The database-backed tests skip when no scratch instance is configured, so
 * this script provides one. It never touches the project's own MongoDB data
 * directory or the configured MONGO_URI — a scratch dbpath under the OS temp
 * directory is used and removed afterwards.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SRM_TEST_MONGO_PORT || 27099);
const uri = `mongodb://127.0.0.1:${port}`;

const canConnect = () => new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const finish = (value) => { socket.destroy(); resolve(value); };
  socket.setTimeout(800);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function runTests(extraEnv) {
  const result = spawnSync(process.execPath, ['--test'], {
    cwd: path.join(root, 'server'),
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  return result.status ?? 1;
}

let child = null;
let dbPath = '';

if (await canConnect()) {
  console.log(`[test] Reusing the scratch MongoDB already listening on ${uri}`);
} else {
  const hasMongod = !spawnSync('mongod', ['--version'], { stdio: 'ignore' }).error;
  if (!hasMongod) {
    console.log('[test] mongod is not available; database-backed tests will be skipped.');
    process.exit(runTests({}));
  }
  dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-test-mongo-'));
  fs.mkdirSync(path.join(dbPath, 'data'), { recursive: true });
  console.log(`[test] Starting a scratch MongoDB on ${uri} (dbpath=${dbPath})`);
  child = spawn('mongod', [
    '--dbpath', path.join(dbPath, 'data'),
    '--port', String(port),
    '--bind_ip', '127.0.0.1',
    '--logpath', path.join(dbPath, 'mongod.log'),
  ], { stdio: 'ignore', detached: false });

  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline) {
    if (await canConnect()) { ready = true; break; }
    await wait(300);
  }
  if (!ready) {
    console.error('[test] The scratch MongoDB did not start; database-backed tests will be skipped.');
    child.kill('SIGTERM');
    child = null;
    process.exit(runTests({}));
  }
}

const status = runTests({ SRM_TEST_MONGO_URI: uri });

if (child) {
  child.kill('SIGTERM');
  await wait(500);
}
if (dbPath) fs.rmSync(dbPath, { recursive: true, force: true });
process.exit(status);
