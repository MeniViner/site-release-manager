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

/**
 * Per-site access is granted ONLY by each site's explicit dataAccess lists.
 *
 * There was previously a second path that derived baseline viewer/submitter
 * access from an `x-iisnode-sharepoint-sites` request header. Nothing on the
 * server could populate that header -- this process has no AD, LDAP, Graph or
 * SharePoint client, and URL Rewrite cannot derive per-site membership -- so its
 * only possible source was the caller. Any user could have listed a site id and
 * granted themselves access to it. The path is removed rather than left as a
 * disabled placeholder.
 *
 * `dataAccess.sharePointReadAccess` / `sharePointInteractionAccess` are still
 * PERSISTED for backward compatibility with existing documents, but they no
 * longer grant anything on their own.
 */
function hasRole(site, principal, role) {
  const subject = normalizedPrincipal(principal);
  // An absent principal can never match a grant.
  if (!subject) return false;
  const access = site?.dataAccess || {};
  const values = Array.isArray(access[role]) ? access[role] : [];
  if (values.map(normalizedPrincipal).includes(subject)) return true;
  // Administrators inherit the lesser roles, but nothing inherits upward.
  if (role !== 'administrators') return hasRole(site, subject, 'administrators');
  return false;
}

module.exports = {
  accessForCreator,
  hasRole,
  normalizedPrincipal,
  trustedIdentityForRequest,
};
