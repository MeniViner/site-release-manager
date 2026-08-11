const params = new URLSearchParams(location.search);
const jobId = params.get('jobId') || '';
const apiBase = (params.get('apiBase') || '').replace(/\/+$/, '');
const embedded = params.get('embedded') === '1';
if (embedded) document.documentElement.classList.add('embedded');

function notifyParent(type, payload = {}) {
  try { if (window.parent && window.parent !== window) window.parent.postMessage({ source: 'site-release-deployer', type, jobId, ...payload }, '*'); } catch {}
}

const ui = {
  subtitle: document.getElementById('subtitle'), badge: document.getElementById('badge'), percent: document.getElementById('percent'),
  bar: document.getElementById('bar'), step: document.getElementById('step'), currentFile: document.getElementById('currentFile'),
  target: document.getElementById('target'), errorBox: document.getElementById('errorBox'), startButton: document.getElementById('startButton'),
  retryButton: document.getElementById('retryButton'), openSite: document.getElementById('openSite'), toggleLogs: document.getElementById('toggleLogs'),
  logs: document.getElementById('logs'),
};

let descriptor = null;
let running = false;
let activeStage = 'DEPLOYER_INIT';
let activeStageLabel = 'טעינת SharePoint Deployer';
let activeFile = '';
let lastSharePointRequest = null;
const logLines = [];
const ODATA = 'application/json;odata=verbose';

const STAGES = Object.freeze({
  DEPLOYER_INIT: 'טעינת SharePoint Deployer',
  TARGET_VALIDATION: 'אימות אתר היעד',
  FORM_DIGEST: 'חיבור ל-SharePoint וקבלת FormDigest',
  LIBRARIES: 'בדיקת/יצירת ספריות מסמכים',
  FOLDERS: 'בדיקת/יצירת תיקיות',
  SEED_FILES: 'בדיקת/יצירת קובצי TXT',
  RELEASE_FILES: 'העלאת קובצי הריליס',
  FINAL_VERIFY: 'אימות האתר הסופי',
  COMPLETE: 'סיום הפריסה',
});

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logLines.push(line);
  ui.logs.textContent = logLines.join('\n');
  console.log(line);
}

function setProgress(percent, step, currentFile = '') {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  ui.percent.textContent = `${value}%`;
  ui.bar.style.width = `${value}%`;
  ui.step.textContent = step;
  ui.currentFile.textContent = currentFile;
  activeFile = currentFile || activeFile;
}

function setBadge(type, text) {
  ui.badge.className = `badge ${type}`;
  ui.badge.textContent = text;
}

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(typeof body === 'string' ? body : body?.error || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.url = `${apiBase}${path}`;
    error.method = options.method || 'GET';
    throw error;
  }
  return body;
}

async function reportEvent(stage, status, message, extra = {}) {
  if (!jobId || !apiBase) return;
  try {
    await api(`/api/deployments/${encodeURIComponent(jobId)}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage,
        stageLabel: STAGES[stage] || stage,
        status,
        source: 'sharepoint-deployer',
        message,
        currentFile: extra.currentFile || activeFile || '',
        operation: extra.operation || '',
        method: extra.method || '',
        url: extra.url || '',
        httpStatus: extra.httpStatus ?? null,
        durationMs: extra.durationMs ?? null,
        details: extra.details || null,
      }),
    });
  } catch (error) {
    log(`Telemetry callback failed: ${error.message}`);
  }
}

async function withStage(stage, fn, { startMessage = '', successMessage = '' } = {}) {
  const label = STAGES[stage] || stage;
  activeStage = stage;
  activeStageLabel = label;
  activeFile = '';
  const started = performance.now();
  await reportEvent(stage, 'started', startMessage || `${label} התחיל.`);
  log(`[stage:${stage}] START ${label}`);
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - started);
    await reportEvent(stage, 'success', successMessage || `${label} הושלם.`, { durationMs });
    log(`[stage:${stage}] PASS ${label} (${durationMs}ms)`);
    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const request = error.request || ((lastSharePointRequest?.httpStatus || 0) >= 400 ? lastSharePointRequest : null);
    error.stage = stage;
    error.stageLabel = label;
    error.currentFile = error.currentFile || activeFile || '';
    error.durationMs = durationMs;
    if (request) error.request = request;
    await reportEvent(stage, 'failed', error.message, {
      currentFile: error.currentFile,
      operation: request?.operation || '',
      method: request?.method || error.method || '',
      url: request?.url || error.url || '',
      httpStatus: request?.httpStatus ?? error.httpStatus ?? null,
      durationMs,
      details: { responsePreview: request?.responsePreview || '', contentType: request?.contentType || '' },
    });
    log(`[stage:${stage}] FAIL ${label}: ${error.message}`);
    throw error;
  }
}

function esc(value) { return String(value || '').replace(/'/g, "''"); }
function targetWeb() { return `https://${descriptor.site.host}/sites/${descriptor.site.siteCode}`; }

async function spFetch(url, options = {}, operation = '') {
  const method = String(options.method || 'GET').toUpperCase();
  const started = performance.now();
  let response;
  try {
    response = await fetch(url, { credentials: 'include', ...options });
  } catch (error) {
    lastSharePointRequest = { operation, method, url, httpStatus: 0, durationMs: Math.round(performance.now() - started), contentType: '', responsePreview: '', networkError: error.message };
    error.request = lastSharePointRequest;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  lastSharePointRequest = { operation, method, url, httpStatus: response.status, durationMs: Math.round(performance.now() - started), contentType, responsePreview: '' };
  if (response.ok && contentType.includes('text/html')) {
    const error = new Error('SharePoint returned an HTML page. Verify that you are signed in and have permission to the target site.');
    error.request = lastSharePointRequest;
    throw error;
  }
  return response;
}

async function responseFailure(response, message) {
  let preview = '';
  try { preview = (await response.clone().text()).slice(0, 500); } catch {}
  lastSharePointRequest = { ...(lastSharePointRequest || {}), responsePreview: preview };
  const error = new Error(`${message}: HTTP ${response.status}${preview ? ` | ${preview}` : ''}`);
  error.httpStatus = response.status;
  error.request = lastSharePointRequest;
  return error;
}

async function getDigest(webUrl) {
  log('Requesting SharePoint form digest.');
  const url = `${webUrl}/_api/contextinfo`;
  const response = await spFetch(url, {
    method: 'POST', headers: { Accept: ODATA, 'Content-Type': ODATA },
  }, 'contextinfo');
  if (!response.ok) throw await responseFailure(response, 'contextinfo failed');
  const data = await response.json();
  const digest = data?.d?.GetContextWebInformation?.FormDigestValue;
  if (!digest) throw new Error('SharePoint returned an empty form digest.');
  return digest;
}

async function getLibrary(webUrl, title) {
  const url = `${webUrl}/_api/web/lists/GetByTitle('${esc(title)}')?$select=Id,Title,BaseTemplate,RootFolder/ServerRelativeUrl&$expand=RootFolder`;
  const response = await spFetch(url, { headers: { Accept: ODATA } }, `check-library:${title}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await responseFailure(response, `Library check failed for ${title}`);
  return (await response.json())?.d || null;
}

async function ensureLibrary(webUrl, title, digest) {
  const existing = await getLibrary(webUrl, title);
  if (existing) {
    if (Number(existing.BaseTemplate) !== 101) throw new Error(`${title} exists but is not a Document Library.`);
    log(`Library exists: ${title}`);
    return existing;
  }
  log(`Creating Document Library: ${title}`);
  const url = `${webUrl}/_api/web/lists`;
  const response = await spFetch(url, {
    method: 'POST',
    headers: { Accept: ODATA, 'Content-Type': ODATA, 'X-RequestDigest': digest },
    body: JSON.stringify({ __metadata: { type: 'SP.List' }, BaseTemplate: 101, Title: title, Description: 'Site Release Manager data library', OnQuickLaunch: true }),
  }, `create-library:${title}`);
  if (!response.ok) {
    const recheck = await getLibrary(webUrl, title);
    if (recheck) return recheck;
    throw await responseFailure(response, `Creating ${title} failed`);
  }
  const created = await getLibrary(webUrl, title);
  if (!created) throw new Error(`SharePoint did not expose ${title} after creation.`);
  return created;
}

async function folderExists(webUrl, relativePath) {
  const url = `${webUrl}/_api/web/GetFolderByServerRelativeUrl('${esc(relativePath)}')?$select=ServerRelativeUrl`;
  const response = await spFetch(url, { headers: { Accept: ODATA } }, `check-folder:${relativePath}`);
  if (response.status === 404) return false;
  if (!response.ok) throw await responseFailure(response, `Folder check failed: ${relativePath}`);
  return true;
}

async function ensureFolder(webUrl, relativePath, digest) {
  if (await folderExists(webUrl, relativePath)) return;
  log(`Creating folder: ${relativePath}`);
  const url = `${webUrl}/_api/web/folders`;
  const response = await spFetch(url, {
    method: 'POST', headers: { Accept: ODATA, 'Content-Type': ODATA, 'X-RequestDigest': digest },
    body: JSON.stringify({ __metadata: { type: 'SP.Folder' }, ServerRelativeUrl: relativePath }),
  }, `create-folder:${relativePath}`);
  if (!response.ok && response.status !== 409) {
    const preview = await response.clone().text().catch(() => '');
    if (!/already exists/i.test(preview)) throw await responseFailure(response, `Folder creation failed: ${relativePath}`);
  }
}

async function fileValue(webUrl, relativePath) {
  const url = `${webUrl}/_api/web/GetFileByServerRelativeUrl('${esc(relativePath)}')/$value`;
  return spFetch(url, { headers: { Accept: '*/*' } }, `read-file:${relativePath}`);
}

async function uploadBytes(webUrl, relativePath, bytes, digest) {
  const slash = relativePath.lastIndexOf('/');
  const folder = relativePath.slice(0, slash);
  const fileName = relativePath.slice(slash + 1);
  await ensureFolder(webUrl, folder, digest);
  const url = `${webUrl}/_api/web/GetFolderByServerRelativeUrl('${esc(folder)}')/Files/add(url='${encodeURIComponent(fileName)}',overwrite=true)`;
  const response = await spFetch(url, {
    method: 'POST', headers: { Accept: ODATA, 'X-RequestDigest': digest }, body: bytes,
  }, `upload-file:${relativePath}`);
  if (!response.ok) throw await responseFailure(response, `Upload failed for ${relativePath}`);
}

async function ensureSeedFile(webUrl, item, digest) {
  const existing = await fileValue(webUrl, item.path);
  if (existing.ok) {
    const text = await existing.text();
    if (text.trim()) { log(`Keeping existing TXT: ${item.path}`); return 'kept'; }
  } else if (existing.status !== 404) {
    throw await responseFailure(existing, `Unable to check ${item.path}`);
  }
  log(`Creating TXT: ${item.path}`);
  await uploadBytes(webUrl, item.path, new TextEncoder().encode(item.content), digest);
  return 'created';
}

async function reportProgress(progress, message, currentFile = '', stage = activeStage) {
  setProgress(progress, message, currentFile);
  activeStage = stage || activeStage;
  activeStageLabel = STAGES[activeStage] || activeStageLabel;
  try {
    await api(`/api/deployments/${encodeURIComponent(jobId)}/progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ progress, message, currentFile, stage: activeStage }),
    });
  } catch (error) { log(`Progress callback failed: ${error.message}`); }
}

function requiredFolders() {
  const set = new Set(descriptor.folders);
  for (const file of descriptor.manifest.files) {
    const relativeFolder = file.path.split('/').slice(0, -1).join('/');
    if (relativeFolder) set.add(`${descriptor.site.finalDistRoot}/${relativeFolder}`);
  }
  return [...set].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

async function uploadReleaseFiles(webUrl, digest) {
  const filesByPath = new Map(descriptor.manifest.files.map((file) => [file.path, file]));
  const order = descriptor.manifest.uploadOrder;
  let completed = 0;
  const total = order.length;

  const uploadOne = async (relativePath) => {
    activeFile = relativePath;
    const file = filesByPath.get(relativePath);
    if (!file) {
      const error = new Error(`Manifest entry is missing: ${relativePath}`);
      error.currentFile = relativePath;
      throw error;
    }
    const progress = 30 + ((completed / total) * 60);
    await reportProgress(progress, `מעלה קבצים (${completed + 1}/${total})`, relativePath, 'RELEASE_FILES');
    const sourceUrl = `${apiBase}/api/deployments/${encodeURIComponent(jobId)}/file?path=${encodeURIComponent(relativePath)}`;
    const source = await fetch(sourceUrl);
    if (!source.ok) {
      const error = new Error(`Unable to download release file ${relativePath}: HTTP ${source.status}`);
      error.httpStatus = source.status;
      error.url = sourceUrl;
      error.method = 'GET';
      error.currentFile = relativePath;
      throw error;
    }
    const bytes = await source.arrayBuffer();
    if (bytes.byteLength !== file.size) {
      const error = new Error(`Size mismatch for ${relativePath}. Expected ${file.size}, got ${bytes.byteLength}.`);
      error.currentFile = relativePath;
      throw error;
    }
    await uploadBytes(webUrl, `${descriptor.site.finalDistRoot}/${relativePath}`, bytes, digest);
    completed += 1;
  };

  const normalFiles = order.filter((path) => path !== 'index.html');
  const queue = [...normalFiles];
  const workers = Array.from({ length: Math.min(4, queue.length || 1) }, async () => {
    while (queue.length) await uploadOne(queue.shift());
  });
  await Promise.all(workers);
  if (order.includes('index.html')) await uploadOne('index.html');
  activeFile = '';
  return { uploaded: completed, total };
}

async function verify(webUrl) {
  await reportProgress(94, 'מאמת את האתר הסופי', '', 'FINAL_VERIFY');
  const index = await fileValue(webUrl, `${descriptor.site.finalDistRoot}/index.html`);
  if (!index.ok) throw await responseFailure(index, 'Final index.html is missing after deployment');
  const jsPath = descriptor.manifest.files.find((file) => /^assets\/.*\.js$/i.test(file.path))?.path;
  if (!jsPath) throw new Error('The artifact contains no JavaScript asset.');
  const js = await fileValue(webUrl, `${descriptor.site.finalDistRoot}/${jsPath}`);
  if (!js.ok) throw await responseFailure(js, `Final JavaScript asset is missing: ${jsPath}`);
  return { index: true, jsPath };
}

async function run() {
  if (running || !descriptor) return;
  running = true;
  ui.startButton.disabled = true;
  ui.retryButton.classList.add('hidden');
  ui.errorBox.classList.add('hidden');
  setBadge('running', 'מבצע פריסה');

  try {
    await withStage('TARGET_VALIDATION', async () => {
      if (location.hostname.toLowerCase() !== descriptor.site.host.toLowerCase()) {
        throw new Error(`This deployer is running on ${location.hostname}, but the target host is ${descriptor.site.host}.`);
      }
    }, { successMessage: `Host ה-Deployer תואם ליעד ${descriptor.site.host}.` });

    const webUrl = targetWeb();
    const digest = await withStage('FORM_DIGEST', async () => {
      await reportProgress(3, 'מתחבר ל-SharePoint', '', 'FORM_DIGEST');
      return getDigest(webUrl);
    }, { successMessage: 'SharePoint החזיר FormDigest תקין.' });

    await withStage('LIBRARIES', async () => {
      await reportProgress(8, 'בודק ספריות מסמכים', '', 'LIBRARIES');
      for (const library of descriptor.libraries) await ensureLibrary(webUrl, library.title, digest);
    });

    await withStage('FOLDERS', async () => {
      await reportProgress(14, 'יוצר תיקיות חסרות', '', 'FOLDERS');
      for (const folder of requiredFolders()) await ensureFolder(webUrl, folder, digest);
    });

    await withStage('SEED_FILES', async () => {
      await reportProgress(20, 'יוצר קובצי TXT חסרים', '', 'SEED_FILES');
      let created = 0;
      let kept = 0;
      for (const seed of descriptor.seedFiles) {
        activeFile = seed.path;
        const result = await ensureSeedFile(webUrl, seed, digest);
        if (result === 'created') created += 1; else kept += 1;
      }
      activeFile = '';
      return { created, kept };
    });

    const uploadSummary = await withStage('RELEASE_FILES', async () => {
      await reportProgress(30, 'מתחיל העלאת ריליס', '', 'RELEASE_FILES');
      return uploadReleaseFiles(webUrl, digest);
    }, { successMessage: `כל ${descriptor.manifest.files.length} קובצי הריליס הועלו.` });

    const verifySummary = await withStage('FINAL_VERIFY', async () => verify(webUrl));

    activeStage = 'COMPLETE';
    activeStageLabel = STAGES.COMPLETE;
    await reportEvent('COMPLETE', 'started', 'מסיים את הריצה ומעדכן את גרסת האתר.');
    await api(`/api/deployments/${encodeURIComponent(jobId)}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadedFiles: uploadSummary.uploaded, finalUrl: descriptor.site.finalUrl, completedAt: new Date().toISOString(), verification: verifySummary }),
    });

    setProgress(100, 'הפריסה הושלמה בהצלחה');
    setBadge('done', 'הושלם');
    ui.openSite.href = descriptor.site.finalUrl;
    ui.openSite.classList.remove('hidden');
    log('Deployment completed successfully.');
    notifyParent('deployment-complete', { finalUrl: descriptor.site.finalUrl });
  } catch (error) {
    setBadge('failed', 'נכשל');
    ui.errorBox.textContent = error.message;
    ui.errorBox.classList.remove('hidden');
    ui.retryButton.classList.remove('hidden');
    log(`ERROR: ${error.message}`);
    notifyParent('deployment-failed', { error: error.message, stage: error.stage || activeStage });
    const request = error.request || lastSharePointRequest || null;
    try {
      await api(`/api/deployments/${encodeURIComponent(jobId)}/fail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          error: error.message,
          stage: error.stage || activeStage,
          stageLabel: error.stageLabel || activeStageLabel,
          currentFile: error.currentFile || activeFile || '',
          operation: request?.operation || '',
          method: request?.method || error.method || '',
          url: request?.url || error.url || '',
          httpStatus: request?.httpStatus ?? error.httpStatus ?? null,
          durationMs: error.durationMs ?? request?.durationMs ?? null,
          details: { responsePreview: request?.responsePreview || '', contentType: request?.contentType || '', networkError: request?.networkError || '' },
          eventAlreadyReported: true,
        }),
      });
    } catch (callbackError) { log(`Failure callback failed: ${callbackError.message}`); }
  } finally {
    running = false;
  }
}

async function init() {
  try {
    if (!jobId || !apiBase) throw new Error('Missing jobId or apiBase in the URL.');
    const started = performance.now();
    descriptor = await api(`/api/deployments/${encodeURIComponent(jobId)}`);
    ui.subtitle.textContent = `${descriptor.site.name} · ריליס ${descriptor.release.version}`;
    ui.target.textContent = descriptor.site.finalUrl;
    ui.startButton.disabled = false;
    setProgress(0, 'מוכן לפריסה');
    const durationMs = Math.round(performance.now() - started);
    await reportEvent('DEPLOYER_INIT', 'success', `פרטי המשימה נטענו עבור ${descriptor.site.host}/sites/${descriptor.site.siteCode}.`, { durationMs, details: { apiBase, jobId } });
    log(`Loaded deployment ${jobId} for ${descriptor.site.host}/sites/${descriptor.site.siteCode}`);
    notifyParent('deployer-ready', { target: descriptor.site.finalUrl, embedded });
    setTimeout(run, embedded ? 100 : 500);
  } catch (error) {
    setBadge('failed', 'לא ניתן להתחיל');
    ui.errorBox.textContent = error.message;
    ui.errorBox.classList.remove('hidden');
    log(`Initialization failed: ${error.message}`);
    notifyParent('deployer-init-failed', { error: error.message });
    await reportEvent('DEPLOYER_INIT', 'failed', error.message, { method: error.method || '', url: error.url || '', httpStatus: error.httpStatus ?? null });
  }
}

ui.startButton.addEventListener('click', run);
ui.retryButton.addEventListener('click', run);
ui.toggleLogs.addEventListener('click', () => ui.logs.classList.toggle('hidden'));
init();
