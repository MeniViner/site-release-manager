import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNpmInvocation } from './npm-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folders = ['client', 'server', 'sharepoint-deployer'];

for (const folder of folders) {
  console.log(`\n[install] ${folder}`);
  const npmCall = resolveNpmInvocation(['install']);
  const result = spawnSync(npmCall.command, npmCall.args, {
    cwd: path.join(root, folder),
    stdio: 'inherit',
    shell: npmCall.shell,
  });
  if (result.error) {
    console.error(`[install] Failed to start npm for ${folder}: ${result.error.message}`);
    console.error(`[install] Invocation: ${npmCall.description}`);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nAll project dependencies were installed.');
