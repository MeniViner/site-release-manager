import fs from 'node:fs';
import path from 'node:path';

export function ensureProjectEnv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  const examplePath = path.join(rootDir, '.env.example');

  if (fs.existsSync(envPath)) return { created: false, envPath };
  if (!fs.existsSync(examplePath)) {
    throw new Error(`Missing env template: ${examplePath}`);
  }

  fs.copyFileSync(examplePath, envPath);
  console.log('[setup] Created .env from .env.example');
  return { created: true, envPath };
}

export function readSimpleEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}
