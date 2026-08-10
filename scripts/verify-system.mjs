import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveNpmInvocation } from './npm-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const steps = [];
let failed = false;

function run(label, command, args, options = {}) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: 'inherit',
    shell: options.shell ?? false,
    env: process.env,
  });
  const ok = !result.error && result.status === 0;
  steps.push({ label, ok, status: result.status, error: result.error?.message || '' });
  if (!ok) failed = true;
  return ok;
}

const required = [
  'scripts/dev.mjs',
  'scripts/doctor.mjs',
  'scripts/write-client-runtime-config.mjs',
  'scripts/deploy-manager-sharepoint.mjs',
  'server/src/index.js',
  'server/src/routes/sites.js',
  'server/src/routes/releases.js',
  'server/src/services/jobQueue.js',
  'server/src/services/deploymentService.js',
  'server/src/services/runTelemetry.js',
  'server/src/routes/runs.js',
  'server/src/utils/versioning.js',
  'server/test/deploymentRuntime.test.js',
  'client/src/App.jsx',
  'client/src/RunsPage.jsx',
  'client/src/api.js',
  'sharepoint-deployer/ready/app.js',
];

console.log('=== Site Release Manager verify:system ===');
for (const rel of required) {
  const ok = fs.existsSync(path.join(root, rel));
  console.log(`${ok ? 'PASS' : 'FAIL'} file ${rel}`);
  if (!ok) failed = true;
}

run('Doctor: source, dependencies and MongoDB', process.execPath, ['scripts/doctor.mjs']);
function runNpm(label, args) {
  const npmCall = resolveNpmInvocation(args);
  return run(label, npmCall.command, npmCall.args, { shell: npmCall.shell });
}

runNpm('Server tests', ['--prefix', 'server', 'test']);
runNpm('Client production build', ['--prefix', 'client', 'run', 'build']);
runNpm('SharePoint deployer build', ['--prefix', 'sharepoint-deployer', 'run', 'build']);


for (const [rel, label] of [
  ['client/dist/index.html', 'Client dist index'],
  ['client/dist/release-manager-runtime-config.json', 'Client runtime API config JSON'],
  ['client/dist/release-manager-runtime-config.txt', 'Client runtime API config TXT fallback'],
  ['client/dist/release-manager-build-diagnostics.txt', 'Client build diagnostics'],
  ['sharepoint-deployer/client/dist/index.html', 'SharePoint Deployer index'],
  ['sharepoint-deployer/client/dist/app.js', 'SharePoint Deployer app'],
]) {
  const ok = fs.existsSync(path.join(root, rel));
  console.log(`${ok ? 'PASS' : 'FAIL'} artifact ${label}: ${rel}`);
  if (!ok) failed = true;
}

for (const rel of [
  'server/src/routes/sites.js',
  'server/src/routes/releases.js',
  'server/src/services/jobQueue.js',
  'server/src/services/deploymentService.js',
  'server/src/services/runTelemetry.js',
  'server/src/routes/runs.js',
  'server/src/utils/versioning.js',
  'server/test/deploymentRuntime.test.js',
  'scripts/dev.mjs',
  'scripts/doctor.mjs',
  'scripts/write-client-runtime-config.mjs',
  'scripts/deploy-manager-sharepoint.mjs',
  'scripts/mongo.mjs',
]) {
  run(`Syntax ${rel}`, process.execPath, ['--check', rel]);
}


console.log('\n=== Closed-Windows SharePoint configuration checks ===');
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const clientPackage = JSON.parse(fs.readFileSync(path.join(root, 'client', 'package.json'), 'utf8'));
const appSource = fs.readFileSync(path.join(root, 'client', 'src', 'App.jsx'), 'utf8');
const viteSource = fs.readFileSync(path.join(root, 'client', 'vite.config.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'client', 'src', 'main.jsx'), 'utf8');
const deploySource = fs.readFileSync(path.join(root, 'scripts', 'deploy-manager-sharepoint.mjs'), 'utf8');
for (const [label, ok] of [
  ['Root/client versions match', rootPackage.version === clientPackage.version],
  ['Sidebar version is dynamic', appSource.includes('clientPackage.version') && !appSource.includes('Site Release Manager 0.3.0')],
  ['Vite base is relative', /base:\s*['"]\.\/['"]/.test(viteSource)],
  ['HashRouter is used', mainSource.includes('HashRouter') && !mainSource.includes('BrowserRouter')],
  ['SharePoint index copy uses Node retry path', deploySource.includes('copyFileSync') && !deploySource.includes("'index.html last'")],
  ['sharepoint:local script exists', Boolean(rootPackage.scripts?.['sharepoint:local'])],
  ['sharepoint:test script exists', Boolean(rootPackage.scripts?.['sharepoint:test'])],
]) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}

console.log('\n=== SUMMARY ===');
for (const step of steps) console.log(`${step.ok ? 'PASS' : 'FAIL'} ${step.label}`);
console.log(failed ? '\nVERIFY SYSTEM FAILED' : '\nVERIFY SYSTEM PASSED');
process.exit(failed ? 1 : 0);
