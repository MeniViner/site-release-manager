const { config } = require('../../config.js');

function normalizedPrincipal(value) {
  return String(value || '').trim().toLowerCase();
}

function identityError(message, code = 'trusted_identity_required') {
  return Object.assign(new Error(message), { statusCode: 401, code });
}

function trustedIdentityForRequest(req) {
  if (config.nodeEnv === 'production') {
    if (!config.trustedIdentityEnabled) {
      throw identityError('Daily data access is disabled until the trusted IIS identity adapter is enabled.', 'trusted_identity_unavailable');
    }
    const principal = normalizedPrincipal(req.get(config.trustedIdentityHeader));
    if (!principal) {
      throw identityError('A trusted IIS identity is required for daily data access.', 'trusted_identity_required');
    }
    return principal;
  }

  const principal = normalizedPrincipal(req.get(config.dailyDataDevIdentityHeader));
  if (!principal) {
    throw identityError(`Development requests must include ${config.dailyDataDevIdentityHeader}.`, 'development_identity_required');
  }
  return principal;
}

function accessForCreator(principal) {
  return {
    viewers: [principal],
    submitters: [principal],
    editors: [principal],
    administrators: [principal],
    sharePointReadAccess: true,
    sharePointInteractionAccess: true,
  };
}

function createSharePointAccessResolver({ enabled, headerName } = {}) {
  return Object.freeze({
    allows(req, site, capability) {
      const access = site.dataAccess || {};
      const accessFlag = capability === 'submitters'
        ? access.sharePointInteractionAccess === true
        : access.sharePointReadAccess === true;
      if (!enabled || !accessFlag) return false;
      const values = String(req.get(headerName) || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      return values.includes(normalizedPrincipal(site.builderSiteId));
    },
  });
}

const sharePointAccessResolver = createSharePointAccessResolver({
  enabled: config.trustedSiteAccessEnabled,
  headerName: config.trustedSiteAccessHeader,
});

function hasRole(site, principal, role, req) {
  const access = site.dataAccess || {};
  const values = Array.isArray(access[role]) ? access[role] : [];
  const normalized = new Set(values.map(normalizedPrincipal));
  if (normalized.has(principal)) return true;
  if (role !== 'administrators' && hasRole(site, principal, 'administrators', req)) return true;
  if (role === 'viewers' || role === 'submitters') {
    return sharePointAccessResolver.allows(req, site, role);
  }
  return false;
}

module.exports = {
  accessForCreator,
  createSharePointAccessResolver,
  hasRole,
  normalizedPrincipal,
  trustedIdentityForRequest,
};
