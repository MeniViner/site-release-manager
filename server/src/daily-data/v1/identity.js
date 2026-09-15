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
  };
}

function hasRole(site, principal, role) {
  const access = site.dataAccess || {};
  const values = Array.isArray(access[role]) ? access[role] : [];
  const normalized = new Set(values.map(normalizedPrincipal));
  if (normalized.has(principal)) return true;
  return role !== 'administrators' && hasRole(site, principal, 'administrators');
}

module.exports = {
  accessForCreator,
  hasRole,
  trustedIdentityForRequest,
};
