# Embedded Site Builder daily-data service

## Implementation map and route contract

The SharePoint-hosted Site Builder frontend uses its deployed runtime overlay:

```text
SharePoint Site Builder frontend
  -> PUBLIC_DAILY_DATA_API_URL (/api/daily-data/v1)
  -> Site Release Manager Express application
  -> BUILDER_DATA_MONGO_DB_NAME
```

Release Manager management remains under `/api/*`; no daily-data route uses
`/api/sites`, so the two products cannot collide. Site Builder calls:

| Operation | Route |
| --- | --- |
| Compatibility health | `GET /api/daily-data/v1/healthz` |
| Data-plane readiness | `GET /api/daily-data/v1/readyz` |
| Legacy object read/write | `GET` / `PUT /api/daily-data/v1/sites/:siteId/legacy-object` |
| Scoped document operations | `GET`, `PUT`, `PATCH`, `DELETE /api/daily-data/v1/sites/:siteId/data/:scope/:entityId` |
| Scoped batch operations | `POST /api/daily-data/v1/sites/:siteId/data/batch-read` and `batch-write` |
| Site backups | `/api/daily-data/v1/sites/:siteId/backups` |
| Explicit repair only | `POST /api/daily-data/v1/sites/:siteId/provision` with `{ "repair": true }` |

The Site Builder Mongo repositories, legacy mappings, validation, optimistic
concurrency, canonical provisioning, and backups are generated from the
recorded upstream revision into
`server/src/daily-data/v1/domain/domain.js`.
Refresh intentionally with:

```sh
SITE_BUILDER_SOURCE_ROOT=/path/to/site-builder node scripts/sync-site-builder-data-module.mjs
```

The generator records the source revision in `manifest.json` and uses esbuild
at generation time to emit a self-contained CommonJS module. The IIS runtime
loads it with `require()`; it contains no nested module metadata, ESM syntax,
or dynamic import. It needs neither a sibling checkout nor a second Node
process or port.

## Authentication and authorization

Production daily-data access fails closed unless
`TRUSTED_IDENTITY_ENABLED=true` and IIS supplies the configured
`TRUSTED_IDENTITY_HEADER` (default `x-iisnode-auth-user`). The frontend cannot
authenticate with usernames, administrator flags, an Origin/Referer, a site
ID, or an API key. Direct Node binding must not be exposed outside IIS.

Development/test may use only `DAILY_DATA_DEV_IDENTITY_HEADER`; this fixture is
never trusted in production. Each Mongo management site stores per-site
`viewers`, `submitters`, `editors`, and `administrators`. Reads require viewer;
interaction scopes require submitter; content writes require editor; backups,
repair, provisioning, and access administration require administrator.

For normal SharePoint users, enable `TRUSTED_SITE_ACCESS_ENABLED` and configure
IIS (or a trusted server-side authorization adapter) to strip the browser's
`TRUSTED_SITE_ACCESS_HEADER` and inject the authenticated user's exact
comma-separated `builderSiteId` authorization list. A matching site assertion
allows only normal reads and supported `interaction*` writes. It never grants
editor or administrator access, and one site's assertion never authorizes a
different site. If this site/group authorization cannot be injected and
verified, normal access is denied rather than inferred from Origin, Referer,
or a browser username. Elevated writes always fail closed without an explicit
per-site role.

The SharePoint-hosted Release Manager browser sends `credentials: "include"`
only for `POST /api/sites` when creating Mongo sites and
`PATCH /api/sites/:id/data-access`. Those two paths return credentialed CORS
only for configured SharePoint origins. General management CORS remains
non-credentialed. IIS Windows Authentication must establish the principal without a browser
credential dialog for the approved internal URL. The trusted boundary must
overwrite any browser-supplied identity value. URL Rewrite server variable
`HTTP_X_IISNODE_AUTH_USER` is exposed to Node as
`x-iisnode-auth-user` (hyphens, not an underscore). The generated
`web.config` assigns it from `AUTH_USER`; this mapping and silent integrated
authentication remain real-environment acceptance gates. Direct access to the
Node backend must not bypass IIS.

Daily-data CORS permits configured SharePoint origins plus credentialed
`PUT`/`PATCH` preflight. Management CORS remains non-credentialed. CORS is not
an authorization decision.

## Persistence matrix

| Feature | TXT persistence | Mongo equivalent | SharePoint retained |
| --- | --- | --- | --- |
| Configuration | `bihs_master_config_v1.txt` | `config:master` plus legacy manifest | Hosted frontend |
| Administrators | `users_data.txt` | `admins` documents | Existing SharePoint identity/groups |
| Events | `events_data.txt` | `events` documents + settings meta | Hosted frontend |
| Navigation | `nav_data.txt` | `navigation` documents | Navigation integration |
| Site content | `site_content_data.txt` | `content:site` | HTML/CSS/JS hosting |
| Theme | `theme_data.txt` | `design:theme` | Theme assets |
| Widgets / widget interactions | `widgets_data.txt` | `widgets:config` and interaction scopes | Widget media/files |
| External links | `external_links_data.txt` | `externalLinks` documents | Link targets/integration |
| Gantt | `gantt_data.txt` | `gantt:settings` | Hosted UI |
| BOOM | `boom_data.txt` | `boom:settings` | Hosted UI |
| Gallery metadata | legacy or structured app objects | `legacy`/scoped documents | Image bytes remain in libraries |
| Other legacy keys | TXT object path | `legacy:<path>` singleton | Any referenced files remain in SharePoint |
| Backups | TXT backup folders | Site Builder backup collections | SharePoint files are not copied to Mongo |

Mongo stores structured JSON and SharePoint references only. Image bytes,
uploaded documents, attachments, libraries, folders, and SharePoint API
features remain in SharePoint for both storage modes.

## Server-only IIS artifact

Run `npm run package:iis-server-only` on the source workstation, then
`npm run verify:iis-server-only`. The output is a flat, isolated API folder:

```text
web.config
index.cjs
package.json
package-lock.json
.env.example
deployment-manifest.json
IIS-DEPLOY-README.txt
src/
node_modules/
runtime/node.exe             (only when actually packaged and verified on Windows)
```

It deliberately excludes `.env`, `storage/`, Mongo data, releases,
deployments, client source/build, the SharePoint deployer, Git files, tests,
and development artifacts. Preserve the closed server's live `.env` and
`storage/` before whitening, then replace only the artifact files. The flat layout is intentional: `src/index.js` is the sole startup
implementation and `index.cjs` is a one-line protected IIS handler wrapper.
Dependencies remain beside `src/` in `node_modules/`. The generated
`web.config` has no `<iisnode>` section.
