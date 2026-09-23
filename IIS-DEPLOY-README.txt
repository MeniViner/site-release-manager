IIS DEPLOYMENT - SITE RELEASE MANAGER

Canonical artifacts are separate:
1. API: npm run package:iis-server-only
2. Release Manager UI: client/dist
3. SharePoint deployment worker: sharepoint-deployer/client/dist

The API artifact is flat:
  web.config
  index.cjs
  package.json
  package-lock.json
  .env.example
  deployment-manifest.json
  src/
  node_modules/

src/index.js is the single startup implementation. index.cjs is a one-line IIS
handler wrapper that allows src to remain blocked from direct HTTP access.
web.config intentionally emits no <iisnode> section.

Never transfer a macOS/Linux executable as node.exe. A package produced away
from Windows is explicitly marked windowsRuntimeIncluded=false and
windowsDependencyCompatibilityValidated=false. Install npm ci --omit=dev from
the matching lockfile on Windows or supply a separately verified Windows
runtime/dependency payload.

Before replacement:
- Stop only the siteReleaseManager application pool.
- Preserve the destination .env and storage directory.
- Do not copy .env.example over the real .env.
- Do not delete releases, deployment history, backups, or Mongo data.

Production prerequisites:
- NODE_ENV=production and every required variable from .env.example.
- IISNode and URL Rewrite installed; application pool uses No Managed Code.
- The application is not directly reachable behind the trusted IIS boundary.
- Integrated Windows Authentication succeeds silently for the approved URL.
- HTTP_X_IISNODE_AUTH_USER is overwritten from AUTH_USER and reaches Node as
  x-iisnode-auth-user.
- httpErrors existingResponse=PassThrough preserves application JSON errors.

After replacement, start only the siteReleaseManager application pool. Verify
/api/health, then perform an authorized Mongo create/read/write/backup flow and
a TXT update flow. A health response alone is not acceptance.
