#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
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

for (const required of ['web.config', '.env.iis.example', 'server/package.json', 'server/package-lock.json', 'server/src/index.js', 'server/src/app.js']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing required packaging input: ${required}`);
}

fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(serverRoot, 'src'), path.join(output, 'src'), { recursive: true, dereference: true });
fs.copyFileSync(path.join(serverRoot, 'package.json'), path.join(output, 'package.json'));
fs.copyFileSync(path.join(serverRoot, 'package-lock.json'), path.join(output, 'package-lock.json'));
fs.copyFileSync(path.join(root, '.env.iis.example'), path.join(output, '.env.example'));
fs.writeFileSync(
  path.join(output, 'index.cjs'),
  "// IIS handler wrapper; all startup logic lives in src/index.js.\nrequire('./src/index.js');\n",
);

const webConfig = fs.readFileSync(path.join(root, 'web.config'), 'utf8')
  .replaceAll('server\\src', 'src')
  .replace('<add segment="server" />', '<add segment="server" />\n          <add segment="src" />');
fs.writeFileSync(path.join(output, 'web.config'), webConfig);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const install = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts'], {
  cwd: output,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, npm_config_engine_strict: 'true' },
});
if (install.error || install.status !== 0) {
  throw new Error(`Could not install production dependencies (exit ${install.status ?? 'unknown'}).`);
}

if (process.platform === 'win32' && path.extname(process.execPath).toLowerCase() === '.exe') {
  fs.mkdirSync(path.join(output, 'runtime'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(output, 'runtime', 'node.exe'));
}

fs.writeFileSync(path.join(output, 'IIS-DEPLOY-README.txt'), `SITE RELEASE MANAGER — SERVER-ONLY IIS ARTIFACT

This artifact intentionally contains no frontend, SharePoint deployer, Mongo data, release state, storage, test files, Git metadata, or live .env.

WHITENING PROCEDURE
1. Stop the IIS application pool.
2. Preserve the existing .env and storage directory outside the replacement folder.
3. Replace only index.cjs, web.config, package.json, package-lock.json, src, node_modules, deployment-manifest.json, and (when supplied) runtime.
4. Restore the preserved .env and storage directory without copying .env.example over .env.
5. Start the app pool and check /api/health and /api/daily-data/v1/healthz with an authenticated request.

IIS REQUIREMENTS
- IISNode and URL Rewrite installed; app pool is No Managed Code.
- Set NODE_ENV=production in the preserved .env.

AUTHENTICATION IS ROUTE-SPECIFIC — DO NOT ENABLE WINDOWS AUTH SITE-WIDE.
The shipped web.config already declares this; it is executable configuration,
not advice. Blanket Windows Authentication would challenge Bearer-authorized
management calls and turn an ordinary click into a native credential dialog.

  application baseline ............ Anonymous ON,  Windows OFF
  /api/auth/session ............... Anonymous OFF, Windows ON   (the only challenge point)
  /api/daily-data/v1/sites/* ...... Anonymous OFF, Windows ON   (end-user data)
  /api/health, /api/config ........ anonymous
  /api/daily-data/v1/healthz,readyz anonymous (Site Builder's deploy gate needs this)

  This is NOT anonymous management. Every consequential mutation — site
  create/update/delete/deploy, release upload/update/delete, data-access —
  requires a signed management session inside the application.

- allowedServerVariables MUST contain HTTP_X_IISNODE_AUTH_USER and
  HTTP_X_IISNODE_SHAREPOINT_SITES. URL Rewrite silently refuses to set a server
  variable that is not allow-listed; the trusted header then stays EMPTY and
  every management session is refused with no obvious cause.
- IIS must overwrite any browser-provided x-iisnode-auth-user with the
  authenticated Windows principal. HTTP_X_IISNODE_AUTH_USER maps to
  x-iisnode-auth-user (URL Rewrite turns underscores into hyphens).
- MANAGEMENT_SESSION_SECRET is REQUIRED in production (32+ chars). Generate it
  with a cryptographic generator, NOT Get-Random:
      $bytes = [byte[]]::new(48)
      [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      [Convert]::ToBase64String($bytes)
- Integrated Windows Authentication must be accepted silently for the internal
  URL (domain policy / browser intranet-zone / SPN prerequisite). If it is not,
  stop: a native credential prompt is not application acceptance.
- The generated web.config intentionally has no <iisnode> section. IISNode
  installation and runtime selection remain environment prerequisites.

OFFLINE DEPENDENCIES
node_modules ships inside this artifact, resolved on the build machine. There is
no registry in the closed environment, so npm ci is not a recovery plan. The
deployment manifest records windowsDependencyCompatibilityValidated=false when
the build host is not Windows. If a dependency needs a native Windows build,
either rebuild the artifact on Windows, or use an approved internal registry
mirror, or carry an npm cache and run
  npm ci --omit=dev --offline --cache <carried-cache>
Record which route was used in the acceptance report.

ACCEPTANCE
Follow docs/WINDOWS_ACCEPTANCE_CHECKLIST.md in the repository — it is the
canonical entry point — starting with the authentication topology in
docs/WINDOWS_IIS_ACCEPTANCE.md.

The generated package is flat. src/index.js contains the single startup implementation. index.cjs is only the IIS handler wrapper so src can remain blocked from direct HTTP access.
`);

const dependencyProbe = spawnSync(npm, ['ls', '--omit=dev', '--all', '--json'], {
  cwd: output,
  encoding: 'utf8',
  shell: false,
});
if (dependencyProbe.error || dependencyProbe.status !== 0) {
  throw new Error(`Production dependency graph is incomplete:\n${dependencyProbe.stderr || dependencyProbe.stdout}`);
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else if (entry.name !== 'deployment-manifest.json') {
      files.push({
        path: path.relative(output, absolute).split(path.sep).join('/'),
        size: fs.statSync(absolute).size,
        sha256: sha256(absolute),
      });
    }
  }
}
collect(output);
files.sort((a, b) => a.path.localeCompare(b.path));
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false });
const manifest = {
  artifact: 'site-release-manager-server-only',
  generatedAt: new Date().toISOString(),
  topology: 'flat-server-only-v2',
  sourceCommit: git.status === 0 ? git.stdout.trim() : 'unknown',
  buildPlatform: { platform: process.platform, arch: process.arch, node: process.version },
  windowsRuntimeIncluded: files.some((file) => file.path === 'runtime/node.exe'),
  windowsDependencyCompatibilityValidated: process.platform === 'win32',
  packageLockSha256: sha256(path.join(output, 'package-lock.json')),
  startupEntry: 'src/index.js',
  iisHandlerWrapper: 'index.cjs',
  included: ['index.cjs', 'web.config', 'package.json', 'package-lock.json', '.env.example', 'src/', 'node_modules/', ...(process.platform === 'win32' ? ['runtime/node.exe'] : [])],
  excluded: ['.env', 'storage/', 'releases/', 'deployments/', 'client/', 'sharepoint-deployer/', '.git/', 'test/', 'tests/', 'docs/'],
  runtimeStateToPreserve: ['.env', 'storage/'],
  files,
};
fs.writeFileSync(path.join(output, 'deployment-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`SERVER-ONLY IIS ARTIFACT READY: ${output}`);
