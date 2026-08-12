import { getResolvedApiBaseUrl, resolveApiUrl } from './api.js';

const ODATA = 'application/json;odata=verbose';

const STAGES = Object.freeze({
  DEPLOYER_INIT: 'אתחול מנוע הפריסה',
  TARGET_VALIDATION: 'אימות אתר היעד',
  FORM_DIGEST: 'חיבור ל-SharePoint וקבלת FormDigest',
  LIBRARIES: 'בדיקת/יצירת ספריות מסמכים',
  FOLDERS: 'בדיקת/יצירת תיקיות',
  SEED_FILES: 'בדיקת/יצירת קובצי TXT',
  RELEASE_FILES: 'העלאת קובצי הריליס',
  FINAL_VERIFY: 'אימות האתר הסופי',
  COMPLETE: 'סיום הפריסה',
});

function esc(value) { return String(value || '').replace(/'/g, "''"); }
function normalizeApiBase() { return String(getResolvedApiBaseUrl() || '').replace(/\/+$/g, ''); }
function apiUrl(path) { return resolveApiUrl(path); }
function cacheBust(url) { return `${url}${url.includes('?') ? '&' : '?'}_srm=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

async function jsonApi(path, options = {}) {
  const response = await fetch(apiUrl(path), options);
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const error = new Error(typeof body === 'string' ? body : body?.error || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.url = apiUrl(path);
    error.method = options.method || 'GET';
    error.contentType = contentType;
    throw error;
  }
  return body;
}

async function reportEvent(jobId, stage, status, message, extra = {}) {
  try {
    await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage,
        stageLabel: STAGES[stage] || stage,
        status,
        source: 'release-manager-browser-engine',
        message,
        currentFile: extra.currentFile || '',
        operation: extra.operation || '',
        method: extra.method || '',
        url: extra.url || '',
        httpStatus: extra.httpStatus ?? null,
        durationMs: extra.durationMs ?? null,
        details: extra.details || null,
      }),
    });
  } catch (error) {
    console.warn('[release-manager][sharepoint-engine] telemetry failed', error);
  }
}

async function reportProgress(jobId, progress, message, currentFile = '', stage = '') {
  await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progress, message, currentFile, stage }),
  });
}

async function reportFailure(jobId, error, stage) {
  try {
    await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        stage: error.stage || stage,
        stageLabel: STAGES[error.stage || stage] || error.stageLabel || stage,
        currentFile: error.currentFile || '',
        operation: error.operation || '',
        method: error.method || '',
        url: error.url || '',
        httpStatus: error.httpStatus ?? null,
        details: error.details || null,
      }),
    });
  } catch (callbackError) {
    console.error('[release-manager][sharepoint-engine] failure callback failed', callbackError);
  }
}

async function withStage(jobId, stage, fn, successMessage) {
  const started = performance.now();
  await reportEvent(jobId, stage, 'started', `${STAGES[stage]} התחיל.`);
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - started);
    await reportEvent(jobId, stage, 'success', successMessage || `${STAGES[stage]} הושלם.`, { durationMs });
    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    error.stage = error.stage || stage;
    await reportEvent(jobId, stage, 'failed', error.message, {
      durationMs,
      currentFile: error.currentFile || '',
      operation: error.operation || '',
      method: error.method || '',
      url: error.url || '',
      httpStatus: error.httpStatus ?? null,
      details: error.details || null,
    });
    throw error;
  }
}

async function spFetch(url, options = {}, operation = '') {
  const started = performance.now();
  const method = String(options.method || 'GET').toUpperCase();
  const requestUrl = method === 'GET' ? cacheBust(url) : url;
  try {
    const response = await fetch(requestUrl, { credentials: 'include', cache: 'no-store', ...options });
    if (!response.ok) {
      const preview = (await response.clone().text().catch(() => '')).slice(0, 500);
      const error = new Error(`${operation || options.method || 'SharePoint request'} failed: HTTP ${response.status}${preview ? ` | ${preview}` : ''}`);
      error.httpStatus = response.status;
      error.url = url;
      error.method = options.method || 'GET';
      error.operation = operation;
      error.details = { responsePreview: preview, contentType: response.headers.get('content-type') || '', durationMs: Math.round(performance.now() - started) };
      throw error;
    }
    return response;
  } catch (error) {
    if (!error.url) {
      error.url = url;
      error.method = options.method || 'GET';
      error.operation = operation;
    }
    throw error;
  }
}

function targetWeb(descriptor) { return `https://${descriptor.site.host}${descriptor.site.siteRoot}`; }

async function getDigest(webUrl) {
  const response = await spFetch(`${webUrl}/_api/contextinfo`, {
    method: 'POST',
    headers: { Accept: ODATA, 'Content-Type': ODATA },
  }, 'contextinfo');
  const data = await response.json();
  const digest = data?.d?.GetContextWebInformation?.FormDigestValue;
  if (!digest) throw new Error('SharePoint returned an empty FormDigest.');
  return digest;
}

async function getLibrary(webUrl, title) {
  const url = `${webUrl}/_api/web/lists/GetByTitle('${esc(title)}')?$select=Id,Title,BaseTemplate,RootFolder/ServerRelativeUrl&$expand=RootFolder`;
  try {
    const response = await fetch(cacheBust(url), { credentials: 'include', cache: 'no-store', headers: { Accept: ODATA } });
    if (response.status === 404) return null;
    if (!response.ok) {
      const preview = (await response.text().catch(() => '')).slice(0, 500);
      const error = new Error(`Library check failed for ${title}: HTTP ${response.status}${preview ? ` | ${preview}` : ''}`);
      error.httpStatus = response.status; error.url = url; error.operation = `check-library:${title}`; throw error;
    }
    return (await response.json())?.d || null;
  } catch (error) { throw error; }
}

async function ensureLibrary(webUrl, library, digest) {
  const title = library.title;
  const existing = await getLibrary(webUrl, title);
  if (existing) {
    if (Number(existing.BaseTemplate) !== 101) throw new Error(`${title} exists but is not a Document Library.`);
    return existing;
  }
  const url = `${webUrl}/_api/web/lists`;
  const response = await spFetch(url, {
    method: 'POST',
    headers: { Accept: ODATA, 'Content-Type': ODATA, 'X-RequestDigest': digest },
    body: JSON.stringify({ __metadata: { type: 'SP.List' }, BaseTemplate: 101, Title: title, Description: 'Site Release Manager data library', OnQuickLaunch: true }),
  }, `create-library:${title}`);
  if (!response.ok) throw new Error(`Unable to create ${title}.`);
  const created = await getLibrary(webUrl, title);
  if (!created) throw new Error(`SharePoint did not expose ${title} after creation.`);
  return created;
}

async function folderExists(webUrl, relativePath) {
  const url = `${webUrl}/_api/web/GetFolderByServerRelativeUrl('${esc(relativePath)}')?$select=ServerRelativeUrl`;
  const response = await fetch(cacheBust(url), { credentials: 'include', cache: 'no-store', headers: { Accept: ODATA } });
  if (response.status === 404) return false;
  if (!response.ok) {
    const error = new Error(`Folder check failed: ${relativePath} (HTTP ${response.status})`);
    error.httpStatus = response.status; error.url = url; error.operation = `check-folder:${relativePath}`; throw error;
  }
  return true;
}

async function ensureFolder(webUrl, relativePath, digest) {
  if (await folderExists(webUrl, relativePath)) return;
  const url = `${webUrl}/_api/web/folders`;
  const response = await fetch(url, {
    credentials: 'include',
    method: 'POST',
    headers: { Accept: ODATA, 'Content-Type': ODATA, 'X-RequestDigest': digest },
    body: JSON.stringify({ __metadata: { type: 'SP.Folder' }, ServerRelativeUrl: relativePath }),
  });
  if (!response.ok && response.status !== 409) {
    const preview = (await response.text().catch(() => '')).slice(0, 500);
    if (!/already exists/i.test(preview)) {
      const error = new Error(`Folder creation failed: ${relativePath} (HTTP ${response.status})`);
      error.httpStatus = response.status; error.url = url; error.operation = `create-folder:${relativePath}`; throw error;
    }
  }
}

async function fileValue(webUrl, relativePath) {
  const url = `${webUrl}/_api/web/GetFileByServerRelativeUrl('${esc(relativePath)}')/$value`;
  const response = await fetch(cacheBust(url), { credentials: 'include', cache: 'no-store', headers: { Accept: '*/*' } });
  return { response, url };
}

async function uploadBytes(webUrl, relativePath, bytes, digest) {
  const slash = relativePath.lastIndexOf('/');
  const folder = relativePath.slice(0, slash);
  const fileName = relativePath.slice(slash + 1);
  await ensureFolder(webUrl, folder, digest);
  const url = `${webUrl}/_api/web/GetFolderByServerRelativeUrl('${esc(folder)}')/Files/add(url='${encodeURIComponent(fileName)}',overwrite=true)`;
  const response = await fetch(url, {
    credentials: 'include',
    method: 'POST',
    headers: { Accept: ODATA, 'X-RequestDigest': digest },
    body: bytes,
  });
  if (!response.ok) {
    const preview = (await response.text().catch(() => '')).slice(0, 500);
    const error = new Error(`Upload failed for ${relativePath}: HTTP ${response.status}`);
    error.httpStatus = response.status; error.url = url; error.method = 'POST'; error.operation = `upload-file:${relativePath}`; error.details = { responsePreview: preview }; error.currentFile = relativePath; throw error;
  }
}

async function ensureSeedFile(webUrl, item, digest) {
  const { response } = await fileValue(webUrl, item.path);
  if (response.ok) {
    const text = await response.text();
    if (text.trim()) return 'kept';
  } else if (response.status !== 404) {
    throw new Error(`Unable to check ${item.path}: HTTP ${response.status}`);
  }
  await uploadBytes(webUrl, item.path, new TextEncoder().encode(item.content), digest);
  return 'created';
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function downloadArtifactFile(jobId, file) {
  const url = apiUrl(`/api/deployments/${encodeURIComponent(jobId)}/file?path=${encodeURIComponent(file.path)}`);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`Unable to download ${file.path}: HTTP ${response.status}`);
    error.httpStatus = response.status; error.url = url; error.method = 'GET'; error.currentFile = file.path; throw error;
  }
  const bytes = await response.arrayBuffer();
  if (Number(bytes.byteLength) !== Number(file.size)) throw new Error(`Size mismatch for ${file.path}. Expected ${file.size}, got ${bytes.byteLength}.`);
  if (file.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== file.sha256) throw new Error(`SHA-256 mismatch for ${file.path}.`);
  }
  return bytes;
}

async function verifyFinalFile(webUrl, root, file) {
  const { response } = await fileValue(webUrl, `${root}/${file.path}`);
  if (!response.ok) throw new Error(`Final file missing: ${file.path} (HTTP ${response.status})`);
  const bytes = await response.arrayBuffer();
  if (Number(bytes.byteLength) !== Number(file.size)) throw new Error(`Final size mismatch: ${file.path}.`);
  if (file.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== file.sha256) throw new Error(`Final SHA-256 mismatch: ${file.path}.`);
  }
}

function parseIndexReferences(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return [...doc.querySelectorAll('script[src],link[href]')]
    .map((node) => node.getAttribute('src') || node.getAttribute('href') || '')
    .map((value) => value.split(/[?#]/)[0].replace(/^\.\//, ''))
    .filter((value) => value && !/^(?:https?:|data:|mailto:|#|\/\/)/i.test(value));
}

export async function deploySharePointJob(jobId, { onProgress = () => {} } = {}) {
  let stage = 'DEPLOYER_INIT';
  try {
    const descriptor = await withStage(jobId, 'DEPLOYER_INIT', async () => jsonApi(`/api/deployments/${encodeURIComponent(jobId)}`), 'פרטי המשימה נטענו במנוע הפריסה המובנה.');
    stage = 'TARGET_VALIDATION';
    await withStage(jobId, stage, async () => {
      if (window.location.hostname.toLowerCase() !== descriptor.site.host.toLowerCase()) {
        throw new Error(`Release Manager פתוח ב-${window.location.hostname}, אבל אתר היעד נמצא ב-${descriptor.site.host}.`);
      }
    }, `Host ה-Release Manager תואם ליעד ${descriptor.site.host}.`);

    const webUrl = targetWeb(descriptor);
    stage = 'FORM_DIGEST';
    onProgress({ progress: 45, stage, message: 'מתחבר ל-SharePoint' });
    await reportProgress(jobId, 45, 'מתחבר ל-SharePoint', '', stage);
    const digest = await withStage(jobId, stage, () => getDigest(webUrl), 'SharePoint החזיר FormDigest תקין.');

    stage = 'LIBRARIES';
    onProgress({ progress: 52, stage, message: 'בודק ספריות מסמכים' });
    await reportProgress(jobId, 52, 'בודק ספריות מסמכים', '', stage);
    await withStage(jobId, stage, async () => {
      for (const library of descriptor.libraries) await ensureLibrary(webUrl, library, digest);
    });

    stage = 'FOLDERS';
    onProgress({ progress: 60, stage, message: 'יוצר תיקיות חסרות' });
    await reportProgress(jobId, 60, 'יוצר תיקיות חסרות', '', stage);
    await withStage(jobId, stage, async () => {
      for (const folder of descriptor.folders) await ensureFolder(webUrl, folder, digest);
      for (const file of descriptor.manifest.files) {
        const relativeFolder = file.path.split('/').slice(0, -1).join('/');
        if (relativeFolder) await ensureFolder(webUrl, `${descriptor.site.finalDistRoot}/${relativeFolder}`, digest);
      }
    });

    stage = 'SEED_FILES';
    onProgress({ progress: 68, stage, message: 'בודק קובצי TXT' });
    await reportProgress(jobId, 68, 'בודק קובצי TXT', '', stage);
    await withStage(jobId, stage, async () => {
      for (const seed of descriptor.seedFiles) await ensureSeedFile(webUrl, seed, digest);
    });

    stage = 'RELEASE_FILES';
    const filesByPath = new Map(descriptor.manifest.files.map((file) => [file.path, file]));
    const order = descriptor.manifest.uploadOrder || descriptor.manifest.files.map((file) => file.path);
    const nonIndex = order.filter((filePath) => filePath !== 'index.html');
    await withStage(jobId, stage, async () => {
      for (let i = 0; i < nonIndex.length; i += 1) {
        const filePath = nonIndex[i];
        const file = filesByPath.get(filePath);
        if (!file) throw new Error(`Manifest entry missing: ${filePath}`);
        const progress = 70 + Math.round(((i + 1) / Math.max(1, nonIndex.length)) * 20);
        onProgress({ progress, stage, message: `מעלה ${i + 1}/${nonIndex.length}`, currentFile: filePath });
        await reportProgress(jobId, progress, `מעלה ${i + 1}/${nonIndex.length}`, filePath, stage);
        const bytes = await downloadArtifactFile(jobId, file);
        await uploadBytes(webUrl, `${descriptor.site.finalDistRoot}/${filePath}`, bytes, digest);
        await verifyFinalFile(webUrl, descriptor.site.finalDistRoot, file);
      }

      const indexFile = filesByPath.get('index.html');
      if (!indexFile) throw new Error('Manifest is missing index.html.');
      const indexBytes = await downloadArtifactFile(jobId, indexFile);
      onProgress({ progress: 92, stage, message: 'מעלה index.html אחרון', currentFile: 'index.html' });
      await reportProgress(jobId, 92, 'מעלה index.html אחרון', 'index.html', stage);
      await uploadBytes(webUrl, `${descriptor.site.finalDistRoot}/index.html`, indexBytes, digest);
      await verifyFinalFile(webUrl, descriptor.site.finalDistRoot, indexFile);
    }, `כל ${order.length} קובצי הריליס הועלו ואומתו; index.html עלה אחרון.`);

    stage = 'FINAL_VERIFY';
    onProgress({ progress: 96, stage, message: 'מאמת את האתר הסופי' });
    await reportProgress(jobId, 96, 'מאמת את האתר הסופי', '', stage);
    const finalVerification = await withStage(jobId, stage, async () => {
      const indexFile = filesByPath.get('index.html');
      const { response } = await fileValue(webUrl, `${descriptor.site.finalDistRoot}/index.html`);
      if (!response.ok) throw new Error(`Final index.html is missing: HTTP ${response.status}`);
      const indexText = await response.text();
      const refs = parseIndexReferences(indexText);
      const missing = [];
      for (const ref of refs) {
        const file = filesByPath.get(ref);
        if (!file) { missing.push(`${ref} (not in manifest)`); continue; }
        try { await verifyFinalFile(webUrl, descriptor.site.finalDistRoot, file); }
        catch (error) { missing.push(`${ref}: ${error.message}`); }
      }
      if (missing.length) throw new Error(`Final index references missing/mismatched assets: ${missing.slice(0, 8).join(' | ')}`);
      return { index: true, refsVerified: refs.length, indexSha256: indexFile?.sha256 || '' };
    }, 'index.html וכל ה-assets שהוא מפנה אליהם אומתו ב-SharePoint.');

    stage = 'COMPLETE';
    await reportEvent(jobId, stage, 'started', 'מסיים את הריצה ומעדכן את גרסת האתר.');
    await jsonApi(`/api/deployments/${encodeURIComponent(jobId)}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ finalUrl: descriptor.site.finalUrl, completedAt: new Date().toISOString(), verification: finalVerification }),
    });
    onProgress({ progress: 100, stage, message: 'הפריסה הושלמה בהצלחה' });
    return { ok: true, finalUrl: descriptor.site.finalUrl };
  } catch (error) {
    await reportFailure(jobId, error, stage);
    throw error;
  }
}
