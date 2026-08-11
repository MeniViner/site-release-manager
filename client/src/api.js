let apiBaseUrl = '';
let runtimeDescriptor = null;
let bootstrapDiagnostics = [];
let apiHealthDiagnostics = null;

const RUNTIME_CONFIG_FILES = Object.freeze([
  // TXT is tried first because classic/restricted SharePoint libraries serve it reliably.
  'release-manager-runtime-config.txt',
  'release-manager-runtime-config.json',
]);

const stripTrailingSlashes = (value) => String(value || '').trim().replace(/\/+$/g, '');

function normalizeApiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'same-origin') return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Runtime API URL is invalid: ${raw}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Runtime API URL must use http or https: ${raw}`);
  }
  parsed.hash = '';
  parsed.search = '';
  return stripTrailingSlashes(parsed.toString());
}

function bodyPreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 260);
}

function looksLikeHtml(text, contentType = '') {
  const preview = String(text || '').trim().slice(0, 200).toLowerCase();
  return String(contentType || '').toLowerCase().includes('text/html')
    || preview.startsWith('<!doctype html')
    || preview.startsWith('<html')
    || preview.includes('<head>');
}

function publishBootstrapDiagnostics(attempts) {
  bootstrapDiagnostics = attempts.map((item) => Object.freeze({ ...item }));
  if (typeof window !== 'undefined') {
    window.__SITE_RELEASE_MANAGER_BOOTSTRAP_DIAGNOSTICS__ = bootstrapDiagnostics;
  }
}

async function loadProductionRuntimeConfig() {
  const attempts = [];
  const base = document.baseURI || window.location.href;

  for (const fileName of RUNTIME_CONFIG_FILES) {
    const runtimeUrl = new URL(`./${fileName}`, base);
    const attempt = {
      fileName,
      url: runtimeUrl.toString(),
      status: 0,
      statusText: '',
      contentType: '',
      ok: false,
      preview: '',
      error: '',
    };

    try {
      const response = await fetch(runtimeUrl, { cache: 'no-store' });
      attempt.status = response.status;
      attempt.statusText = response.statusText;
      attempt.contentType = response.headers.get('content-type') || '';
      attempt.ok = response.ok;
      const text = await response.text();
      attempt.preview = bodyPreview(text);

      if (!response.ok) {
        attempt.error = `HTTP ${response.status} ${response.statusText}`;
        attempts.push(attempt);
        continue;
      }

      if (looksLikeHtml(text, attempt.contentType)) {
        attempt.error = 'SharePoint returned HTML instead of runtime JSON.';
        attempts.push(attempt);
        continue;
      }

      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        attempt.error = `Invalid JSON: ${error.message}`;
        attempts.push(attempt);
        continue;
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        attempt.error = 'Runtime config must contain a JSON object.';
        attempts.push(attempt);
        continue;
      }

      attempts.push(attempt);
      publishBootstrapDiagnostics(attempts);
      return { payload, runtimeUrl };
    } catch (error) {
      attempt.error = error?.message || String(error);
      attempts.push(attempt);
    }
  }

  publishBootstrapDiagnostics(attempts);
  const lines = attempts.map((attempt, index) => [
    `#${index + 1} ${attempt.url}`,
    `status=${attempt.status || 'network-error'} ${attempt.statusText || ''}`.trim(),
    `content-type=${attempt.contentType || 'unknown'}`,
    `error=${attempt.error || 'unknown'}`,
    `preview=${attempt.preview || '(empty)'}`,
  ].join(' | '));

  throw new Error(`Release Manager runtime config could not be loaded.\n${lines.join('\n')}`);
}

export async function initializeApiRuntime() {
  if (runtimeDescriptor) return runtimeDescriptor;

  // Local Vite development intentionally keeps /api relative so the existing
  // Vite proxy continues to route requests to the Express server on port 4300.
  if (import.meta.env.DEV) {
    runtimeDescriptor = Object.freeze({
      schemaVersion: 1,
      apiBaseUrl: '',
      source: 'vite-dev-proxy',
    });
    if (typeof window !== 'undefined') window.__SITE_RELEASE_MANAGER_RUNTIME__ = runtimeDescriptor;
    return runtimeDescriptor;
  }

  const { payload, runtimeUrl } = await loadProductionRuntimeConfig();
  apiBaseUrl = normalizeApiBaseUrl(payload.apiBaseUrl);
  if (!apiBaseUrl && payload.apiBaseUrl !== 'same-origin') {
    throw new Error('Release Manager runtime config is missing apiBaseUrl.');
  }

  runtimeDescriptor = Object.freeze({
    schemaVersion: Number(payload.schemaVersion || 1),
    apiBaseUrl,
    configuredApiBaseUrl: String(payload.apiBaseUrl || ''),
    generatedAt: String(payload.generatedAt || ''),
    generatedBy: String(payload.generatedBy || ''),
    appVersion: String(payload.appVersion || ''),
    source: runtimeUrl.toString(),
  });

  if (typeof window !== 'undefined') window.__SITE_RELEASE_MANAGER_RUNTIME__ = runtimeDescriptor;
  console.info(`[release-manager] API runtime source: ${runtimeDescriptor.source}`);
  console.info(`[release-manager] API base: ${apiBaseUrl || 'same-origin'}`);
  if (runtimeDescriptor.appVersion) console.info(`[release-manager] Runtime config app version: ${runtimeDescriptor.appVersion}`);
  return runtimeDescriptor;
}

export function getApiRuntime() {
  return runtimeDescriptor;
}

export function getApiBootstrapDiagnostics() {
  return bootstrapDiagnostics;
}

export function getApiHealthDiagnostics() {
  return apiHealthDiagnostics;
}

function resolveRequestUrl(path) {
  const relative = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  return apiBaseUrl ? `${apiBaseUrl}${relative}` : relative;
}

export async function verifyApiHealth() {
  const url = resolveRequestUrl('/api/health');
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    let payload = null;
    try { payload = rawText ? JSON.parse(rawText) : null; } catch { payload = null; }
    const apiVersion = String(payload?.appVersion || '');
    const runtimeVersion = String(runtimeDescriptor?.appVersion || '');
    const versionMatches = !apiVersion || !runtimeVersion || apiVersion === runtimeVersion;
    apiHealthDiagnostics = Object.freeze({
      ok: response.ok && payload?.ok === true && versionMatches,
      url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      preview: bodyPreview(rawText),
      durationMs: Date.now() - startedAt,
      runtimeSource: runtimeDescriptor?.source || '',
      apiBaseUrl: apiBaseUrl || 'same-origin',
      apiVersion,
      runtimeVersion,
      versionMatches,
    });
    if (!versionMatches) {
      const error = new Error(`Release Manager UI/API version mismatch: runtime=${runtimeVersion}, api=${apiVersion}. Restart/update the local API before continuing.`);
      error.code = 'API_VERSION_MISMATCH';
      error.url = url;
      throw error;
    }
    if (!apiHealthDiagnostics.ok) {
      const error = new Error(`Release Manager API health check failed at ${url} (HTTP ${response.status}).`);
      error.code = 'API_HEALTH_FAILED';
      error.url = url;
      throw error;
    }
    if (typeof window !== 'undefined') window.__SITE_RELEASE_MANAGER_API_DIAGNOSTICS__ = apiHealthDiagnostics;
    return apiHealthDiagnostics;
  } catch (error) {
    if (!apiHealthDiagnostics || apiHealthDiagnostics.ok) {
      apiHealthDiagnostics = Object.freeze({
        ok: false,
        url,
        status: 0,
        statusText: '',
        contentType: '',
        preview: '',
        durationMs: Date.now() - startedAt,
        runtimeSource: runtimeDescriptor?.source || '',
        apiBaseUrl: apiBaseUrl || 'same-origin',
        error: error?.message || String(error),
      });
    }
    if (typeof window !== 'undefined') window.__SITE_RELEASE_MANAGER_API_DIAGNOSTICS__ = apiHealthDiagnostics;
    const loopbackHint = /127\.0\.0\.1|localhost/i.test(url)
      ? ' Keep `npm run sharepoint:local` running on this Windows computer while the Release Manager UI is opened from SharePoint.'
      : '';
    const wrapped = new Error(`Release Manager API is unreachable at ${url}.${loopbackHint}`);
    wrapped.code = 'API_UNREACHABLE';
    wrapped.url = url;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function request(path, options = {}) {
  const url = resolveRequestUrl(path);
  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    const hint = /127\.0\.0\.1|localhost/i.test(url)
      ? ' Keep `npm run sharepoint:local` running on this Windows computer.'
      : '';
    const error = new Error(`Failed to reach Release Manager API: ${url}.${hint}`);
    error.code = 'API_NETWORK_ERROR';
    error.url = url;
    error.cause = cause;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();
  let payload = null;
  if (contentType.includes('application/json') && rawText) {
    try { payload = JSON.parse(rawText); } catch { payload = null; }
  }
  if (!response.ok) {
    const preview = bodyPreview(rawText);
    const error = new Error(payload?.error || `HTTP ${response.status}${preview ? ` — ${preview}` : ''}`);
    error.status = response.status;
    error.payload = payload;
    error.url = url;
    error.contentType = contentType;
    error.preview = preview;
    throw error;
  }
  return payload;
}

export const api = {
  health: () => request('/api/health'),
  config: () => request('/api/config'),
  dashboard: () => request('/api/dashboard'),
  sites: () => request('/api/sites'),
  site: (id) => request(`/api/sites/${id}`),
  createSite: (body) => request('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  updateSite: (id, body) => request(`/api/sites/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteSite: (id) => request(`/api/sites/${id}`, { method: 'DELETE' }),
  deploy: (siteId, releaseId, { force = false } = {}) => request(`/api/sites/${siteId}/deploy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ releaseId, force }) }),
  releases: () => request('/api/releases'),
  releaseVersionSuggestions: () => request('/api/releases/version-suggestions'),
  uploadRelease: (formData) => request('/api/releases/upload', { method: 'POST', body: formData }),
  uploadReleaseFolder: (formData) => request('/api/releases/upload-folder', { method: 'POST', body: formData }),
  updateRelease: (id, body) => request(`/api/releases/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteRelease: (id) => request(`/api/releases/${id}`, { method: 'DELETE' }),
  job: (id) => request(`/api/jobs/${id}`),
  verifyLocalDeployment: (id) => request(`/api/deployments/${id}/verify-local`, { method: 'POST' }),
  runs: () => request('/api/runs?limit=100'),
  run: (id) => request(`/api/runs/${id}`),
};
