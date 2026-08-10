let apiBaseUrl = '';
let runtimeDescriptor = null;
let bootstrapDiagnostics = [];

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
    source: runtimeUrl.toString(),
  });

  if (typeof window !== 'undefined') window.__SITE_RELEASE_MANAGER_RUNTIME__ = runtimeDescriptor;
  console.info(`[release-manager] API runtime source: ${runtimeDescriptor.source}`);
  console.info(`[release-manager] API base: ${apiBaseUrl || 'same-origin'}`);
  return runtimeDescriptor;
}

export function getApiRuntime() {
  return runtimeDescriptor;
}

export function getApiBootstrapDiagnostics() {
  return bootstrapDiagnostics;
}

function resolveRequestUrl(path) {
  const relative = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
  return apiBaseUrl ? `${apiBaseUrl}${relative}` : relative;
}

async function request(path, options = {}) {
  const url = resolveRequestUrl(path);
  const response = await fetch(url, options);
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
  config: () => request('/api/config'),
  dashboard: () => request('/api/dashboard'),
  sites: () => request('/api/sites'),
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
