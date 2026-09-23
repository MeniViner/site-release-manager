# CONTINUATION — Unified Convergence (site-builder + site-release-manager)

Version: 1 (2026-09-23)
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
