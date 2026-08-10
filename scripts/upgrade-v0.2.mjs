import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const relative of ['builder-runtime', 'server/src/services/buildService.js', 'storage/builds']) {
  fs.rmSync(path.join(root, relative), { recursive: true, force: true });
}
fs.mkdirSync(path.join(root, 'storage', 'deployments'), { recursive: true });
console.log('Upgrade v0.2 complete: removed obsolete Site Builder build runtime and source-build service.');
