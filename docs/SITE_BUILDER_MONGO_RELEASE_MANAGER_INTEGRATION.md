# Site Builder Mongo × Release Manager — Future Integration Architecture

**Status: analysis and design only. Nothing in this document is implemented.**

This document is the output of a read-only study of the Site Builder repository
as it exists on disk (branch `codex/dev-ai-engine`, working tree including
uncommitted changes). It describes what a future workstream would have to build
so that Release Manager can create and update **Mongo-backed** Site Builder
sites, the way it now creates and updates TXT-backed ones.

It deliberately changes nothing. The TXT pipeline must reach Windows acceptance
first; only then should this workstream begin.

> Every file path below is in `/Users/meni/dev/site-builder` unless it starts
> with `server/src/` in a Release Manager context, which is stated explicitly.

---

## 0. What exists today (the honest baseline)

| Capability | Status in Site Builder today |
|---|---|
| Mongo storage backend for site data | **Exists** and is complete |
| Per-site physical collection + `siteId` on every document | **Exists** |
| Site registry (`sites` collection) | **Exists** |
| Index migration tool | **Exists** (`npm run mongo:indexes`) |
| TXT → Mongo migration | **Exists** (`server/scripts/migrateSharePointToMongo.js`) |
| Application-level per-site backup/restore | **Exists** (`SiteBackupRepository`) |
| Windows/IIS packaging of the Node backend | **Exists** (`scripts/server-colocation/`) |
| **Seeding a brand-new Mongo site with initial content** | **DOES NOT EXIST** |
| **A backend/schema version exposed over HTTP** | **DOES NOT EXIST** |
| **Per-site authentication** | **DOES NOT EXIST** (one global `ADMIN_API_KEY`) |
| Transactions / replica set requirement | Not used; standalone Mongo is fine |

The three gaps in bold are the substance of the future workstream. Everything
else is integration work against APIs that already exist.

---

## 1. What "create a new Mongo Site Builder site" actually means

It is **not** a new database and **not** a schema creation step. Concretely it is:

1. **One row in the global `sites` registry.** `SiteDataRepository.ensureSite()`
   inserts `{ siteId, siteSlug, safeCollectionName, displayName, status,
   publicRead, schemaVersion: 1, createdAt, updatedAt, createdBy, updatedBy }`.
2. **One physical per-site collection**, named
   `sanitizeSiteCollectionName(`${siteSlug}:${siteId}`)` → `site_<slug>_<10 hex
   of sha256>`. The hash suffix is what makes two similar slugs safe.
3. **Three indexes on that collection** (`{siteId,scope,entityId,deletedAt}`,
   `{siteId,scope,updatedAt}`, `{hash}`).
4. **Seed documents** — *this is the missing piece.* `ensureSite()` writes
   **zero** data documents. A site created today is registered but empty: no
   master config, no theme, no navigation, no widgets.
5. **A runtime config** on the SharePoint side pointing the frontend at the
   backend (`storageBackend: "mongo"`, `siteId`, `backendApiUrl`).
6. **The static frontend**, deployed exactly as it is today — the Universal
   artifact is backend-agnostic (`storageCompatibility: ["txt","mongo"]`).

So "create a Mongo site" = register + seed + deploy frontend + point runtime
config at the backend. Only step 4 needs new code in Site Builder.

---

## 2. What a new Mongo site needs

| Thing | Needed? | Notes |
|---|---|---|
| A new database | **No** | One database holds all sites |
| New collections | **Yes, one** | `site_<slug>_<hash>`, created implicitly on first write |
| A `siteId` | **Yes** | The primary identity; unique index on `sites.siteId` |
| Seed documents | **Yes** | Currently nobody writes them — see §3 |
| Indexes | **Yes, three** | Created by `ensureSite()`; global ones by the migration tool |
| Filesystem folders | **No** | Mongo-backed sites store no site data on disk |
| SharePoint libraries | **Yes, but fewer** | Still needed for the frontend `dist` and for images/assets; the TXT data libraries are not needed for data |
| Runtime configuration | **Yes** | `storageBackend`, `siteId`, `backendApiUrl` |

**Important nuance for SharePoint:** a Mongo-backed site still needs a place to
serve `index.html` from, so `siteDbFolder`/`dist` remains. Whether
`siteUsersDb` and `siteAssets` are still required depends on whether images
continue to live in SharePoint. That decision must be made explicitly at the
start of the workstream, because it changes what Release Manager provisions.

---

## 3. Who should own initial Mongo provisioning

**Site Builder should own it. Release Manager should call it.**

Rationale: the seed payloads are Site Builder domain data (master config, theme
defaults, gantt defaults, boom defaults). Release Manager must not encode
another system's domain defaults — that is exactly the drift this project has
already had to correct once for the TXT seed list.

Recommended shape:

```
POST /api/sites/:siteId/provision
  body: { siteSlug, displayName, seed: true }
  → 201 { siteId, safeCollectionName, seeded: [ ...legacy keys... ] }
  → 200 { ...., seeded: [] }   when the site already has data (idempotent)
```

The implementation should reuse the payloads already written for TXT in
`scripts/init-sharepoint-site.js` (master config `{schemaVersion:'1.0.0'}`,
`users: []`, `events: {displayCount:3,displayMode:'default',events:[]}`,
`navigation: []`, `siteContent: {}`, `theme: {}`, `widgets: {}`,
`externalLinks: []`, `DEFAULT_GANTT_DATA`, `createInitialBoomData()`), written
through `PUT /api/sites/:siteId/legacy-object` so the legacy manifest/version
envelope is created correctly.

It must be **idempotent and non-destructive**: seed only what is missing, never
overwrite existing data. This is the same rule the TXT pipeline already enforces.

---

## 4. Who should own schema migrations

**Site Builder.** Release Manager must never write to Site Builder application
collections — the same boundary that already stops it from touching TXT data.

Site Builder already has the right tool shape: `npm run mongo:indexes` is
dry-run by default and requires `--apply --confirm BUILDER_INDEX_MIGRATION`.
A future data migration should follow that pattern exactly.

Release Manager's role is to **detect and report**, not to migrate: it should be
able to say "this backend is at schema 1, this release needs schema 2, run the
Site Builder migration first" and refuse to deploy.

---

## 5. How Release Manager determines backend compatibility

**This is the largest missing piece.** Today nothing correlates a frontend
release with a backend build or a data shape:

- `GET /healthz` returns `{ ok, service, storageBackend, time }` — no version.
- `GET /api/readyz` returns `{ ok, service, readiness }` — no version.
- `schemaVersion: 1` is written on every document but nothing ever reads it.

**Required Site Builder change** — extend the health payload:

```json
{
  "ok": true,
  "service": "site-builder-api",
  "storageBackend": "mongo",
  "appVersion": "2.4.0",
  "gitCommit": "…",
  "dataSchemaVersion": 1,
  "supportedFrontendRange": ">=2.0.0 <3.0.0"
}
```

Release Manager would then, at `TARGET_VALIDATE` time for a Mongo target:
`GET <backendApiUrl>/healthz` → assert reachable, assert `storageBackend`
matches the Site record, assert the release's declared requirement is satisfied
by `dataSchemaVersion`, and fail with a clear message otherwise.

The Universal manifest already carries `storageCompatibility: ["txt","mongo"]`;
a future build should also carry `requiresDataSchemaVersion`.

---

## 6. Creating a Mongo-backed target safely

Proposed stage sequence, reusing the existing TXT machinery:

| # | Stage | Owner | Notes |
|---|---|---|---|
| 1 | `RELEASE_VALIDATE` | Node | unchanged; also assert `storageCompatibility` includes `mongo` |
| 2 | `TARGET_VALIDATE` | Node | **new:** probe `backendApiUrl` health, check `dataSchemaVersion` |
| 3 | `BACKEND_SITE_REGISTER` | Node | **new:** `POST /api/sites/:siteId/provision` (idempotent) |
| 4 | `BACKEND_SEED_VERIFY` | Node | **new:** read back each legacy key, assert present |
| 5 | `STAGING_CREATE` | Node | unchanged |
| 6 | `RUNTIME_CONFIG_CREATE` | Node | emits `storageBackend:"mongo"`, `siteId`, `backendApiUrl` |
| 7 | `MANIFEST_CREATE` | Node | unchanged |
| 8–21 | SharePoint stages | Browser | libraries/folders reduced to what a Mongo site needs; **`CREATE_TXT_SEEDS` is skipped entirely** |

Stages 3 and 4 are Node-side because the Mongo backend is reached over plain
HTTP with an API key — no SharePoint session is involved. This does **not**
violate the Node/browser boundary, which exists specifically because Node has no
SharePoint cookie. It does mean the API key must be held server-side only.

---

## 7. Updating an existing Mongo-backed target

Strictly simpler than TXT, because there is no seed step:

1. Validate release and backend compatibility.
2. Create fresh staging, generate the Mongo runtime config overlay.
3. Deploy and verify the static frontend to SharePoint exactly as today.
4. Commit `index.html` last, verify, smoke.
5. **Never touch Mongo data.** The existing-site protection rule carries over
   unchanged: an update deploys a frontend, nothing else.

---

## 8. How TXT and Mongo targets coexist

`storageBackend` is already a first-class field on the Release Manager Site
record and on the generated runtime config, and `buildSiteIdentity()` already
normalizes it to `txt` or `mongo`. What a future workstream adds:

- Site form: a backend selector; `backendApiUrl` and `siteId` required and
  validated when `mongo` is chosen.
- Deployment plan: `CREATE_TXT_SEEDS` present for `txt`, replaced by
  `BACKEND_SITE_REGISTER` / `BACKEND_SEED_VERIFY` for `mongo`.
- Runs UI: the stage map is already data-driven from the shared pipeline, so it
  adapts automatically.

Two targets with different backends can coexist in one SharePoint Web; the
canonical target key already distinguishes them by library names.

---

## 9. How `storageBackend` affects runtime config

Enforced in three independent layers in Site Builder, all of which Release
Manager must satisfy:

1. **`runtimeConfig.js`** — `storageBackend` must be exactly `"txt"` or
   `"mongo"`; the aliases `backendStorage`/`storage` are rejected; a
   disagreement with `sitebuilder-deployment.json` throws
   `storage_backend_disagreement`.
2. **`storageBackend.js`** — for `mongo`: `siteId` required, ≤160 chars,
   `/^[a-zA-Z0-9._:\/-]+$/`; `backendApiUrl` must be absolute http(s), **no
   credentials, no query string, no fragment**, and must be https when the page
   is https.
3. **`deploymentArtifacts.mjs`** — the build refuses `mongo` without both
   `VITE_BACKEND_API_URL` and `VITE_SITE_ID`.

Release Manager's `writeTargetOverlay()` already emits `backendApiUrl` **only**
when the backend is `mongo`, and both files are generated from one identity, so
they cannot disagree. The remaining work is validating `backendApiUrl` against
rule 2 at Site-record creation time so the failure is reported in the form
rather than at runtime in the browser.

**Charset mismatch to resolve:** the frontend allows `.`, `:` and `/` in
`siteId`; the server's collection-name sanitizer folds `/` and `.` into `_` and
relies on the appended hash to avoid collisions. Release Manager should apply
the **stricter** rule (`^[a-zA-Z0-9._-]+$`, no `/` or `:`) to keep
`safeCollectionName` predictable and readable.

---

## 10. How the Mongo API URL is supplied

Stored on the Release Manager Site record as `backendApiUrl` and copied into the
runtime config at `RUNTIME_CONFIG_CREATE`. It must be:

- entered once per target, validated at entry;
- reachable from the **browser** (the frontend calls it directly) — so
  `127.0.0.1` only works when the backend runs on the same workstation;
- **never** accompanied by an API key in the runtime config. The runtime config
  is publicly readable from SharePoint. Site Builder's own docs state this
  explicitly, and its browser client only sends a key in dev builds.

---

## 11. Deploying the backend independently of the frontend

They are separate artifacts with separate lifecycles and should stay that way.

The backend already has a complete Windows/IIS story in
`scripts/server-colocation/`: an offline kit that bundles `node.exe` and the
Mongo tools, `Install-BuilderIis.ps1` (dry-run by default, `Apply` requires
`-Confirm SITEBUILDER_IIS_INSTALL`, binding restricted to loopback), plus
rollback and health-check scripts.

Recommendation: Release Manager should **not** deploy the backend in the first
Mongo workstream. It should record which backend version a target is pointed at
and verify compatibility. Backend deployment is an operator task with its own
confirmation gates, and folding it into a one-click frontend deploy would remove
those gates.

---

## 12. Backups before an upgrade

Site Builder already provides per-site backup over HTTP:
`POST /api/sites/:siteId/backups`, stored as a document in the site's own
collection (`_id: backup:<backupId>`, 8 MiB limit), with selective restore and
an automatic pre-restore safety backup.

Proposed rule for a Mongo deployment: **before any run that could change data,
take a backup and record its id in the run telemetry.** For a
frontend-only update that is arguably unnecessary, but it is cheap and it makes
rollback a single documented action.

For anything larger, the DB-level kit (`mongodump --archive --gzip` behind
`--confirm SITEBUILDER_SOURCE_EXPORT`) is the right tool, and is an operator
action, not a Release Manager action.

---

## 13. Rollback

Three independent levels, which must not be conflated:

| Level | Mechanism | Owner |
|---|---|---|
| Frontend | Re-deploy the previous Release. Already supported — releases are immutable and same-release redeployment works. | Release Manager |
| Data | Restore a backup via `POST /api/sites/:siteId/backups/:backupId/restore` | Operator, via Site Builder |
| Backend | IIS rollback script | Operator |

Release Manager should present the frontend rollback as a first-class action and
**link to** the other two rather than performing them.

---

## 14. Rehearsing data migrations

The existing tooling is already dry-run-first and should be kept that way:

- `migrateSharePointToMongo.js --dry-run` connects to Mongo only when NOT a dry
  run, and reports estimated document counts.
- `import-dry-run.mjs` verifies manifest kind, archive SHA-256, inventory hash,
  source ≠ target, and that the target database is empty.
- `migrateMongoIndexes.js` is dry-run by default; a mismatched existing index is
  a hard blocker rather than something it silently replaces.

A future workstream should add a **rehearsal target**: a Release Manager Site
record flagged `rehearsal: true` pointing at a scratch database, so the whole
create-and-deploy path can be exercised without touching production data.

---

## 15. User and widget data separation

Both live in the same per-site collection, separated by `scope`:
`admins` (from `users_data.txt`) and `widgets` (from `widgets_data.txt`).

Note the asymmetry with TXT: under TXT, `widgets_data.txt` moves between
`siteAssets` and `siteUsersDb` according to `widgetsDbTarget`. **Under Mongo
that setting is meaningless** — scope placement is fixed. Release Manager's UI
must hide or disable `widgetsDbTarget` for a Mongo target rather than storing a
value that silently does nothing.

---

## 16. Multi-site isolation

Defence in depth, all of it already implemented:

1. **Physical separation** — one collection per site, name derived only from the
   registry, never from caller input; `assertSafeCollectionName` rejects
   anything outside `^[a-z0-9_][a-z0-9_-]*$` and any `system.` prefix.
2. **Logical separation** — `siteId` is in every filter, not merely in the
   collection choice.
3. **Index-level** — unique on `sites.siteId` and on `sites.safeCollectionName`;
   their absence is a startup blocker in production.

**The gap is authorization, not isolation.** One `ADMIN_API_KEY` grants access to
every site. Anyone holding it can read and write any site's data. If Release
Manager holds that key to call a provisioning endpoint, Release Manager becomes
a full-access client to every Mongo-backed site. That must be an explicit,
documented decision, and argues for a narrowly scoped provisioning credential.

---

## 17. Avoiding duplicate site data

Risks and mitigations:

| Risk | Mitigation |
|---|---|
| Two Release Manager Sites → one `siteId` | Extend the canonical target key to include `siteId` for Mongo targets, and keep it unique |
| `ensureSite` auto-creating a site on first write | Always call the explicit provisioning endpoint first, and treat an unregistered site as an error |
| Re-seeding an existing site | Seeding must be idempotent and never overwrite; verify by reading back |
| Two slugs → one collection | Already prevented by the sha256 suffix |

---

## 18. Required indexes

Global (created by `npm run mongo:indexes`):

| Collection | Key | Unique |
|---|---|---|
| `sites` | `{ siteId: 1 }` | yes |
| `sites` | `{ siteSlug: 1 }` | no |
| `sites` | `{ safeCollectionName: 1 }` | yes |
| `site_data_revisions` | `{ siteId, documentKey, createdAt: -1 }` | no |
| `site_data_audit_logs` | `{ siteId, documentKey, createdAt: -1 }` | no |

Per site collection (created by `ensureSite`):

| Key | Unique |
|---|---|
| `{ siteId, scope, entityId, deletedAt }` | no |
| `{ siteId, scope, updatedAt: -1 }` | no |
| `{ hash }` | no |

Release Manager should **verify** these at `TARGET_VALIDATE` and refuse to
deploy if they are missing, rather than creating them itself.

---

## 19. Health and readiness checks

| Check | Endpoint | Auth | Purpose |
|---|---|---|---|
| Liveness | `GET /healthz` | none | process is up |
| Readiness | `GET /api/readyz` | API key | Mongo reachable and the three required collections exist |
| Site exists | `GET /api/sites/:siteId` | API key | target registered |
| Seeded | `GET /api/sites/:siteId/legacy-object?key=masterConfig` | API key | site has data |

Readiness is deliberately authenticated so it cannot become a public Mongo
topology probe. Release Manager must therefore call it **server-side**, which is
another reason the backend probe belongs in Node rather than the browser.

---

## 20. Security and permissions implications

1. **One shared admin key.** The largest issue. A per-site or per-purpose
   credential should be introduced before Release Manager holds it.
2. **The key must never reach the runtime config**, which is world-readable from
   SharePoint.
3. **No production browser auth exists.** The frontend sends
   `credentials: 'include'` and relies on a same-origin gateway. How a
   SharePoint-hosted page authenticates to the backend is an unsolved problem
   and must be settled before any real Mongo site is created.
4. **Key comparison is not constant-time** (plain `===`).
5. **CORS** must list the SharePoint origins, mirroring what Release Manager's
   own API already does.
6. **Loopback binding** is enforced by the IIS installer — which also means a
   backend reachable only at `127.0.0.1` cannot serve a browser on another
   machine.

---

## 21. Versioning strategy

Four independently versioned things:

| Component | Version source today | Needed |
|---|---|---|
| Release Manager | `package.json`, served by `/api/health` | fine |
| Site Builder frontend | Release version + Universal `buildId` | fine |
| Site Builder backend | **nothing served over HTTP** | **add to `/healthz`** |
| Mongo data schema | `schemaVersion: 1`, never read | **add to `/healthz`; make it meaningful** |

Proposed rule: the Universal manifest declares `requiresDataSchemaVersion`;
Release Manager refuses to deploy a Mongo target whose backend reports a lower
`dataSchemaVersion`, and warns when the backend is newer than the release.

---

## 22. Proposed implementation phases

**Phase 0 — prerequisites (Site Builder).** Add version/schema to `/healthz`;
add the idempotent provisioning + seeding endpoint; decide the authentication
story. *No Release Manager work.*

**Phase 1 — read-only awareness (Release Manager).** `storageBackend` on the
Site form; `backendApiUrl` validation; a backend health probe shown in Site
details. Deployment still refused for Mongo targets.

**Phase 2 — Mongo target updates.** Deploy a frontend to an already-provisioned
Mongo site: compatibility gate, Mongo runtime overlay, SharePoint stages minus
the TXT seeds.

**Phase 3 — Mongo target creation.** `BACKEND_SITE_REGISTER` +
`BACKEND_SEED_VERIFY`, one-click, idempotent.

**Phase 4 — rollback and backup integration.** Pre-deploy backup, backup id in
run telemetry, one-click frontend rollback.

**Phase 5 — rehearsal targets and migration assistance.**

---

## 23. Files likely to change

**Site Builder (prerequisite work):**
- `server/src/app.js` — version fields in the health payload
- `server/src/routes/siteRoutes.js` — provisioning/seeding endpoint
- new `server/src/services/siteProvisioning.js` — seed payloads, reusing the
  defaults currently hardcoded in `scripts/init-sharepoint-site.js`
- `server/src/auth/apiKey.js` — scoped credentials
- `scripts/deploymentArtifacts.mjs` — `requiresDataSchemaVersion` in the manifest

**Release Manager:**
- `shared/siteRuntime.js` — Mongo identity fields, stricter `siteId` charset
- `shared/universalManifest.js` — read `requiresDataSchemaVersion`
- `shared/deploymentStages.js` — `BACKEND_SITE_REGISTER`, `BACKEND_SEED_VERIFY`
- `shared/deploymentPipeline.js` — skip TXT seeds for Mongo targets
- new `server/src/services/backendCompatibility.js` — health probe + gate
- `server/src/services/deploymentService.js` — Mongo branch in preparation
- `server/src/routes/sites.js` — backend fields and validation
- `client/src/App.jsx` — backend selector and backend status

---

## 24. Windows acceptance matrix for the Mongo workstream (future)

| # | Scenario | Expected |
|---|---|---|
| M1 | Backend health probe from Release Manager | version + schema reported |
| M2 | Create a Mongo Site record with a bad `backendApiUrl` | rejected in the form |
| M3 | Deploy to an already-provisioned Mongo site | COMPLETE; no Mongo writes |
| M4 | Create a new Mongo site, one click | registered, seeded, verified, deployed |
| M5 | Re-run M4 | idempotent; nothing re-seeded, no duplicate data |
| M6 | Deploy a release requiring a newer schema | refused with a clear message |
| M7 | Backend unreachable | refused at `TARGET_VALIDATE`, actionable message |
| M8 | TXT target and Mongo target in one Web | both correct, no cross-contamination |
| M9 | Backup before upgrade, then restore | data restored, frontend untouched |
| M10 | Frontend rollback on a Mongo target | previous release live, data untouched |

---

## Appendix — legacy key → Mongo scope mapping

| Legacy key | TXT file | Scope | Entity | Mode |
|---|---|---|---|---|
| masterConfig | `bihs_master_config_v1.txt` | `config` | `master` | singleton |
| users | `users_data.txt` | `admins` | — | list |
| events | `events_data.txt` | `events` | — | list + settings |
| navigation | `nav_data.txt` | `navigation` | — | list |
| siteContent | `site_content_data.txt` | `content` | `site` | singleton |
| theme | `theme_data.txt` | `design` | `theme` | singleton |
| widgets | `widgets_data.txt` | `widgets` | `config` | singleton |
| externalLinks | `external_links_data.txt` | `externalLinks` | — | list |
| gantt | `gantt_data.txt` | `gantt` | `settings` | singleton |
| boom | `boom_data.txt` | `boom` | `settings` | singleton, optional when missing |

Concurrency is optimistic and **file-level**: a manifest document in scope
`legacyMeta` carries the version, and a write must present a matching
`expectedVersion` (or `If-Match`). A missing precondition returns **428**, a
mismatch **409**.
