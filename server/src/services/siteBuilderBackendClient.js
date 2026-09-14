const { config } = require("../config.js");

function profileForSite(site) {
  const profileId = String(site?.backendProfileId || '').trim();
  const profile = config.siteBuilderBackendProfiles[profileId];
  if (!profile) {
    const error = new Error(`Unknown Site Builder backend profile "${profileId}".`);
    error.statusCode = 409;
    error.code = 'BACKEND_PROFILE_NOT_FOUND';
    throw error;
  }
  const siteUrl = String(site.backendApiUrl || '').trim().replace(/\/+$/, '');
  if (siteUrl && siteUrl !== profile.url) {
    const error = new Error('Site backend URL does not match its approved server profile.');
    error.statusCode = 409;
    error.code = 'BACKEND_PROFILE_URL_MISMATCH';
    throw error;
  }
  return profile;
}

async function request(site, pathname, options = {}) {
  const profile = profileForSite(site);
  const response = await fetch(`${profile.url}${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': profile.apiKey,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(payload?.error || `Site Builder backend returned HTTP ${response.status}.`);
    error.statusCode = 502;
    error.code = payload?.code || 'SITE_BUILDER_BACKEND_ERROR';
    throw error;
  }
  return payload;
}

async function health(site) {
  const profile = profileForSite(site);
  const response = await fetch(`${profile.url}/api/health`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw Object.assign(new Error(`Site Builder health returned HTTP ${response.status}.`), { statusCode: 502, code: 'BACKEND_UNHEALTHY' });
  const payload = await response.json();
  if (payload.storageBackend !== 'mongo') {
    throw Object.assign(new Error('Configured backend does not report Mongo storage.'), { statusCode: 409, code: 'BACKEND_IDENTITY_MISMATCH' });
  }
  return payload;
}

function provision(site) {
  const siteId = encodeURIComponent(String(site.builderSiteId || ''));
  return request(site, `/api/sites/${siteId}/provision`, {
    method: 'POST',
    body: JSON.stringify({ siteSlug: site.siteCode, displayName: site.name, seed: true }),
  });
}

function provisionStatus(site) {
  return request(site, `/api/sites/${encodeURIComponent(String(site.builderSiteId || ''))}/provision-status`);
}

module.exports = { profileForSite, health, provision, provisionStatus };
