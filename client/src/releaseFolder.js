const OVERLAY_FILES = new Set([
  'sitebuilder-runtime-config.json',
  'sitebuilder-deployment.json',
]);
const DIST_DIRECTORY_NAMES = ['dist-universal', 'dist'];
const isDistDirectoryName = (value) => DIST_DIRECTORY_NAMES.includes(String(value || '').toLowerCase());
const LOCAL_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');

export function distExclusionReason(value) {
  const normalized = normalizePath(value);
  const leaf = normalized.split('/').filter(Boolean).at(-1) || '';
  if (LOCAL_FILES.has(leaf)) return 'קובץ מערכת מקומי';
  if (OVERLAY_FILES.has(normalized)) return 'נוצר מחדש אוטומטית לכל אתר בזמן הפריסה';
  return '';
}

function pathParts(value) {
  return normalizePath(value).split('/').filter(Boolean);
}

function detectDistPrefix(items) {
  const paths = items.map((item) => normalizePath(item.originalPath)).filter(Boolean);
  const withDirectoryPaths = paths.filter((value) => value.includes('/'));
  if (!withDirectoryPaths.length) {
    throw new Error('הדפדפן לא החזיר נתיבי תיקייה. פתח את המערכת ב-Chrome/Safari רגיל ובחר שוב את תיקיית dist-universal. בדפדפן המשובץ של VS Code בחירת תיקייה עלולה לא לעבוד.');
  }

  // Selecting dist-universal/dist directly normally yields: <folder>/index.html, <folder>/assets/...
  for (const directoryName of DIST_DIRECTORY_NAMES) {
    if (withDirectoryPaths.some((value) => pathParts(value)[0]?.toLowerCase() === directoryName)) {
      return { prefix: `${directoryName}/`, detectedFromProjectRoot: false, sourceDirectoryName: directoryName };
    }
  }

  // Selecting project root yields: <project>/dist-universal/index.html (preferred) or <project>/dist/index.html.
  for (const directoryName of DIST_DIRECTORY_NAMES) {
    const candidate = withDirectoryPaths.find((value) => {
      const parts = pathParts(value);
      return parts.length >= 3 && parts[1]?.toLowerCase() === directoryName;
    });
    if (candidate) {
      const rootName = pathParts(candidate)[0];
      return { prefix: `${rootName}/${directoryName}/`, detectedFromProjectRoot: true, sourceDirectoryName: directoryName };
    }
  }

  throw new Error('לא נמצאה תיקיית dist-universal או dist ישירות בתיקייה שנבחרה. לריליס חדש מומלץ לבחור את dist-universal שנוצרה ע״י npm run build:universal.');
}
function normalizeSelectedFiles(fileList) {
  const all = Array.from(fileList || []);
  if (!all.length) throw new Error('לא התקבלו קבצים מבחירת התיקייה.');

  const withPaths = all.map((file) => ({
    file,
    originalPath: normalizePath(file.webkitRelativePath || file.relativePath || ''),
  }));
  const { prefix, detectedFromProjectRoot, sourceDirectoryName } = detectDistPrefix(withPaths);

  const files = [];
  const excluded = [];
  for (const item of withPaths) {
    if (!item.originalPath.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const relativePath = item.originalPath.slice(prefix.length);
    if (!relativePath) continue;
    const reason = distExclusionReason(relativePath);
    if (reason) {
      excluded.push({ path: relativePath, reason, isDirectory: false });
      continue;
    }
    files.push({ file: item.file, path: relativePath, size: item.file.size });
  }

  return {
    kind: 'folder',
    rootName: sourceDirectoryName || 'dist-universal',
    files,
    excluded,
    detectedFromProjectRoot,
  };
}

export function collectSelectedFolder(fileList) {
  return normalizeSelectedFiles(fileList);
}

const readFileEntry = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
const readDirectoryBatch = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
async function readAllDirectoryEntries(directoryEntry) {
  const reader = directoryEntry.createReader();
  const entries = [];
  for (;;) {
    const batch = await readDirectoryBatch(reader);
    if (!batch.length) return entries;
    entries.push(...batch);
  }
}

async function walkEntry(entry, parentPath, result) {
  const relativePath = normalizePath(parentPath ? `${parentPath}/${entry.name}` : entry.name);
  if (entry.isDirectory) {
    const children = await readAllDirectoryEntries(entry);
    for (const child of children) await walkEntry(child, relativePath, result);
    return;
  }
  if (!entry.isFile) return;
  const parts = pathParts(relativePath);
  const distIndex = parts.findIndex((part) => isDistDirectoryName(part));
  const path = distIndex >= 0 ? parts.slice(distIndex + 1).join('/') : relativePath;
  if (!path) return;
  const reason = distExclusionReason(path);
  if (reason) {
    result.excluded.push({ path, reason, isDirectory: false });
    return;
  }
  const file = await readFileEntry(entry);
  result.files.push({ file, path, size: file.size });
}

async function collectFromDirectoryEntry(rootEntry) {
  const result = { kind: 'folder', rootName: 'dist-universal', files: [], excluded: [], detectedFromProjectRoot: false };
  let distEntry = rootEntry;
  if (!isDistDirectoryName(rootEntry.name)) {
    const children = await readAllDirectoryEntries(rootEntry);
    distEntry = DIST_DIRECTORY_NAMES
      .map((name) => children.find((entry) => entry.isDirectory && entry.name.toLowerCase() === name))
      .find(Boolean);
    if (!distEntry) throw new Error('לא נמצאה תיקיית dist-universal או dist ישירות בתוך התיקייה שנבחרה.');
    result.detectedFromProjectRoot = true;
  }
  result.rootName = distEntry.name;
  const children = await readAllDirectoryEntries(distEntry);
  for (const child of children) await walkEntry(child, distEntry.name, result);
  return result;
}
export async function collectDroppedFolder(dataTransfer) {
  const entries = Array.from(dataTransfer?.items || [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.length === 1 && entries[0].isDirectory) return collectFromDirectoryEntry(entries[0]);
  return normalizeSelectedFiles(dataTransfer?.files || []);
}

async function walkHandle(handle, parentPath, result) {
  for await (const child of handle.values()) {
    if (child.kind === 'directory') {
      await walkHandle(child, `${parentPath}/${child.name}`, result);
      continue;
    }
    const parts = pathParts(`${parentPath}/${child.name}`);
    const distIndex = parts.findIndex((part) => isDistDirectoryName(part));
    const path = distIndex >= 0 ? parts.slice(distIndex + 1).join('/') : parts.join('/');
    const reason = distExclusionReason(path);
    if (reason) {
      result.excluded.push({ path, reason, isDirectory: false });
      continue;
    }
    const file = await child.getFile();
    result.files.push({ file, path, size: file.size });
  }
}

export async function collectDirectoryHandle(directoryHandle) {
  const result = { kind: 'folder', rootName: 'dist-universal', files: [], excluded: [], detectedFromProjectRoot: false };
  if (!directoryHandle || directoryHandle.kind !== 'directory') return result;
  let distHandle = directoryHandle;
  if (!isDistDirectoryName(directoryHandle.name)) {
    distHandle = null;
    for (const directoryName of DIST_DIRECTORY_NAMES) {
      try {
        distHandle = await directoryHandle.getDirectoryHandle(directoryName);
        break;
      } catch {
        // Try the next supported directory name.
      }
    }
    if (!distHandle) throw new Error('לא נמצאה תיקיית dist-universal או dist ישירות בתוך התיקייה שנבחרה.');
    result.detectedFromProjectRoot = true;
  }
  result.rootName = distHandle.name;
  await walkHandle(distHandle, distHandle.name, result);
  return result;
}
export function validateDistSource(source) {
  const paths = new Set((source?.files || []).map((item) => item.path));
  if (!paths.has('index.html')) throw new Error('ה-dist חסר index.html.');
  if (![...paths].some((path) => /^assets\/.*\.js$/i.test(path))) throw new Error('ה-dist חסר JavaScript תחת assets.');
  return source;
}

export function summarizeSource(source) {
  return {
    fileCount: source?.files?.length || 0,
    excludedCount: source?.excluded?.length || 0,
    totalBytes: (source?.files || []).reduce((sum, item) => sum + Number(item.size || 0), 0),
  };
}

export function folderPickerDiagnostics() {
  if (typeof window === 'undefined') return { fileSystemAccess: false, webkitDirectory: false };
  const input = document.createElement('input');
  return {
    fileSystemAccess: typeof window.showDirectoryPicker === 'function',
    webkitDirectory: 'webkitdirectory' in input || 'webkitDirectory' in input,
  };
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
