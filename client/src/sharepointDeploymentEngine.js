/**
 * In-page SharePoint deployment worker.
 *
 * This is a thin adapter: the deployment sequence itself lives in
 * shared/deploymentPipeline.js, which the standalone SharePoint Deployer also
 * runs. Keeping one implementation is what stops the fallback path from
 * drifting away from the eventual-consistency handling.
 *
 * NODE/BROWSER BOUNDARY: everything below requires the authenticated SharePoint
 * session — cookies, FormDigest, REST and JSOM. None of it runs on Node.
 */

import { resolveApiUrl } from './api.js';
import { runDeploymentPipeline, describeFailure } from '../../shared/deploymentPipeline.js';
import { sha256Hex, createExactLibraryViaJsom, workerClientId } from './sharepoint/browserAdapters.js';

async function apiCall(path, options = {}, leaseId = '') {
  const headers = { ...(options.headers || {}) };
  if (leaseId) headers['X-SRM-Lease'] = leaseId;
  const url = resolveApiUrl(path);
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!response.ok) {
    const error = new Error(typeof body === 'string' ? body : body?.error || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.apiCode = body?.code || '';
    error.url = url;
    throw error;
  }
  return body;
}

/** Fetch one staged file from the local API and verify it before uploading. */
async function downloadStagedFile(jobId, file) {
  const url = resolveApiUrl(`/api/deployments/${encodeURIComponent(jobId)}/file?path=${encodeURIComponent(file.path)}`);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`לא ניתן להוריד ${file.path} מה-Staging המקומי: HTTP ${response.status}`);
    error.httpStatus = response.status;
    error.url = url;
    error.currentFile = file.path;
    throw error;
  }
  const buffer = await response.arrayBuffer();
  if (Number(buffer.byteLength) !== Number(file.size)) {
    throw new Error(`גודל שגוי ל-${file.path}: צפוי ${file.size}, התקבל ${buffer.byteLength}.`);
  }
  const bytes = new Uint8Array(buffer);
  if (file.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== file.sha256) throw new Error(`SHA-256 שגוי ל-${file.path} לפני ההעלאה.`);
  }
  return bytes;
}

export async function deploySharePointJob(jobId, { onProgress = () => {}, signal } = {}) {
  return runDeploymentPipeline({
    jobId,
    apiCall,
    fetchImpl: fetch.bind(window),
    sha256: sha256Hex,
    createLibraryExact: createExactLibraryViaJsom,
    hostname: window.location.hostname,
    clientId: workerClientId(),
    downloadFile: (file) => downloadStagedFile(jobId, file),
    setTimer: (fn, ms) => window.setInterval(fn, ms),
    clearTimer: (handle) => window.clearInterval(handle),
    onProgress,
    signal,
  });
}

export { describeFailure };
