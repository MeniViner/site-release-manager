# CONTINUATION — Unified Convergence (site-builder + site-release-manager)

Version: 6 (2026-09-24)
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


---

# Session 4 — review findings closed

Starting heads: SB `07a3761`, RM `8eb8227` (both verified clean before editing).

## Finding 1 — the IIS/session contract (CLOSED)

Moving the challenge to `/api/auth/session` was not sufficient, and the review was
right. The deeper problem: `sites.patch/delete/deploy` and
`releases.upload/upload-folder/patch/delete` had NO application guard at all —
they were protected purely by blanket IIS Windows auth. So making the API
anonymous would have exposed them, and leaving it Windows-only kept challenging
Bearer requests.

Both halves are closed. Every consequential mutation now requires a signed
management session (the client carries it, so TXT workflows keep working with
their boundary intact); the deploy worker keeps its separate `X-SRM-Lease`
boundary. `web.config` ships an executable route-specific topology:

| Path | Anonymous | Windows | Enforced by |
|---|---|---|---|
| default | on | off | the application (Bearer) |
| `/api/health`, `/api/config` | on | off | public |
| `/api/daily-data/v1/{healthz,readyz}` | on | off | public by design |
| `/api/auth/session` | off | **on** | IIS — the only challenge point |
| `/api/daily-data/v1/sites/*` | off | **on** | IIS + per-site roles |
| `OPTIONS` for the above | on | off | rewrite → anonymous handler |

The session exchange sends only `Accept`, so it is a CORS-simple request needing
no preflight — which is what makes challenging that one path safe. Daily Data's
preflight is diverted by an inbound rewrite (which runs BEFORE authentication) to
`/api/cors-preflight/daily-data`, answered with the app's own CORS policy.

Spoofing is tested AT THE ISSUER, not only on a mutation that never reads
identity headers: a browser-supplied trusted header cannot mint a session, and an
issued token names the identity the issuer saw, not one the caller asked for.
`IIS-DEPLOY-README.txt` documents the `allowedServerVariables` prerequisite —
URL Rewrite silently refuses to set a variable that is not allow-listed, which
would leave the trusted header empty and refuse every session with no obvious cause.

## Finding 2 — idempotency (CLOSED)

The permissive test that accepted a second 201 is gone. A create/install intent
carries an `Idempotency-Key` bound to the authenticated operator and to a
fingerprint of the request. Retries resume the SAME site, provisioning and job;
provisioning is re-driven because it only creates missing defaults. Response loss
after insertion, after provisioning and after job creation all converge, as do
concurrent retries — a unique index picks one winner and the losers resume it. A
reused key with materially different input is rejected; a deliberately different
site uses a new key. Deduplication is never by display name or Web code.

The client reuses the SAME key across its session-refresh retry — asserted
directly, because otherwise the server would allocate a second site.

## Finding 3 — documentation (CLOSED)

`WINDOWS_ACCEPTANCE_CHECKLIST.md` is the single canonical entry point and links
the topology doc. Runtime file corrected to `sitebuilder-runtime-config.json`; a
direct library GET is no longer accepted as evidence (this farm can answer HTML)
and is replaced by an authenticated REST read with a content-type assertion; each
of the four artifacts has an exact destination and `client/dist` is explicitly NOT
placed in the server application; hosts are consistent (`sitebuilderhub.idf`);
`MANAGEMENT_SESSION_SECRET` is generated with `RandomNumberGenerator`, not
`Get-Random`; offline dependency routes replace an online `npm ci`; rollback covers
the matching API, UI, deployer and runtime contracts without restoring over live data.

## Also closed

- Validated explicit SharePoint hosting choice for Mongo targets (was always
  auto-allocated), with an opt-in UI — sending the form's default folder names
  unconditionally would have collided on the second Mongo site in a Web.
- The shared folder fixture gained propagation-delay and name-collision cases;
  the classifier already produced those reasons but nothing exercised them.

## Product defects found BY the browser tests, and fixed

1. **Unknown file count reported as 0.** `listSharePointBackups` swallowed a
   failed per-folder listing and left `files: []`, so a 500 was indistinguishable
   from an empty backup and the UI stated "0 קבצים" as fact — inviting an operator
   to delete a backup that is actually intact. Counts are now null when unknown,
   rendered as "לא ידוע", and the aggregate no longer folds unknowns in as zero.
2. **Restore preview blanked the whole admin console.** `BackupSiteLivePreview`
   mounts a second Navigation/ExternalLinks provider; both registered the same
   fixed recovery participant ids, the duplicate registration threw from an effect
   with no error boundary, and React unmounted everything. A read-only preview now
   registers no recovery participant. This alone unblocked five tests.
3. **A recovered alert draft was silently dropped after a safe reload.**
   AdminAlerts read its envelope in a mount-only effect while the recovery scope
   lands asynchronously afterwards. It now re-reads on the recovery state event,
   ONE-SHOT and gated on the scope, because listening indefinitely would consume
   the envelope this page writes while preparing its own reload.
4. **Raw English store text shown to a Hebrew operator.** AdminAlerts passed
   `saveError.message` straight to the toast; it now routes through
   `toSafeHebrewError` like every other admin screen.

## Final verified results

Platform darwin 26.6.2, node v26.7.0.

- SB `npx vitest run --maxWorkers=2` → **146 files, 1325 tests, 1325 pass, 0 fail, 0 skip**
- SB `npx playwright test` (real Chromium) → **44 passed, 0 failed, 5 marked
  test.fixme**
- SB lint vs the ACTUAL base revision (`origin/main`, 154 errors / 11 warnings /
  49 files): **delta 0 / 0 / 0**
- RM `npm test` (disposable Mongo, explicit `SITE_BUILDER_PATH`) → **267/267, 0 skipped**
- RM client → **33/33**; `verify:system` PASSED; `verify:iis-server-only` VERIFIED
- RM has NO eslint configuration anywhere; `verify:system` (syntax-checks every
  file) is its actual equivalent gate. No linter was fabricated for it.

### Final artifacts (generated, gitignored, NOT committed)

| Artifact | Location | Evidence |
|---|---|---|
| SB Universal | `site-builder…/dist-universal` | buildId `315f47d8-f962-4b2a-8b4d-377968453529`, 73 files, JS/CSS hash `669ac0891e2d58b83d765552b80784b39ddeb935d684aaddbee4ccbd36486994`, 31 assets byte-identical across two target identities |
| RM client | `…/client/dist` | tree hash `e762afb06e8fd0a3…` |
| SharePoint deployer | `…/sharepoint-deployer/client/dist` | tree hash `6cdbb40b492e0302…` |
| Server-only package | `…worktrees/srm-server-only-b8ca6e6` | sourceCommit `b8ca6e6…` = RM HEAD, tree hash `f6045f2c57d958fe…` |
| Paired manifest | `…worktrees/artifact-manifest.json` | both SHAs, lock hashes, platform |

SB `package-lock.json` sha256 `a692c588b25ea1b89732aac44c7dee78d8de2b67bbd95ee2d0dddddad82abd9d`.
RM `server/package-lock.json` sha256 `651730b058e47a74bc498a09c24494d6fff00468245c1cad54f054d216f10f8b`.

## Known-unfinished, explicitly marked (NOT external acceptance)

Five browser scenarios are `test.fixme` with the reason recorded at the call
site: two backup payload-state cases and three selective-restore orchestration
cases. The flow reaches the restore confirmation, but the fixture does not yet
drive the orchestration far enough for the assertions to mean anything. They are
outstanding LOCAL work. The equivalent behaviour is covered at unit level in
`src/components/AdminBackupManagement.test.jsx`.

Note for whoever picks this up: editing `src/utils/adminEditSession.js` while the
Playwright dev server is reused causes Vite HMR to hand the test harness a
DIFFERENT module instance than the app, and every recovery spec then fails with
"the admin recovery scope was never installed". Restart the dev server after
touching that file.

## Genuinely external — unchanged

1. Silent Windows SSO with no dialog: needs a domain-joined IIS host, correct
   zone/policy and an SPN. `docs/WINDOWS_IIS_ACCEPTANCE.md` §3.3 distinguishes
   silent success, a dialog (FAIL) and a JSON refusal (expected unauthorized).
2. Windows-native dependency compatibility for the server-only package; the
   manifest states it was not validated on macOS.
3. Live SharePoint farm behaviour: historical folder repair and deployment
   against real libraries.


---

# Session 5 — bounded closure pass

Starting heads: SB `eff1a22`, RM `48b972b` (both verified clean).

## 1. Cross-origin management contract (CLOSED)

The client and the server policy had drifted apart. `client/src/api.js` sends
`Idempotency-Key` on Mongo creation, which `MANAGEMENT_SESSION_REQUEST_HEADERS`
did not allow; site edit/delete/deploy and release upload/update/delete had been
moved onto Bearer, but `usesManagementSession()` still recognised only create,
data-access and whoami, so those fell through to a general policy that did not
advertise `Authorization` either. Every one of them would have been refused by
the BROWSER before reaching the server.

The ten operations are now one declarative list mirroring the
`requireManagementPrincipal` guards, with the real methods and headers.
`Authorization` was also added to the general allow-list so a future guarded
route that is not registered fails with a clear 401 instead of an opaque CORS
error; allow-listing a request header grants no authorization. Deploy-worker
`X-SRM-Lease` and the credentialed Daily Data boundary are untouched.

`server/test/corsContract.test.js` asserts the preflight for all ten operations
against the real Express app, plus the worker lease, Daily Data with `If-Match`,
an unconfigured origin, and that a preflight never authorizes the request behind it.

### Real cross-origin proof (not a proxy, not Node fetch)

The REAL built Release Manager client was served from `http://127.0.0.1:4399`
against the API on `http://127.0.0.1:4300` and driven in Chromium:

- the client booted and rendered live data (`GET /api/health`, `/api/dashboard`
  cross-origin, 200);
- unauthorized `POST /api/sites` → **401 with a READABLE JSON body**
  (`management_session_required`). Readable is the proof: a CORS failure surfaces
  as an unreadable TypeError, not a response;
- authorized `POST` with `Authorization` + `Idempotency-Key` → `OPTIONS 204`
  preflight, then **201**, stable `srm-…` siteId, creator as administrator;
- retry with the SAME key → **200 `idempotent: true`, same builderSiteId**.

## 2. Packaged IIS preflight chain (CLOSED)

The chain could never have worked. The rule rewrote OPTIONS to an intermediate
application URL with `stopProcessing="true"`, so no later rule mapped it onto the
iisnode handler and it would have 404'd — and iisnode passes the ORIGINAL request
URL to Node, so Express would not have seen that path either.

It now rewrites to `index.cjs`, the entrypoint the handler is actually mapped to.
Inbound rewrite runs before the authentication stage, so the `<location>`
requirement on `api/daily-data/v1/sites` no longer applies to the rewritten
request. Verified directly: OPTIONS on the REAL Daily Data path returns 204 with
`If-Match` and credentials (the `cors` middleware short-circuits ahead of the
identity middleware), while the request behind it is still 401. The dead
intermediate Express route is removed.

`verify:iis-server-only` now enforces this against the GENERATED package, not the
template: the preflight rewrite target must equal the declared handler path, the
rule must be OPTIONS-only, the stamp rule must run first, and the set of
Windows-authenticated locations must be exactly the two intended ones.

## 3. Previously unfinished browser scenarios — 2 of 5 closed

**Closed**, and they found a real product defect:

`buildPreviewFromBackupTexts` parsed every payload eagerly and let
`parseBackupJson` throw, which took the whole restore SELECTION panel down with
it — no restore UI at all, no explanation, even though every other unit was
restorable. Bisected in a real browser: `[]` correctly reads ריק/0 רשומות and
`null` correctly reads לא תקין/ידולג, but a parse error rendered nothing. The
preview now skips an unparseable file and carries on.

Two test-side defects the same work exposed: restore-unit rows were matched by an
unscoped file name (finding the plain file listing instead), and the backup
import targeted the first `input[type=file]`, which is the demo-data importer.

**Still fixme — 3 selective-restore scenarios.** The blocker is now LOCATED, not
vague: the fixture gained the full writable persistence layer a restore needs
(FormDigest, folder creation, direct file PUT, and read-back of the stored bytes
the app verifies), and the restore still stops at
`נתיב היעד ב-SharePoint אינו מוכן לביצוע הכנת התיקייה` because at least one
folder readiness probe in `src/utils/sharePointBrowserFilesystem.js` (127-140,
622) is still unanswered — most likely the owning-list/ParentList evidence. The
next step is written at the call site. This is outstanding LOCAL work, explicitly
NOT external acceptance.

## 4. Generated handoff (CLOSED)

`scripts/create-iis-server-only-package.mjs` generated an IIS README that
instructed blanket Windows Authentication with Anonymous disabled and referred to
the removed `TRUSTED_SITE_ACCESS_*` mechanism — contradicting the web.config it
ships beside. It is now generated from the supported route-specific topology and
documents the `allowedServerVariables` prerequisite, cryptographic secret
generation, the offline dependency workflow, artifact destinations, destination
`.env`/storage preservation and the canonical acceptance entry point.
`WINDOWS_ACCEPTANCE_CHECKLIST.md` remains canonical.

## 5. Final verified results

Platform darwin 26.6.2, node v26.7.0.

| Run | Result |
|---|---|
| SB `npx vitest run --maxWorkers=2` | **1325/1325**, 146 files, 0 skip |
| SB `npx playwright test` | **46 passed, 0 failed, 3 fixme** |
| SB lint vs base (`origin/main` 154/11/49) | **delta 0/0/0** |
| RM `npm test` (disposable Mongo, explicit `SITE_BUILDER_PATH`) | **279/279, 0 skipped** |
| RM client `vitest` | **33/33** |
| RM cross-origin acceptance (real client, real browser) | PASS (see §1) |
| `verify:system` | PASSED |
| `verify:iis-server-only` | VERIFIED |

### Final artifacts — generated, gitignored, NOT committed

| Artifact | Location | Evidence |
|---|---|---|
| SB Universal | `site-builder…/dist-universal` | buildId `58c8a4af-4ca7-4c62-8ad0-5bc9d8bf6851`, 73 files, JS/CSS hash `f8ef76353761e29ed09c6d7f39524bc3c475bc4885bab2391e51369c913e0362`, 31 assets byte-identical across two target identities |
| RM client | `…/client/dist` | tree hash `66ae559fdee3548c…` |
| SharePoint deployer | `…/sharepoint-deployer/client/dist` | tree hash `6cdbb40b492e0302…` |
| Server-only package | `…worktrees/srm-server-only-1015f2b` | sourceCommit `1015f2b` = RM HEAD at build, tree hash `36d94afc874c4907…` |
| **Paired manifest** | `…site-release-manager.worktrees/artifact-manifest.json` | both repo SHAs, all four artifacts, lock hashes, platform |

The paired manifest is the file named above. It is NOT the unrelated polaris-4178
physical-PDF manifest.

SB `package-lock.json` sha256 `a692c588b25ea1b89732aac44c7dee78d8de2b67bbd95ee2d0dddddad82abd9d`.
RM `server/package-lock.json` sha256 `651730b058e47a74bc498a09c24494d6fff00468245c1cad54f054d216f10f8b`.

## Netlify preview — classified, not repaired

The failing check belongs to an externally-configured Netlify site
(`stupendous-moxie-3e4526`) connected to the repository. It is **not caused by
this workstream** and is structural:

- there is no `netlify.toml` and no Netlify reference in `package.json`;
- the default `npm run build` is the SharePoint deployment pipeline, not a static
  site build. Run here it ends `FAILURE BOUNDARY: LIBRARY_CHECK` /
  `[postbuild] Failed: check-only failed` because no SharePoint environment
  exists — which is equally true in Netlify CI, on any branch including main.

No external service settings were changed and the check was not suppressed. The
owner's options are to disconnect the integration for this repository or add a
`netlify.toml` pointing at a genuine static build; that is a decision outside
this workstream.

## Genuinely external — unchanged

1. Silent Windows SSO with no dialog: a domain-joined IIS host, correct
   zone/policy and an SPN. `docs/WINDOWS_IIS_ACCEPTANCE.md` §3.3.
2. That IIS honours the rewrite-before-authentication ordering for the preflight
   on a real host. Exact step: from a browser on the SharePoint origin, issue a
   cross-origin `PUT` to `{api}/api/daily-data/v1/sites/<id>/data/alerts` with
   `If-Match`; the OPTIONS must return 204 with no `WWW-Authenticate`, and the
   PUT behind it must still be challenged/authorized normally.
3. Windows-native dependency compatibility for the server-only package; the
   manifest states it was not validated on macOS.
4. Live SharePoint farm behaviour: historical folder repair and deployment
   against real libraries.


---

# Session 6 — selective-restore fixture completed; blocker relocated

Scope was the three `test.fixme` selective-restore scenarios only.
Netlify was explicitly out of scope and was not touched.

## The fixture is complete (this was the stated blocker)

Traced the real requests from `sharePointBrowserFilesystem.js` rather than
guessing, and modelled the state they expect **consistently**:

| Probe | Previously | Now |
|---|---|---|
| `_api/web/lists/GetByTitle('<lib>')` (BaseTemplate + RootFolder) | unanswered | answered from a two-library model |
| `GetFolderByServerRelativeUrl(x)/ListItemAllFields` | id only | + owning-library evidence (`ParentList` Id/Title/RootFolder) |
| list-item id vs parent-enumeration id | two hard-coded constants (17 vs 18) | one **stable id per folder path** |
| filtered parent enumeration, bare folder-object select | partial | complete |
| `/Backups/` | read-only | writable (manifest + copied sources), reads back what was written |
| live site files | empty | seeded, so a safety backup has real sources to copy |

The id inconsistency was the actual readiness failure: the check refuses a folder
when the list-item probe id differs from the parent-enumeration id
(`sharePointBrowserFilesystem.js:461`), so every freshly created backup folder
looked inconsistent and the restore retried and gave up.

**Proven:** the pre-restore safety backup now runs end to end against the fixture
— 10 source files plus two manifests written and read back — and a manual backup
outside a restore behaves identically, so `createBackup` is fully exercised.

## The blocker moved into the application

The three scenarios remain `fixme`, now for a product-side reason with evidence.
Reproduced for a master-involving selection AND for a BOOM-only selection (which
skips `ConfigService.saveConfig` entirely):

- the safety backup reports success (copied 10, skipped 0, errors 0);
- **no live-data write is ever issued**;
- **no result summary renders**;
- **no error toast appears** — polled every 200ms for 12s from the confirm click;
- `getAdminRecoveryState()` already reports `frozen:false` / `exclusive:null`, so
  `endAdminPersistenceSuspension` has **already run**.

So the orchestration leaves `beginAdminPersistenceSuspension('restore')` and
reaches an end state producing neither writes nor a report, silently. That sits
in `AdminBackupManagement.jsx` ~1428-1490. Fixing it touches the
safety-backup/restore contract, so it was not rushed at the end of this pass. The
assertions are correct as written and were NOT weakened.

## Results

| Run | Result |
|---|---|
| `npx playwright test` (fresh dev server) | **46 passed, 0 failed, 3 fixme** |
| `npx vitest run --maxWorkers=2` | **1325/1325** |
| affected regressions (AdminBackupManagement, backupPackage, sharePointBrowserFilesystem) | **66/66** |
| lint vs base (`origin/main` 154/11/49) | **delta 0/0/0** |

## Artifacts

**No production code changed** — the diff is `e2e/helpers/backupFixtures.js` and
`e2e/selective-restore.spec.js` only. The existing artifacts from session 5
therefore remain valid and were deliberately NOT rebuilt:

- SB Universal buildId `58c8a4af-4ca7-4c62-8ad0-5bc9d8bf6851`, hash
  `f8ef76353761e29ed09c6d7f39524bc3c475bc4885bab2391e51369c913e0362`
- server-only package `…worktrees/srm-server-only-1015f2b` (sourceCommit `1015f2b`)
- paired manifest `site-release-manager.worktrees/artifact-manifest.json`

Source equivalence: `git diff --stat HEAD~1 -- src/` is empty for this commit, so
the built artifacts correspond byte-for-byte to the production tree they were
built from.

## Genuinely external — unchanged from session 5

Silent Windows SSO; IIS honouring rewrite-before-authentication for the Daily
Data preflight on a real host; Windows-native dependency compatibility; live
SharePoint farm behaviour.
