import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

export const DEPLOYMENT_OVERLAY_FILES = new Set([
  'sitebuilder-runtime-config.json',
  'sitebuilder-deployment.json',
  'sharepoint-deploy-manifest.json',
]);

const LOCAL_FILES = new Set(['.DS_Store', 'Thumbs.db']);

export function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

export function removeDirectory(directory) {
  if (!directory) return;
  fs.rmSync(directory, { recursive: true, force: true });
}

export function normalizeRelativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

export function isSafeRelativePath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) return false;
  const normalized = normalizeRelativePath(raw);
  if (!normalized) return false;
  const parts = normalized.split('/').filter(Boolean);
  return !parts.some((part) => part === '..' || part === '.');
}

export function distExclusionReason(value) {
  const normalized = normalizeRelativePath(value);
  if (!normalized) return 'נתיב ריק';
  const leaf = normalized.split('/').filter(Boolean).at(-1) || '';
  if (LOCAL_FILES.has(leaf)) return 'קובץ מערכת מקומי';
  if (DEPLOYMENT_OVERLAY_FILES.has(normalized)) return 'קובץ זה נוצר מחדש לכל אתר בזמן הפריסה';
  return '';
}

export function safeResolve(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) throw new Error('Unsafe relative path.');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalizeRelativePath(relativePath));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Path escapes the allowed root.');
  }
  return resolved;
}

export function extractReleaseZip(zipPath, destination) {
  ensureDirectory(destination);
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error('The ZIP is empty.');

  for (const entry of entries) {
    const relative = normalizeRelativePath(entry.entryName);
    if (!relative) continue;
    if (!isSafeRelativePath(relative)) throw new Error(`Unsafe ZIP path: ${entry.entryName}`);
    const target = safeResolve(destination, relative);
    if (entry.isDirectory) {
      ensureDirectory(target);
      continue;
    }
    ensureDirectory(path.dirname(target));
    fs.writeFileSync(target, entry.getData());
  }
}

function hasBuiltDistShape(directory) {
  if (!fs.existsSync(path.join(directory, 'index.html'))) return false;
  const assets = path.join(directory, 'assets');
  if (!fs.existsSync(assets) || !fs.statSync(assets).isDirectory()) return false;
  return collectFiles(assets).some((file) => /\.js$/i.test(file.path));
}

export function findDistRoot(root) {
  const candidates = [root, path.join(root, 'dist')];
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(root, entry.name);
      candidates.push(child, path.join(child, 'dist'));
    }
  }
  const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() && hasBuiltDistShape(candidate));
  if (!found) {
    throw new Error('לא נמצאה תיקיית dist תקינה. נדרשים index.html ותיקיית assets עם קובץ JavaScript.');
  }
  return found;
}

export function copyDistWithoutDeploymentOverlay(source, destination) {
  ensureDirectory(destination);
  for (const file of collectFiles(source)) {
    if (distExclusionReason(file.path)) continue;
    const target = safeResolve(destination, file.path);
    ensureDirectory(path.dirname(target));
    fs.copyFileSync(path.join(source, ...file.path.split('/')), target);
  }
}

export function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function directoryStats(root) {
  let fileCount = 0;
  let totalBytes = 0;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        fileCount += 1;
        totalBytes += fs.statSync(full).size;
      }
    }
  };
  walk(root);
  return { fileCount, totalBytes };
}

export function collectFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          size: fs.statSync(full).size,
          sha256: hashFile(full),
        });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function hashDirectory(root) {
  const hash = crypto.createHash('sha256');
  for (const file of collectFiles(root)) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(String(file.size));
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}
