/**
 * The management identity boundary.
 *
 * POST /api/auth/session is the ONE place the IIS-injected Windows identity is
 * consumed. It is the only management call the browser makes with credentials,
 * so it is the only one that can ever be drawn into an IIS authentication
 * handshake. Everything else authorizes from the returned bearer token and is
 * non-credentialed, which is what keeps an ordinary "create site" click from
 * turning into a native username/password dialog.
 *
 * Neither route emits WWW-Authenticate. A missing identity is an application
 * JSON refusal the UI can explain, never a browser challenge loop.
 */
const { Router } = require('express');
const { config } = require('../config.js');
const { trustedIdentityForRequest } = require('../daily-data/v1/identity.js');
const {
  bearerToken,
  issueManagementSession,
  verifyManagementSession,
} = require('../managementSession.js');

const authRouter = Router();

/**
 * Non-credentialed probe. Lets the UI render the right state without provoking
 * any authentication attempt, and reports whether the CURRENT bearer token is
 * still good so the client can refresh a session before it acts.
 */
authRouter.get('/whoami', (req, res) => {
  const session = verifyManagementSession(bearerToken(req));
  return res.json({
    ok: true,
    authenticated: Boolean(session),
    principal: session ? session.principal : null,
    expiresAt: session ? session.expiresAt : null,
    identitySource: config.trustedIdentityEnabled ? 'iis-trusted-header' : 'development-header',
  });
});

/**
 * Exchanges an already-authenticated Windows identity for a management session.
 *
 * `trustedIdentityForRequest` reads the header IIS stamps (web.config replaces
 * it unconditionally, so a browser-supplied value cannot reach here) and throws
 * 401 when it is absent. In production it additionally refuses the development
 * header outright.
 */
authRouter.post('/session', (req, res, next) => {
  try {
    const principal = trustedIdentityForRequest(req);
    const session = issueManagementSession(principal, {
      ttlSeconds: config.managementSessionTtlSeconds,
    });
    return res.status(201).json({
      ok: true,
      token: session.token,
      principal: session.principal,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    // Re-shape the identity refusal into guidance about the management session,
    // and make it unmistakably an application answer rather than a challenge.
    if (error?.statusCode === 401) {
      res.removeHeader('WWW-Authenticate');
      return res.status(401).json({
        ok: false,
        error: {
          code: 'management_identity_unavailable',
          message: 'לא זוהתה זהות Windows מאומתת עבור פעולות ניהול.',
          detail: config.trustedIdentityEnabled
            ? 'ודא ש-Windows Authentication פעיל ב-IIS ושהאתר נמצא ב-Local Intranet כדי שהזיהוי יתבצע בשקט.'
            : 'בסביבת פיתוח יש לשלוח את כותרת הזהות המיועדת לפיתוח.',
        },
      });
    }
    return next(error);
  }
});

/**
 * Gate for consequential management operations. Authorizes from the bearer
 * token only: it never reads an identity header, so a forged trusted header on
 * a management mutation is worth nothing.
 */
function requireManagementPrincipal(req, res, next) {
  const session = verifyManagementSession(bearerToken(req));
  if (!session) {
    res.removeHeader('WWW-Authenticate');
    return res.status(401).json({
      ok: false,
      error: {
        code: 'management_session_required',
        message: 'נדרשת התחברות ניהולית לפני ביצוע הפעולה.',
        detail: 'בקש הרשאת ניהול מחדש ונסה שוב.',
      },
    });
  }
  req.managementPrincipal = session.principal;
  req.managementSession = session;
  return next();
}

module.exports = { authRouter, requireManagementPrincipal };
