/**
 * Management session tokens.
 *
 * Why this exists
 * ---------------
 * Mongo site creation used to authorize straight off the IIS-injected Windows
 * identity header, and the browser opted into that handshake with
 * `credentials: 'include'`. When IIS could not authenticate silently it replied
 * 401 + WWW-Authenticate, and because the browser was allowed to join the
 * negotiation that escalated into a NATIVE username/password dialog -- on an
 * ordinary "create site" click.
 *
 * The fix is to consume the Windows identity in exactly ONE deliberate place
 * (POST /api/auth/session) and to carry the result on every other management
 * call as a bearer token. Those calls are non-credentialed, so the browser can
 * never be drawn into an authentication handshake by routine application
 * traffic, and an expired session surfaces as application JSON the UI can act
 * on instead of a native loop.
 *
 * The token is a signed assertion ABOUT an already-authenticated principal. It
 * is not a credential the caller can mint: the HMAC is over the principal, the
 * issue time and the expiry, using a server-held secret.
 */
const crypto = require('node:crypto');
const { config } = require('./config.js');

const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const TOKEN_VERSION = 'v1';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signingSecret() {
  const secret = String(config.managementSessionSecret || '');
  if (!secret) {
    // config.js already refuses to boot production without a secret; this guard
    // keeps a misconfigured development process from minting forgeable tokens.
    throw Object.assign(new Error('Management sessions are unavailable: no signing secret is configured.'), {
      statusCode: 503,
      code: 'management_session_unavailable',
    });
  }
  return secret;
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', signingSecret()).update(payloadB64).digest('base64url');
}

function issueManagementSession(principal, { ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now() } = {}) {
  const subject = String(principal || '').trim().toLowerCase();
  if (!subject) {
    throw Object.assign(new Error('A management session requires an authenticated principal.'), {
      statusCode: 401,
      code: 'management_identity_unavailable',
    });
  }
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS);
  const payloadB64 = base64url(JSON.stringify({ v: TOKEN_VERSION, sub: subject, iat: issuedAt, exp: expiresAt }));
  return { token: `${payloadB64}.${sign(payloadB64)}`, principal: subject, issuedAt, expiresAt };
}

function verifyManagementSession(token, { now = Date.now() } = {}) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, providedSignature] = parts;

  let expectedSignature;
  try {
    expectedSignature = sign(payloadB64);
  } catch {
    return null;
  }
  const provided = Buffer.from(String(providedSignature), 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  // Length must match before timingSafeEqual, and comparing this way keeps the
  // check constant-time so the signature cannot be probed byte by byte.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || payload.v !== TOKEN_VERSION) return null;
  const subject = String(payload.sub || '').trim().toLowerCase();
  if (!subject) return null;
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= now) return null;
  return { principal: subject, issuedAt: payload.iat, expiresAt: payload.exp };
}

function bearerToken(req) {
  const header = String(req.get('authorization') || '');
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  bearerToken,
  issueManagementSession,
  verifyManagementSession,
};
