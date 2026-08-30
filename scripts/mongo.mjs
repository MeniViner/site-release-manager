import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv, readSimpleEnv } from './project-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = ensureProjectEnv(root).envPath;
const env = { ...readSimpleEnv(envPath), ...process.env };
const mongoUri = String(env.MONGO_URI || 'mongodb://127.0.0.1:27017');
const autoStart = String(env.AUTO_START_MONGO ?? 'true').trim().toLowerCase() !== 'false';
const startTimeoutMs = Number(env.MONGO_START_TIMEOUT_MS || 15000);

function parseMongoTarget(uri) {
  if (!uri.startsWith('mongodb://')) return null;
  const authority = uri.slice('mongodb://'.length).split('/')[0].split('@').pop();
  const firstHost = String(authority || '').split(',')[0].trim();
  if (!firstHost) return null;

  if (firstHost.startsWith('[')) {
    const end = firstHost.indexOf(']');
    if (end < 0) return null;
    const host = firstHost.slice(1, end);
    const port = Number(firstHost.slice(end + 1).replace(/^:/, '') || 27017);
    return { host, port };
  }

  const separator = firstHost.lastIndexOf(':');
  if (separator > 0 && firstHost.indexOf(':') === separator) {
    return {
      host: firstHost.slice(0, separator),
      port: Number(firstHost.slice(separator + 1) || 27017),
    };
  }
  return { host: firstHost, port: 27017 };
}

function canConnect({ host, port }, timeoutMs = 900) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function hasCommand(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: false });
  return !result.error && result.status === 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMongo(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(target, 700)) return true;
    await wait(500);
  }
  return false;
}

function localMongoPaths() {
  const base = path.join(root, 'storage', 'mongodb');
  return {
    base,
    data: path.join(base, 'data'),
    log: path.join(base, 'mongod.log'),
    pid: path.join(base, 'mongod.pid'),
  };
}

async function startMongo() {
  const target = parseMongoTarget(mongoUri);
  if (!target) {
    console.log(`[mongo] External or unsupported Mongo URI configured: ${mongoUri}`);
    return true;
  }

  if (await canConnect(target)) {
    console.log(`[mongo] MongoDB is already running at ${target.host}:${target.port}`);
    return true;
  }

  if (!autoStart) {
    // AUTO_START_MONGO=false is the correct setting on the closed Windows
    // workstation, where MongoDB runs as a service. Never imply that the
    // mongod executable is missing: that is a different problem entirely.
    console.error(`[mongo] MongoDB is not reachable at ${target.host}:${target.port}.`);
    console.error('[mongo] AUTO_START_MONGO=false, so this project will not start a mongod of its own.');
    console.error('[mongo] If MongoDB is installed as a Windows service:');
    console.error('[mongo]   sc query MongoDB      (check the service)');
    console.error('[mongo]   net start MongoDB     (start it)');
    console.error('[mongo] Otherwise set AUTO_START_MONGO=true to let this project run a project-local mongod.');
    return false;
  }

  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!localHosts.has(target.host)) {
    console.error(`[mongo] MongoDB is not reachable at ${target.host}:${target.port}. Automatic start is supported only for localhost.`);
    return false;
  }

  if (!hasCommand('mongod')) {
    console.error('\n[mongo] MongoDB Server is not installed or mongod is not in PATH.');
    if (process.platform === 'darwin') {
      console.error('Install it once on macOS:');
      console.error('  brew tap mongodb/brew');
      console.error('  brew install mongodb-community@8.0');
      console.error('Then run npm run dev again. The project will start MongoDB automatically.');
    } else {
      console.error('Install MongoDB Community Server, ensure mongod is in PATH, then run npm run dev again.');
    }
    return false;
  }

  const mongoPaths = localMongoPaths();
  fs.mkdirSync(mongoPaths.data, { recursive: true });
  fs.mkdirSync(mongoPaths.base, { recursive: true });

  console.log(`[mongo] Starting project-local MongoDB at ${target.host}:${target.port}...`);
  const child = spawn('mongod', [
    '--dbpath', mongoPaths.data,
    '--bind_ip', target.host === 'localhost' ? '127.0.0.1' : target.host,
    '--port', String(target.port),
    '--logpath', mongoPaths.log,
    '--logappend',
    '--pidfilepath', mongoPaths.pid,
  ], {
    detached: true,
    stdio: 'ignore',
    shell: false,
  });
  child.unref();

  const ready = await waitForMongo(target, startTimeoutMs);
  if (!ready) {
    console.error(`[mongo] MongoDB did not become ready within ${startTimeoutMs}ms.`);
    console.error(`[mongo] Log: ${mongoPaths.log}`);
    return false;
  }

  console.log('[mongo] MongoDB started successfully.');
  return true;
}

async function checkMongo() {
  const target = parseMongoTarget(mongoUri);
  if (!target) {
    console.log(`[mongo] URI configured: ${mongoUri}`);
    return true;
  }
  const ok = await canConnect(target);
  console.log(ok
    ? `[mongo] OK — ${target.host}:${target.port} is reachable.`
    : `[mongo] DOWN — ${target.host}:${target.port} is not reachable.`);
  return ok;
}

async function stopMongo() {
  const target = parseMongoTarget(mongoUri);
  if (!target) {
    console.error('[mongo] Stop is available only for a local mongodb:// URI.');
    return false;
  }
  if (!(await canConnect(target))) {
    console.log('[mongo] MongoDB is already stopped.');
    return true;
  }
  if (!hasCommand('mongod')) {
    console.error('[mongo] mongod is not in PATH.');
    return false;
  }

  const mongoPaths = localMongoPaths();
  const result = spawnSync('mongod', ['--shutdown', '--dbpath', mongoPaths.data], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    console.error('[mongo] Could not stop the project-local MongoDB. It may be managed by brew services or another service manager.');
    return false;
  }
  console.log('[mongo] MongoDB stopped.');
  return true;
}

const command = process.argv[2] || 'check';
let ok = false;
if (command === 'start') ok = await startMongo();
else if (command === 'check') ok = await checkMongo();
else if (command === 'stop') ok = await stopMongo();
else {
  console.error(`Unknown mongo command: ${command}`);
  process.exit(2);
}
process.exit(ok ? 0 : 1);
