# CONTINUATION — Unified Convergence (site-builder + site-release-manager)

Version: 3 (2026-09-23)
Integration branch (both repos): `codex/sitebuilder-unified-convergence-20260923`

## 1. Four recovered inputs (manifest RUN 20260923-162927-54393)

All four remote checkpoint SHAs were fetched and match `HANDOFF.txt` exactly.

| Repo | Stream | Ref | SHA |
|---|---|---|---|
| site-builder | convergence | `codex/handoff-convergence-20260923-162927-54393` | `b93bd7cd135bd2ac188411ef4375deacedc309ce` |
| site-builder | reliability | `codex/handoff-reliability-20260923-162927-54393` | `519b01873d61e9728cf382f5ae7deaf964d899f3` |
| site-release-manager | convergence | `codex/handoff-convergence-20260923-162927-54393` | `e80690a1e1f900a18f263f9a4c1b92f916408ec2` |
| site-release-manager | reliability | `codex/handoff-reliability-20260923-162927-54393` | `bf4908a00dc11d8a0672977e0af9637a260af724` |

Reference points:
- site-builder `origin/main` = `e2f7079a3a7503001034baabecb583aac55182d2` (equals the documented reference main SHA)
- site-release-manager `origin/main` = `a026df101348e0fc093838af7df421c3e2f7e40c` (equals the documented reference main SHA)
- In BOTH repos, the merge-base of BOTH checkpoints IS current `origin/main`. There is **no newer main drift** to reconcile.
- Local `/Users/meni/dev/site-builder` main (`0090124`) is 1 commit BEHIND `origin/main`. Not used as an integration base.

### Working-tree reconciliation
- `/Users/meni/dev/site-release-manager` has 8 dirty files. Verified byte-identical to the RM reliability checkpoint (`git diff <ckpt> -- <files>` empty). **No uncommitted RM work is lost.**
- `/Users/meni/dev/site-builder.worktrees/daily-data-integration-f48bbdd7` dirty set matches the SB convergence checkpoint, **plus `.env.production`** which was intentionally excluded as a real dotenv file. Non-secret template counterparts (`.env.example`, `.env.local.example`) ARE carried in the checkpoint. **OPEN:** confirm no non-secret key introduced only in `.env.production` is missing from the templates.
- `/Users/meni/dev/site-builder.worktrees/attachment-pasted-text-1` dirty set matches the SB reliability checkpoint.

## 2. Integration

Isolated worktrees, branch `codex/sitebuilder-unified-convergence-20260923`:
- SB: `/Users/meni/dev/site-builder.worktrees/unified-convergence-20260923` → integration SHA `815b4d981c173ddfb829e3f9499d9baef635b52c`
- RM: `/Users/meni/dev/site-release-manager.worktrees/unified-convergence-20260923` → integration SHA `30a6cbb9b6e14e6c5635d4c758b948d8a88704b6`

Method: checked out the **convergence** checkpoint as base, merged the **reliability** checkpoint via `git merge --no-ff` (true three-way). No repo-wide `ours`/`theirs`, no working-tree overwrite. Input refs preserved untouched.

### Reconciliation ledger — file-level
**Zero overlapping files in both repos.** The two streams touched strictly disjoint file sets:

- SB convergence (19 files): `.env*.example`, `README.md`, `docs/PERSISTENCE_ARCHITECTURE.md`, `scripts/build-*`, `scripts/deploy-legacy.mjs`, `scripts/deploymentArtifacts*`, `scripts/legacyPipeline.test.mjs`, `scripts/sharepoint-closed-export/installRuntimeConfigCore*`, `scripts/sp-env*`, `src/services/storage/{runtimeConfig,storageBackend,backendApiClient,LegacyObjectStorageAdapter.test}`
- SB reliability (37 files): `src/components/Admin*`, `BoomAssigneePicker`, `NotificationAudienceTargets`, `SmartTextEditor`, `src/context/*`, `src/services/{ConfigAdapter,ConfigService,NavigationSharePointService,sharePointIdentityResolver}`, `src/utils/{adminEditSession,backupPackage,sharepointUtils,userFacingError}`
- RM convergence (21 files): `server/src/{config,index,routes/sites}`, packaging scripts, `web.config`, `index.cjs`, docs, `server/test/*`
- RM reliability (8 files): `client/src/{App,RunsPage,main}.jsx`, `shared/{sharepointProvisioning,userFacingErrors}.js` (+ `server/src/shared/` mirrors), `server/test/sharepointProvisioning.test.js`

Merge result: **clean, zero conflicts, both repos.**

### Semantic overlap — status
Disjoint files do NOT prove behavioral compatibility. The producer/consumer seam (SB `src/services/storage/*` descriptors ↔ SB `src/context/ConfigProvider.jsx` + `ConfigAdapter` ↔ RM `server/src/routes/sites.js` + staging/bootstrap) was validated empirically by the cross-repo suite below rather than by inspection alone. **Targeted semantic review of the ConfigProvider↔storageBackend seam is still OPEN.**

## 3. Verified results (this session)

Platform: darwin 26.6.2, node v26.7.0.

### Release Manager — `server/` (`node --test`)
Baseline, no fixtures: **205 tests / 176 pass / 0 fail / 29 SKIPPED**.
The 29 skips were silent cross-repo and DB gaps (23 × `SRM_TEST_MONGO_URI`, 6 × `site-builder/dist-universal` absent).

Resolved both:
- disposable Mongo: `mongod --dbpath <scratch> --port 27977` → `SRM_TEST_MONGO_URI=mongodb://127.0.0.1:27977/srm_test_b2`
- real sibling artifact: `SITE_BUILDER_PATH=/Users/meni/dev/site-builder.worktrees/unified-convergence-20260923`
- built the SharePoint deployer (`sharepoint-deployer && npm run build`) — its absence was the one real failure surfaced.

**Final: 205 tests / 205 pass / 0 fail / 0 skipped.**

### Site Builder — `vitest run`
`npx vitest run --maxWorkers=4` → 1314 tests / 1311 pass / **3 fail**.
All 3 failures are 5000ms timeouts under worker contention, NOT defects:
`adminAiCapabilities.test.js`, `FileExplorerPage.test.jsx`, `AdminBackupManagement.test.jsx`.
Re-run in isolation at `--maxWorkers=2`: **all pass** (26/26 and 36/36 respectively).
NOTE: vitest 4.1.1 rejects `--poolOptions.*`; the supported bounding flag is `--maxWorkers`.
**OPEN:** full-suite confirmation run at `--maxWorkers=2`.

### Universal artifact (Gate 9 build requirement)
`npm run build:universal` → 73 files, buildId `b571bdac-2b50-4d46-b928-ae57211e2853`.
`npm run verify:universal-dist` → PASS: 31 JS/CSS assets byte-identical across two distinct target identities; no Legacy target identity found (4 markers checked).
Universal JS/CSS hash: `43c30135e31c7b1b5a5fc5fbce8c134ce88f2a66942d87ac85fce3b3c3348110`
SB `package-lock.json` sha256: `93ed62f265822796f6a7b54c357d603d4b0f9546a4367feff8119e350e95e897`
Grep scan: no baked `dailyDataApiUrl`/`backendApiUrl` literal, no `X-API-Key` literal, no baked `siteId`.

## 4. Gate status

Evidence above covers, empirically: Gate 9 Universal-build + producer/consumer contract (via `siteBuilderContract.test.js`, `staging.test.js` now unskipped), and Gate 11 job lifecycle/lease/cancel/retry/resume/same-release-redeploy (via `jobLifecycle.test.js` now unskipped, Mongo-backed).

**Not yet independently verified in this session — inherited claims only:**
Gates 1–8, 10, 12, and the inactivity-reload modal UX. The inherited checkpoints contain implementation and unit tests for much of Gates 1–6 and 8 (see the SB reliability file list), but per the mission, historical passing counts are not final evidence and **no browser-level acceptance has been run**.

## 5. Known OPEN items (next executable steps)
1. Full SB suite at `--maxWorkers=2` for a clean, uncontended pass count.
2. Recover or reproduce the convergence review's blocking findings (text not present in handoff).
3. Verify the interrupted convergence follow-up: `{dailyDataApiUrl}/readyz` JSON `ok===true`; legacy readiness path/auth; dev `X-API-Key` scoping.
4. Resume SmartTextEditor browser verification (reliability agent's stop point).
5. Browser acceptance for BOOM reopen, dirty Alerts + keyboard recovery, conflict resolution, SmartText save/reopen, backup selection races, selective restore.
6. Inactivity-reload modal UX (60-minute copy, light backdrop, blocking, focus management).
7. `.env.production` non-secret key reconciliation into templates.
8. RM server-only package (Gate 12) build + verify.

## 6. Constraints honored
No force push, no direct main push, no main merge, no account/global-config change, no production deployment, no live restore, no destructive folder repair, no real-data migration. Mongo used was a disposable instance on port 27977 under the session scratchpad.


---

# Session 2 — blocker fixes

Continued from PR heads SB `389e487a74c215b520a45748322523f64568eca8`
and RM `372ddc3ca3e5f2477953b26402a79c9514d1c813` (both verified clean before editing).
No reset, no main merge, no force push.

## Blocker 2 — /readyz required identity  (FIXED)

Root cause: in `server/src/daily-data/v1/router.js` the global `router.use()`
calling `trustedIdentityForRequest(req)` was registered BEFORE `/healthz` and
`/readyz`. `trustedIdentityForRequest` throws 401 whenever no header is present
— in production without the trusted header, in development without the dev
header — so both probes answered 401. Site Builder's canonical deploy readiness
(`scripts/deploy-legacy.mjs:32`) calls `{dailyDataApiUrl}/readyz` UNAUTHENTICATED
and requires JSON `ok === true`. The two sides directly contradicted each other.

Fix: health and readiness are now registered ahead of the identity middleware.
Express matches in registration order, so they answer without reaching it. Every
route below is `/sites/:siteId/...` with an explicit `requireRole`, so nothing
was unprotected.

Hardening: `requireRole` now fails closed when `req.dailyDataPrincipal` is
absent. Previously a missing principal fell through `hasRole()` to
`sharePointAccessResolver`, which reads a REQUEST header — so an absent identity
could have become browser-supplied authorization.

## Blocker 1 — native Windows credential popup  (root cause corrected)

The Node application is NOT the source of the dialog. Verified: `WWW-Authenticate`
appears nowhere in `server/src/` or `client/src/`, and an anonymous
`POST /api/sites` already fails closed with application JSON and no challenge
header (test: 'Mongo site creation refuses anonymously with JSON and no auth
challenge'). The popup originates in IIS, which challenges before Node sees the
request, escalated by the client's `credentials: 'include'`.

What WAS locally fixable, and is now fixed, is the trusted-header contract:

- `web.config` stamped `HTTP_X_IISNODE_AUTH_USER` only inside the SPA-fallback
  rule, which is guarded by `{REQUEST_FILENAME}` IsFile negate. A request that
  resolves to a real file — `index.cjs` is itself the iisnode handler — skipped
  the rule, so a browser-supplied `X-IISNode-Auth-User` reached Node untouched.
  Stamping moved to an unconditional first rule with `stopProcessing="false"`.

- `x-iisnode-sharepoint-sites`, the per-site access list for ORDINARY users, was
  read by `createSharePointAccessResolver` but written by nothing in IIS. It was
  entirely caller-supplied: any user could self-assign baseline access to any
  site whose `dataAccess` allowed SharePoint access. It is now blanked on every
  request, and production refuses `TRUSTED_SITE_ACCESS_ENABLED=true` unless
  `TRUSTED_SITE_ACCESS_SOURCE` names a real server-side adapter
  (`mongo-membership`; no value may mean "read it off the request").

- `.env.iis.example` shipped `TRUSTED_SITE_ACCESS_ENABLED=true`, which would now
  refuse to start. Set to `false` with the exact enable steps, plus a test
  keeping template and guard from drifting.

REMAINING and genuinely external: proving that Windows Integrated Auth completes
SILENTLY (no dialog) requires a real IIS host, domain membership and an SPN.
That cannot be reproduced here, and no simulated acceptance is claimed.

## Ordinary-user Mongo authorization

Current model after this session: access comes from each site's explicit
`dataAccess` lists only (`accessForCreator` seeds the creator as
viewer/submitter/editor/administrator, so no site is ownerless). The
header-derived baseline path is disabled and fails closed. Building the real
`mongo-membership` adapter is NOT done and is listed as open.

## Inactivity reload modal  (DONE)

`AdminEditSessionGuard.jsx` read as a critical failure: `bg-black/65` +
`backdrop-blur-md` hid the app, amber `AlertTriangle` framed an idle timeout as
an error. Now: Hebrew copy per spec; `bg-slate-900/25` + `backdrop-blur-[2px]`;
neutral primary icon; `role="dialog"`; red reserved for an actual reload failure.
Still blocking — backdrop mousedown swallowed, Escape suppressed, Tab contained,
Refresh focused on appearance. The `"60 דקות"` wording is DERIVED from
`ADMIN_STALE_THRESHOLD_MS` via `staleInactivityTitle()`, so it is only used when
the threshold that actually fired is 60 minutes. The safe-reload contract
(`prepareAdminSafeReload`, local-only approval, dirty capture, write draining,
unload protection) is untouched.

Visual evidence: a markup-faithful preview rendered in a real browser confirms
the application behind stays recognisable. This is a preview of the component
markup, NOT the running application.

## Inherited Site Builder convergence follow-up — VERIFIED, not rewritten

1. `dailyDataApiUrl` canonical transport — `requireMongoApiTransport()`
2. canonical URL must end `/api/daily-data/v1` — `storageBackend.js:229`
3. central root `/sites` → `{dailyDataApiUrl}/sites/{siteId}/...`
4. legacy root `/api/sites` → `{backendApiUrl}/api/sites/{siteId}/...`
5. no duplicated `/api` — canonical uses `/sites` because the base already ends
   in `/api/daily-data/v1` (`storageBackend.js:273-284`)
6. readiness — `deploy-legacy.mjs:32` unauthenticated, rejects non-JSON, requires
   `ok === true`; legacy retains `{backendApiUrl}/api/sites/{siteId}`
7. dev `X-API-Key` — `backendApiClient.js:14` requires BOTH
   `transport.kind === 'legacy-backend'` AND `import.meta.env.DEV === true`
8. Universal carries no baked identity — re-verified on the fresh build

## Verified results — FINAL source

Platform darwin 26.6.2, node v26.7.0.

Site Builder `npx vitest run --maxWorkers=2`:
**146 files, 1321 tests, 1321 pass, 0 fail, 0 skip** (37.13s).
This settles the earlier 3 "failures": they were worker-contention timeouts at
`--maxWorkers=4`, not defects. `--poolOptions.*` is rejected by vitest 4.1.1.

Site Builder lint: changed-file lint CLEAN. Full `eslint .` reports 166 problems
across 50 files; machine-checked intersection with the 3 files changed this
session is EMPTY, so all are baseline.

Release Manager `npm test` with disposable Mongo (port 27977) and explicit
`SITE_BUILDER_PATH`: **224 tests, 224 pass, 0 fail, 0 skipped** (was 205/176 with
29 silent skips at integration).

Fresh Universal build from final source: buildId
`54a64fdb-fbc1-4f14-96f7-4dec3eb93a11`, 73 files.
`verify:universal-dist` PASS — 31 JS/CSS assets byte-identical across two target
identities, no Legacy target identity (4 markers).
Universal JS/CSS hash `a303f2b07ff4fab65e5bd38272bd30883835122f378de5773ecdb63b5af05a5c`.
package-lock sha256 `93ed62f265822796f6a7b54c357d603d4b0f9546a4367feff8119e350e95e897`.
The previous build id/hash (`b571bdac…` / `43c30135…`) is superseded and NOT reused.
Grep scan of the fresh artifact: no baked dailyDataApiUrl/backendApiUrl/X-API-Key/siteId.

`.env.production` reconciliation: CLOSED. All 39 key NAMES in the real dotenv are
represented across `.env.example` + `.env.local.example` (63 keys). No values read.

## Still open (honest)

- Browser acceptance for BOOM reopen/cancel, dirty Alerts + keyboard recovery,
  conflict resolution with reviewed ETag, SmartTextEditor Enter/IME/caret and
  save-reopen, backup hydration races, selective restore. NOT run.
- Gate 12 server-only package: not built or verified from final source.
- Gate 7 historical SharePoint folder diagnostics: not exercised.
- The `mongo-membership` per-site access adapter: not implemented.
- Convergence review's blocking findings: text still not recovered.
- Silent Windows SSO: requires real IIS/domain/SPN. External.


---

# Session 3 — blockers closed, browser acceptance, final artifacts

Starting heads: SB `34e8594c6ec1b8ace29833a0a93037f296244160`,
RM `8059e209517a415ea8a0db0417b7f2339d032fd4` (both verified clean before editing).
No reset, no main merge, no force push.

## Blocker A — native Windows credential popup: CLOSED on the application side

Root cause, corrected from session 2's partial finding. The Node app never emits
`WWW-Authenticate`; IIS challenges before Express sees the request. But the
application made that challenge reachable from ORDINARY traffic: `POST /api/sites`
authorized straight off the IIS-injected identity header while the client opted in
with `credentials: 'include'`. A failed silent SSO therefore escalated into a
native username/password dialog on a routine create click.

New architecture:
- `POST /api/auth/session` is the ONLY credentialed call and the ONLY consumer of
  the Windows identity. It returns an HMAC-signed, short-lived bearer token
  (`server/src/managementSession.js`, `server/src/routes/auth.js`).
- Consequential management operations (create Mongo site, change data access)
  authorize from that token and are explicitly NON-credentialed, so routine
  traffic can never be drawn into an authentication handshake.
- `GET /api/auth/whoami` is a non-credentialed probe, so the UI can render state
  without provoking authentication.
- Neither route emits `WWW-Authenticate`; refusals are application JSON with
  Hebrew messages.
- Authorization runs BEFORE validation and before any database read, so the
  create endpoint cannot be used as an unauthenticated probe.
- The verified session principal becomes the site's initial administrator, so no
  Mongo site can be ownerless.
- `MANAGEMENT_SESSION_SECRET` is required in production (32+ chars); development
  derives a per-process random secret so tokens are never forgeable.

Also fixed in `web.config`: the rule stamping `X-IISNode-Auth-User` was guarded by
`{REQUEST_FILENAME}` IsFile-negate, so a request resolving to a real file
(`index.cjs` IS the iisnode handler) skipped the stamp and carried the caller's own
header into Node. Stamping moved to an unconditional first rule.

REMAINING and genuinely external: proving Windows Integrated Auth completes
SILENTLY needs a real IIS host, domain membership and an SPN. See
`docs/WINDOWS_IIS_ACCEPTANCE.md` §4 and §8. No simulated acceptance is claimed.

## Blocker B — ordinary Mongo user authorization: CLOSED

There is no trustworthy server-side membership source: the RM server has no AD,
LDAP, Graph or SharePoint client (production deps are adm-zip, cors, dotenv,
express, mongodb, multer, zod) and URL Rewrite cannot derive per-site membership.
Per instruction, the placeholder path was REMOVED rather than shipped disabled:
`createSharePointAccessResolver` and the `x-iisnode-sharepoint-sites` branch of
`hasRole`, plus the `TRUSTED_SITE_ACCESS_*` config and the `mongo-membership`
setting, are gone. Any caller could previously have self-granted access to any
site whose `dataAccess` allowed SharePoint access.

Supported model: each site's explicit `dataAccess` lists. Administrators inherit
the lesser roles; nothing inherits upward; an absent principal never matches.
Legacy `sharePointReadAccess`/`sharePointInteractionAccess` fields are still
persisted for document compatibility but grant nothing.

`updateSiteDataAccess` was wired to no UI, so the model was correct but unusable.
A data-access panel was added to the Mongo site workspace
(`client/src/SitePage.jsx`): one list per role, saving blocked while the
administrator list is empty, management refusals rendered in Hebrew.

## SmartTextEditor — real defect found and fixed

The interrupted gate. The contenteditable's React key was derived from its own
content (`editorKey = JSON.stringify(tokens)`), so React unmounted and remounted
the editor on EVERY token change. With the 80ms debounce and caret restore,
keystrokes inside that window were dropped or reordered.

Reproduced in Chromium at 80ms/keystroke (~30wpm, ordinary typing):
`שורה ראשונה` + Enter + `שורה שנייה` persisted as `שר ראשנה\nשה שנייר` — characters
lost AND transposed. `abcdefghij` came out `abcefgij`.

Fix: the rendered key advances only for tokens that did not originate in this
editor's DOM, and children are memoised on that key so React bails out of
reconciliation while the user types. (Removing the key alone was NOT enough — it
produced `abcdefghijabcdefghijabcdefghi...` because React diffed fresh elements
against DOM the user had mutated.) Enter still forces a rebuild, because it can
leave the caret on a trailing blank line that only exists once the editor-only
caret filler is rendered.

## Readiness robustness

`/readyz` forwarded a database error to the error handler, so an unreachable Mongo
produced a 500 instead of a readiness answer. It now always returns parseable JSON;
unreadiness is `ok:false` with a short non-sensitive reason, asserted to carry no
stack and no connection URI.

## Gate 8 — one real leak fixed

`RunsPage.jsx` rendered `run.failureInfo.details.responsePreview` verbatim in a
`<pre>` while every sibling diagnostic was already sanitised. That preview is the
raw server response and can carry HTML, escaped JSON, auth headers, cookies or
token-bearing URLs. Now passed through `sanitizeReleaseDiagnostic`.

Site Builder side audited: `toSafeHebrewError` never returns `error.message` — it
maps to canned Hebrew or the caller's fallback — and is used in 37 places. No raw
`{error.message}` rendering found in SB admin components.

## Gate 9 — cross-repository semantic review: CLOSED

`ConfigAdapter.load()/_saveSelected()` branch on `isMongoStorageBackend()` at the
top and RETHROW on error; there is no catch-and-fallback, so no Mongo→TXT
degradation. `isStrictPersistentBackend()` is unconditionally strict.
`ConfigProvider`'s TXT bootstrap is guarded by `!isMongoStorageBackend()`.

Paired contract tests (run with explicit `SITE_BUILDER_PATH`) cover: the Mongo
overlay selecting the real SB central transport without legacy path rewriting (no
duplicated `/api`); RM runtime config accepted by the real SB descriptor; TXT seed
paths matching the SB descriptor exactly; SB reading the runtime globals the
bootstrap defines; bootstrap injected ahead of the real module bundle; and the
bootstrap parsing back to exactly the runtime config.

## Gate 10 — server-only package: VERIFIED from final source

Built and verified, then independently checked rather than trusting the verifier:
flat topology (`index.cjs`, `web.config`, `package.json`, `package-lock.json`,
`.env.example`, `src/`, `node_modules/`, `deployment-manifest.json`); no client or
deployer UI, no `.git`, no `storage`, no tests, no real `.env`; no file named
`node.exe`; no local `<iisnode>` section; upload ceiling 629145600.

Proven live by booting the package from `/`:
- working-directory independent — `/api/health` 200;
- an unrelated parent `package.json` (version 9.9.9) placed above it did NOT
  hijack root resolution — the app still reported its own 0.3.7;
- named-pipe PORT stays a string (`\\.\pipe\...`), numeric ports parse, blanks
  fall back — no NaN;
- `/readyz` anonymous JSON; site data 401; create 401 JSON with NO
  `WWW-Authenticate`;
- full authorized flow: session → create → `srm-` siteId → creator as
  administrator → 10 defaults provisioned → `/readyz` flips to `ok:true`;
- spoofed `x-iisnode-auth-user` on create → 401.

Manifest is honest: `windowsRuntimeIncluded: false`,
`windowsDependencyCompatibilityValidated: false`.

## Final verified results

Platform darwin 26.6.2, node v26.7.0.

Site Builder `npx vitest run --maxWorkers=2`:
**146 files, 1321 tests, 1321 pass, 0 fail, 0 skip.**
(`e2e/` is excluded from vitest; Playwright owns it.)

Site Builder `npm run test:e2e` (real Chromium, headless, 1 worker):
**18/18 pass** — BOOM picker reopen after exact-identity resolution, cancel while
pending then reopen, late response for an abandoned query, failed lookup stays
retryable, name-search pick; inactivity modal copy/focus/Escape/backdrop/
translucency/exactly-one-reload; SmartText one-Enter, intentional blank line,
Shift+Enter, caret at start/middle/end, save+reopen with no persisted caret
placeholder; typing fidelity at 30wpm and at 20ms.

Site Builder lint: changed-file lint CLEAN. Full `eslint .` → 155 errors,
11 warnings across 50 files; machine-checked intersection with the 11 files changed
this session is EMPTY, so all are baseline.

Release Manager `npm test` (disposable Mongo on 27977, explicit
`SITE_BUILDER_PATH`): **242 tests, 242 pass, 0 fail, 0 skipped.**
Release Manager client: **22/22 pass**; production build OK.
`npm run verify:system`: **PASSED**. `npm run verify:transfer`: READY.
`npm run verify:iis-server-only`: VERIFIED.

## Final artifacts (all generated, all gitignored — none are committed)

- SB Universal: buildId `c8b29c04-f175-4357-87ce-2c40ba0aba12`, 73 files,
  JS/CSS hash `cfcd99edf8355b00411d3808ba204179cc82583ad1339031e5bdbd91390064aa`,
  31 assets byte-identical across two target identities, no baked identity or
  secrets. Supersedes `54a64fdb…`, which is NOT reused.
- SB `package-lock.json` sha256 `a692c588b25ea1b89732aac44c7dee78d8de2b67bbd95ee2d0dddddad82abd9d`
- RM `server/package-lock.json` sha256 `651730b058e47a74bc498a09c24494d6fff00468245c1cad54f054d216f10f8b`
- RM client dist, SharePoint deployer dist, and the server-only package: see
  `artifact-manifest.json` generated alongside them.

Transfer, preservation and rollback: `docs/TRANSFER_AND_ROLLBACK.md` (RM repo).
Windows acceptance: `docs/WINDOWS_IIS_ACCEPTANCE.md` (RM repo).

## Genuinely external — nothing else blocks

1. Silent Windows SSO (no native dialog) on a real IIS host with domain membership
   and an SPN. `docs/WINDOWS_IIS_ACCEPTANCE.md` §4 distinguishes silent success,
   a dialog (FAIL) and a JSON refusal (expected unauthorized behavior).
2. Windows-native dependency compatibility for the server-only package; the
   manifest states this was not validated on macOS.
3. Live SharePoint farm behaviour: historical folder diagnostics and real
   deployment against live libraries. Not exercised; no destructive repair
   attempted.
