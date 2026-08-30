/**
 * Standalone SharePoint Deployer.
 *
 * This page is a DIAGNOSTIC and CROSS-HOST FALLBACK, not the normal path. The
 * normal experience runs inside the Release Manager Runs UI on the SharePoint
 * host that owns the target.
 *
 * It deliberately runs the SAME pipeline as the in-page worker
 * (shared/deploymentPipeline.js) rather than its own copy: the previous
 * standalone implementation duplicated the provisioning sequence, which is how
 * the fallback path drifted away from the eventual-consistency handling.
 *
 * `shared/` is copied next to this file by sharepoint-deployer/scripts/build.mjs.
 */

import { runDeploymentPipeline } from './shared/deploymentPipeline.js';
import { stageLabel } from './shared/deploymentStages.js';

const params = new URLSearchParams(location.search);
const jobId = params.get('jobId') || '';
const apiBase = (params.get('apiBase') || '').replace(/\/+$/, '');
const embedded = params.get('embedded') === '1';
if (embedded) document.documentElement.classList.add('embedded');

function notifyParent(type, payload = {}) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'site-release-deployer', type, jobId, ...payload }, '*');
    }
  } catch { /* the parent frame may be cross-origin */ }
}

const ui = {
  subtitle: document.getElementById('subtitle'), badge: document.getElementById('badge'), percent: document.getElementById('percent'),
  bar: document.getElementById('bar'), step: document.getElementById('step'), currentFile: document.getElementById('currentFile'),
  target: document.getElementById('target'), errorBox: document.getElementById('errorBox'), startButton: document.getElementById('startButton'),
  retryButton: document.getElementById('retryButton'), openSite: document.getElementById('openSite'), toggleLogs: document.getElementById('toggleLogs'),
  logs: document.getElementById('logs'),
};

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  ui.logs.textContent += `${stamped}\n`;
  ui.logs.scrollTop = ui.logs.scrollHeight;
}

function setBadge(type, text) {
  ui.badge.className = `badge ${type}`;
  ui.badge.textContent = text;
}

function setProgress(percent, step, currentFile = '') {
  const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
  ui.percent.textContent = `${value}%`;
  ui.bar.style.width = `${value}%`;
  if (step) ui.step.textContent = step;
  ui.currentFile.textContent = currentFile || '';
}

/** Local Release Manager API call. The lease header marks the exclusive owner. */
async function apiCall(path, options = {}, leaseId = '') {
  const headers = { ...(options.headers || {}) };
  if (leaseId) headers['X-SRM-Lease'] = leaseId;
  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!response.ok) {
    const error = new Error(typeof body === 'string' ? body : body?.error || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.apiCode = body?.code || '';
    error.url = `${apiBase}${path}`;
    throw error;
  }
  return body;
}

async function sha256Hex(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const JSOM_SCRIPTS = ['init.js', 'MicrosoftAjax.js', 'SP.Runtime.js', 'SP.js'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = src;
    element.async = false;
    element.addEventListener('load', () => resolve());
    element.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(element);
  });
}

/**
 * Exact-URL Document Library creation.
 * REST list creation derives the root folder from the title and silently
 * auto-suffixes on collision, so JSOM's explicit URL is required.
 */
function createExactLibraryViaJsom(webUrl) {
  return async function createLibraryExact({ title, urlSegment, description = 'Site Builder data library' }) {
    if (!window.SP?.ClientContext || !window.SP?.ListCreationInformation) {
      const web = new URL(webUrl);
      const layouts = `${web.origin}${web.pathname.replace(/\/+$/, '')}/_layouts/15/`;
      for (const script of JSOM_SCRIPTS) {
        // Sequential: SP.js depends on SP.Runtime.js.
        // eslint-disable-next-line no-await-in-loop
        await loadScript(`${layouts}${script}`).catch(() => {});
      }
    }
    if (!window.SP?.ClientContext || !window.SP?.ListCreationInformation) {
      const error = new Error('SharePoint JSOM is unavailable on this page, so an exact-URL Document Library cannot be created.');
      error.code = 'SHAREPOINT_JSOM_UNAVAILABLE';
      error.errorClass = 'PERMANENT_FAILURE';
      throw error;
    }

    const SP = window.SP;
    const context = new SP.ClientContext(webUrl);
    const creation = new SP.ListCreationInformation();
    creation.set_title(title);
    creation.set_templateType(101);
    creation.set_url(urlSegment);
    const list = context.get_web().get_lists().add(creation);
    if (typeof list.set_description === 'function') list.set_description(description);
    if (typeof list.set_onQuickLaunch === 'function') list.set_onQuickLaunch(true);
    if (typeof list.update === 'function') list.update();
    const rootFolder = list.get_rootFolder();
    context.load(list, 'Id', 'Title', 'BaseTemplate');
    context.load(rootFolder, 'ServerRelativeUrl');

    return new Promise((resolve, reject) => {
      context.executeQueryAsync(
        () => resolve({ title, rootFolder: rootFolder.get_serverRelativeUrl?.() || '' }),
        (_sender, args) => {
          const error = new Error(args?.get_message?.() || 'JSOM list creation failed.');
          error.code = 'JSOM_QUERY_FAILED';
          error.operation = `create-library:${title}`;
          reject(error);
        },
      );
    });
  };
}

async function downloadStagedFile(file) {
  const url = `${apiBase}/api/deployments/${encodeURIComponent(jobId)}/file?path=${encodeURIComponent(file.path)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`Unable to download ${file.path}: HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.url = url;
    error.currentFile = file.path;
    throw error;
  }
  const buffer = await response.arrayBuffer();
  if (Number(buffer.byteLength) !== Number(file.size)) {
    throw new Error(`Size mismatch for ${file.path}. Expected ${file.size}, got ${buffer.byteLength}.`);
  }
  const bytes = new Uint8Array(buffer);
  if (file.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== file.sha256) throw new Error(`SHA-256 mismatch for ${file.path} before upload.`);
  }
  return bytes;
}

let running = false;

async function run() {
  if (running) return;
  running = true;
  ui.startButton.disabled = true;
  ui.retryButton.classList.add('hidden');
  ui.errorBox.classList.add('hidden');
  setBadge('running', 'בפריסה');

  try {
    const result = await runDeploymentPipeline({
      jobId,
      apiCall,
      fetchImpl: fetch.bind(window),
      sha256: sha256Hex,
      createLibraryExact: createExactLibraryViaJsom,
      hostname: window.location.hostname,
      clientId: `standalone-deployer-${window.location.hostname}`,
      downloadFile: downloadStagedFile,
      setTimer: (fn, ms) => window.setInterval(fn, ms),
      clearTimer: (handle) => window.clearInterval(handle),
      onProgress: ({ progress, message, currentFile, stage }) => {
        setProgress(progress, message || stageLabel(stage), currentFile);
        if (message) log(`${stageLabel(stage) || stage}: ${message}${currentFile ? ` | ${currentFile}` : ''}`);
      },
    });

    setProgress(100, 'הפריסה הושלמה בהצלחה');
    setBadge('done', 'הושלם');
    ui.openSite.href = result.finalUrl;
    ui.openSite.classList.remove('hidden');
    log(`Deployment complete: ${result.finalUrl}`);
    notifyParent('deployment-complete', { finalUrl: result.finalUrl });
  } catch (error) {
    setBadge('failed', 'נכשל');
    const failure = error.failureInfo || {};
    const detail = [
      failure.stage ? `שלב: ${stageLabel(failure.stage)}` : '',
      failure.errorClass ? `סיווג: ${failure.errorClass}` : '',
      failure.httpStatus != null ? `HTTP ${failure.httpStatus}` : '',
      failure.sharePointCode ? `SP ${failure.sharePointCode}` : '',
    ].filter(Boolean).join(' · ');
    ui.errorBox.textContent = [error.message, detail, failure.nextAction].filter(Boolean).join('\n');
    ui.errorBox.classList.remove('hidden');
    ui.retryButton.classList.remove('hidden');
    log(`Deployment failed: ${error.message}`);
    notifyParent('deployment-failed', { error: error.message, stage: failure.stage || '' });
  } finally {
    running = false;
    ui.startButton.disabled = false;
  }
}

async function init() {
  try {
    if (!jobId || !apiBase) throw new Error('Missing jobId or apiBase in the URL.');
    const descriptor = await apiCall(`/api/deployments/${encodeURIComponent(jobId)}`, {});
    ui.subtitle.textContent = `${descriptor.site.name} · ריליס ${descriptor.release.version}`;
    ui.target.textContent = descriptor.site.finalUrl;
    ui.startButton.disabled = false;
    setProgress(0, 'מוכן לפריסה');
    log(`Loaded deployment ${jobId} for ${descriptor.site.host}${descriptor.site.siteRoot}`);
    if (descriptor.resume?.completedStages?.length) {
      log(`Resuming: ${descriptor.resume.completedStages.length} stage(s) already verified; continuing at ${stageLabel(descriptor.resume.resumeFrom)}.`);
    }
    notifyParent('deployer-ready', { target: descriptor.site.finalUrl, embedded });
    setTimeout(run, embedded ? 100 : 500);
  } catch (error) {
    setBadge('failed', 'לא ניתן להתחיל');
    ui.errorBox.textContent = error.message;
    ui.errorBox.classList.remove('hidden');
    log(`Initialization failed: ${error.message}`);
    notifyParent('deployer-init-failed', { error: error.message });
  }
}

ui.startButton.addEventListener('click', run);
ui.retryButton.addEventListener('click', run);
ui.toggleLogs.addEventListener('click', () => ui.logs.classList.toggle('hidden'));

init();
