import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [
  ['IIS entry', 'index.js'],
  ['IIS config', 'web.config'],
  ['Environment', '.env'],
  ['Server dependencies', 'server/node_modules/express/package.json'],
  ['Client build', 'client/dist/index.html'],
  ['Client runtime API config', 'client/dist/release-manager-runtime-config.json'],
  ['Client runtime API config TXT fallback', 'client/dist/release-manager-runtime-config.txt'],
  ['SharePoint deployer build', 'sharepoint-deployer/client/dist/index.html'],
];
let failed = 0;
for (const [label, rel] of checks) {
  const ok = fs.existsSync(path.join(root, rel));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${rel}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log('IIS SOURCE READY FOR PACKAGING');
