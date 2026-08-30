import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'ready');
// Keep the deployer output in the real project layout used on the closed network.
const target = path.join(root, 'client', 'dist');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

// The deployer runs the SAME provisioning pipeline as the in-page worker, so the
// shared contract modules ship alongside it instead of being reimplemented.
const shared = path.resolve(root, '..', 'shared');
fs.cpSync(shared, path.join(target, 'shared'), { recursive: true });

console.log(`SharePoint deployer copied to ${target}`);
console.log(`Shared deployment contracts copied to ${path.join(target, 'shared')}`);
