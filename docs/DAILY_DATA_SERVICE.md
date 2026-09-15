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
recorded upstream revision into `server/src/daily-data/v1/domain/source`.
Refresh intentionally with:

```sh
SITE_BUILDER_SOURCE_ROOT=/path/to/site-builder node scripts/sync-site-builder-data-module.mjs
```

The generator records the source revision in `manifest.json`. The CommonJS
server lazily loads this package-relative versioned module; it needs neither a
sibling checkout nor a second Node process or port.

## Authentication and authorization

Production daily-data access fails closed unless
`TRUSTED_IDENTITY_ENABLED=true` and IIS supplies the configured
`TRUSTED_IDENTITY_HEADER` (default `x-iisnode-auth_user`). The frontend cannot
authenticate with usernames, administrator flags, an Origin/Referer, a site
ID, or an API key. Direct Node binding must not be exposed outside IIS.

Development/test may use only `DAILY_DATA_DEV_IDENTITY_HEADER`; this fixture is
never trusted in production. Each Mongo management site stores per-site
`viewers`, `submitters`, `editors`, and `administrators`. Reads require viewer;
interaction scopes can require submitter; content writes require editor;
backups, repair, and administrator changes require administrator. Requests are
resolved against the management record by the immutable data-site ID before
the Site Builder repository is called.

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

## Closed-server package inputs

Include: `index.cjs`, `web.config`, `.env` (with `MONGO_URI`,
`MONGO_DB_NAME`, `BUILDER_DATA_MONGO_DB_NAME`, `PUBLIC_DAILY_DATA_API_URL`,
trusted IIS identity settings), `server/src/` including
`daily-data/v1/domain/`, and `server/node_modules/` including `zod`. Build
artifacts also require `client/dist/` and `sharepoint-deployer/client/dist/`.
Do not include a Site Builder checkout, development identity settings, API
keys, Mongo data files, `storage/`, or `.env` secrets in source control.
