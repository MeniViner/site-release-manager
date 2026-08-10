import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProjectEnv } from './project-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
ensureProjectEnv(root);
console.log('[setup] Project setup completed.');
