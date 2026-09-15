#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = path.resolve(root, '..', 'site-release-manager-server-only');
const output = path.resolve(process.env.SERVER_ONLY_PACKAGE_DIR || defaultOutput);
const serverRoot = path.join(root, 'server');

if (fs.existsSync(output)) {
  throw new Error(`Refusing to overwrite ${output}. Choose an empty SERVER_ONLY_PACKAGE_DIR.`);
}

for (const required of ['index.cjs', 'web.config', '.env.iis.example', 'server/package.json', 'server/package-lock.json', 'server/src/app.js']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing required packaging input: ${required}`);
}

fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(serverRoot, 'src'), path.join(output, 'src'), { recursive: true, dereference: true });
fs.copyFileSync(path.join(serverRoot, 'package.json'), path.join(output, 'package.json'));
fs.copyFileSync(path.join(serverRoot, 'package-lock.json'), path.join(output, 'package-lock.json'));
fs.copyFileSync(path.join(root, '.env.iis.example'), path.join(output, '.env.example'));

const entry = `const { config, paths } = require('./src/config.js');
const { connectDb, closeDb } = require('./src/db.js');
const { createApp } = require('./src/app.js');
const { initializeQueue } = require('./src/services/jobQueue.js');

async function main() {
  await connectDb();
  await initializeQueue();
  const app = createApp();
  const server = app.listen(process.env.PORT || config.port || 4300, () => {
    console.log(\`Site Release Manager listening on \${typeof server.address() === 'string' ? server.address() : server.address().port}\`);
  });
  const shutdown = async () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

for (const dir of Object.values(paths)) require('node:fs').mkdirSync(dir, { recursive: true });
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
fs.writeFileSync(path.join(output, 'server.cjs'), entry);

let webConfig = fs.readFileSync(path.join(root, 'web.config'), 'utf8')
  .replaceAll('index.cjs', 'server.cjs')
  .replaceAll('server\\src', 'src');
webConfig = webConfig.replace('<add segment="server" />', '<add segment="server" />\n        <add segment="src" />');
fs.writeFileSync(path.join(output, 'web.config'), webConfig);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const install = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts'], {
  cwd: output,
  stdio: 'inherit',
  shell: false,
});
if (install.error || install.status !== 0) {
  throw new Error(`Could not install production dependencies (exit ${install.status ?? 'unknown'}).`);
}

if (process.platform === 'win32') {
  fs.mkdirSync(path.join(output, 'runtime'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(output, 'runtime', 'node.exe'));
}

const manifest = {
  artifact: 'site-release-manager-server-only',
  generatedAt: new Date().toISOString(),
  topology: 'flat-server-only-v1',
  included: ['server.cjs', 'web.config', 'package.json', 'package-lock.json', '.env.example', 'src/', 'node_modules/', ...(process.platform === 'win32' ? ['runtime/node.exe'] : [])],
  excluded: ['.env', 'storage/', 'releases/', 'deployments/', 'client/', 'sharepoint-deployer/', '.git/', 'test/', 'tests/', 'docs/'],
  runtimeStateToPreserve: ['.env', 'storage/'],
};
fs.writeFileSync(path.join(output, 'deployment-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(output, 'IIS-DEPLOY-README.txt'), `SITE RELEASE MANAGER — SERVER-ONLY IIS ARTIFACT

This artifact intentionally contains no frontend, SharePoint deployer, Mongo data, release state, storage, test files, Git metadata, or live .env.

WHITENING PROCEDURE
1. Stop the IIS application pool.
2. Preserve the existing .env and storage directory outside the replacement folder.
3. Replace only server.cjs, web.config, package.json, package-lock.json, src, node_modules, and (when supplied) runtime.
4. Restore the preserved .env and storage directory without copying .env.example over .env.
5. Start the app pool and check /api/health and /api/daily-data/v1/healthz with an authenticated request.

IIS REQUIREMENTS
- IISNode and URL Rewrite installed; app pool is No Managed Code.
- Enable Windows Authentication and disable Anonymous Authentication for the API application.
- IIS must remove any browser-provided ${'x-iisnode-auth_user'} and inject TRUSTED_IDENTITY_HEADER from the authenticated Windows principal.
- If TRUSTED_SITE_ACCESS_ENABLED=true, the same trusted IIS/reverse-proxy boundary must inject TRUSTED_SITE_ACCESS_HEADER as the exact comma-separated builderSiteId values the authenticated principal is authorized to use. Do not forward that header from the browser.

The generated package is flat: src and node_modules live directly beside server.cjs. This is deliberate so it can be whitened into the proven isolated IIS folder without the repository's server/ nesting.
`);

console.log(`SERVER-ONLY IIS ARTIFACT READY: ${output}`);
