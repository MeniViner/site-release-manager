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


WHERE EACH ARTIFACT GOES
------------------------
The topology is a SharePoint-hosted UI plus an ISOLATED IIS API. The three
frontend artifacts are NOT copied into the API application folder.

1. API (server-only package)  -> the IIS application folder, e.g. C:\inetpub\srm-api
   Replace only: index.cjs, web.config, package.json, package-lock.json,
   src/, node_modules/. Never the destination .env or storage/.

2. Release Manager UI (client/dist) -> the SharePoint library that hosts the
   management UI, e.g. /sites/tools/SiteAssets/site-release-manager/
   Configured by CLIENT_ORIGINS on the API side; the UI finds the API through
   release-manager-runtime-config.json / .txt shipped beside it.

3. SharePoint deployment worker (sharepoint-deployer/client/dist) -> the library
   named by SHAREPOINT_DEPLOYER_PATH, default
   /sites/tools/SiteAssets/site-release-deployer/

4. Site Builder Universal (dist-universal) -> NOT placed by hand. It is uploaded
   as a Release through the Release Manager UI and deployed to each target.


REQUIRED IIS PREREQUISITES
--------------------------
Windows Authentication role service must be installed, with Negotiate listed
before NTLM.

URL Rewrite SILENTLY refuses to set a server variable that is not allow-listed.
Without the two entries below the trusted identity header stays EMPTY and every
management session is refused with no obvious cause:

  allowedServerVariables must contain
    HTTP_X_IISNODE_AUTH_USER
    HTTP_X_IISNODE_SHAREPOINT_SITES

  Add-WebConfiguration -Filter '/system.webServer/rewrite/allowedServerVariables' ^
    -PSPath 'MACHINE/WEBROOT/APPHOST' -Value @{name='HTTP_X_IISNODE_AUTH_USER'}
  Add-WebConfiguration -Filter '/system.webServer/rewrite/allowedServerVariables' ^
    -PSPath 'MACHINE/WEBROOT/APPHOST' -Value @{name='HTTP_X_IISNODE_SHAREPOINT_SITES'}

Authentication is route-specific and ships in web.config: the application
baseline is ANONYMOUS so Bearer-authorized management calls are never challenged;
only /api/auth/session and /api/daily-data/v1/sites require Windows. This is not
anonymous management - every consequential mutation requires a signed management
session inside the application.

MANAGEMENT_SESSION_SECRET is REQUIRED in production (32+ chars). Generate it with
a cryptographic generator, NOT Get-Random:

  $bytes = [byte[]]::new(48)
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes)


OFFLINE DEPENDENCIES
--------------------
Do NOT plan on running `npm ci` inside the closed environment; there is no
registry there. node_modules/ is shipped inside the API artifact, resolved on the
build machine. The deployment manifest records
windowsDependencyCompatibilityValidated=false because the build host is not
Windows.

If a dependency turns out to need a native Windows build, use ONE of:
  a) build the artifact on a Windows host, or
  b) `npm ci --omit=dev` against an approved internal registry mirror, or
  c) carry an `npm pack`/cache tarball set in and
     `npm ci --omit=dev --offline --cache <carried-cache>`
Record which route was used in the acceptance report.

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
