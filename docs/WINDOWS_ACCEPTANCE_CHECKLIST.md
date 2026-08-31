# Windows Acceptance Checklist — Release Manager TXT Pipeline

The branch has now completed a real deployment on the closed Windows +
SharePoint environment for the existing `schedule` Web using the independent
logical target `siteDB1` + `siteUsersDb1`. Release Manager reached 100% and
reported a successful SharePoint deployment. This is real evidence that one Web
can host more than one logical Site Builder target.

The same acceptance run also produced a screenshot of Site Builder showing
`missing_runtime_config`. That observation is not accepted as an unrelated UI
issue: a deployment is only successful when the runtime file beside
`index.html` is directly readable and matches the current target and run. The
current pipeline now enforces that contract before activating `index.html`.

Run it on the closed Windows workstation, from the SharePoint host, in order.

---

## 0. Setup (once)

```
git fetch origin
git checkout codex/release-manager-txt-orchestration
npm run install:all
npm run build
```

Confirm before starting:

- [ ] MongoDB is running as a Windows service — `sc query MongoDB`
- [ ] `.env` has `AUTO_START_MONGO=false`
- [ ] `.env` `CLIENT_ORIGINS` includes every SharePoint host you will open the UI from
- [ ] `.env` `PUBLIC_API_URL=http://127.0.0.1:4300`

Start the API and leave the terminal open:

```
npm run sharepoint:local
```

- [ ] `http://127.0.0.1:4300/api/health` returns `ok:true` with the app version
- [ ] Opening Release Manager from SharePoint loads without the bootstrap error screen

> If the API is unreachable from SharePoint, the failure screen now names the
> exact cause. An unconfigured origin returns HTTP 403 with `ORIGIN_NOT_CONFIGURED`
> and lists the configured origins — that is a `.env` fix, not a code fix.

---

## 1. Upload a release

```
cd ..\site-builder
npm run build:universal
npm run verify:universal-dist
```

In Release Manager, upload `dist-universal` as a new release.

- [ ] The release is accepted
- [ ] Its build ID matches `sharepoint-deploy-manifest.json`
- [ ] Version suggestions offer patch / minor / major
- [ ] Uploading a Legacy `dist` is **rejected** with a specific reason

---

## 2. Acceptance matrix

### A — Existing target, new release
The protected regression path. Use a site that already works.

1. Select the existing site and the new release. Deploy.

- [ ] Reaches **COMPLETE** without a refresh or a second click
- [ ] `CREATE_TXT_SEEDS` reports files **preserved**, not created
- [ ] Open the site: existing events / users / theme / widgets are unchanged
- [ ] `FINAL_INDEX_VERIFY` and `FINAL_APP_SMOKE` both pass
- [ ] `FINAL_RUNTIME_CONFIG_VERIFY` directly reads both runtime JSON files and passes
- [ ] The site's current version updates only after COMPLETE

> **Stop here if this fails.** This is the frozen working path.

### B — Existing target, same release again
- [ ] Deploying the same version again is allowed
- [ ] **No duplicate-job 409** — history must never block a deployment
- [ ] Reaches COMPLETE; TXT data still unchanged

### C — Fresh logical target inside an existing SharePoint Web
Create a Site record on a Web that already exists, with new library names
(e.g. `siteDBFresh` / `siteUsersDBFresh`). Deploy in one click.

- [ ] `CREATE_LIBRARIES` creates both libraries at the **exact** configured URL
      (no `1` suffix)
- [ ] `LIBRARY_STABILIZE` passes
- [ ] `CREATE_FOLDERS` → `FOLDER_STABILIZE` pass
- [ ] `CREATE_TXT_SEEDS` creates **all 10** files, including `boom_data.txt`
- [ ] `PERMISSIONS_SETUP` reports whether Site Builder permissions have been set
- [ ] Assets → verify → index last → verify → smoke → **COMPLETE**
- [ ] **No refresh, no second click, no manual SharePoint upload**

Verify in SharePoint:
- [ ] `/sites/<code>/siteDBFresh/siteAssets/` holds 9 TXT files
- [ ] `/sites/<code>/siteUsersDBFresh/widgets_data.txt` exists
- [ ] `/sites/<code>/siteDBFresh/dist/index.html` loads the app

### D — Real eventual consistency
This is what the workstream exists to fix. It may occur naturally during C; if
it does, record it and tick the box.

- [ ] At least one stage logged a wait (`ממתין לייצוב…` / `ממתין לאימות…`)
- [ ] The run recovered automatically and reached COMPLETE
- [ ] The run details show the attempt count for that stage

To force it, deploy to a Web under load, or create the libraries manually
seconds before starting the run.

### E — Browser reload during deployment
1. Start a deployment on a fresh target.
2. During `FINAL_ASSET_COPY`, press F5.

- [ ] The run does **not** go to FAILED
- [ ] After reload the same run resumes (state PAUSED or DEPLOYING, same run id)
- [ ] Already-verified assets are not re-uploaded
- [ ] Reaches COMPLETE

Also test closing the tab entirely and reopening Release Manager:
- [ ] The run is rediscovered and resumes

### F — Target A then target B from one release
Deploy the same release to two logical targets in the same Web.

- [ ] Both reach COMPLETE
- [ ] A's `sitebuilder-runtime-config.json` names A's libraries
- [ ] B's names B's libraries
- [ ] Neither contains the other's paths
- [ ] Both apps load and read their own data

### G — Invalid or conflicting library root
Create a Site record whose `siteDbFolder` collides with an existing non-library
list, or with a library owned by a different title.

- [ ] The run fails **clearly** at `CREATE_LIBRARIES` / `LIBRARY_DISCOVERY`
- [ ] The error names the conflict (`LIBRARY_URL_COLLISION`,
      `LIBRARY_EXISTS_NOT_DOCUMENT_LIBRARY`, or `LIBRARY_URL_ALLOCATION_FAILED`)
- [ ] **No suffixed library** (`siteDB1158**1**`) was created
- [ ] The conflicting existing list was not deleted or renamed

---

## 3. Run management

- [ ] **Cancel** during a run settles it as CANCELLED and frees the target
- [ ] After a cancel, a new deployment to the same target starts normally
- [ ] **Retry** on a FAILED run reuses the same run and increments the attempt
- [ ] Starting a deployment while one is active offers replace / open / cancel
- [ ] A run whose worker died is reported as stale and can be superseded

---

## 4. Site and release management

- [ ] Create a Site record on a Web never tracked before, then deploy
- [ ] Site details show libraries, folders and the 10 TXT paths to be created
- [ ] Site details state that Release Manager does **not** create a SharePoint Web
- [ ] Edit a site: derived paths follow the change automatically
- [ ] While a run is active, metadata remains editable but identity/path fields are locked
- [ ] Delete a Site record — requires confirmation
- [ ] **After deletion, the SharePoint libraries, folders and TXT data still exist**

---

## 5. Two tabs (single provisioning owner)

1. Open Release Manager in two tabs on the same SharePoint host.
2. Start a deployment.

- [ ] Exactly one tab performs the deployment
- [ ] The other shows "הפריסה מתבצעת בלשונית אחרת"
- [ ] SharePoint shows no duplicated libraries or folders
- [ ] The run has a single COMPLETE

---

## 6. What to capture for the report

For each scenario: the run id, the final state, and the stage timeline
(**Copy everything** in the run details puts it all on the clipboard).

Specifically capture, from a fresh-site run:

```
LIBRARIES: READY
DEPLOY MODE: FINAL
FINAL_ASSET_COPY: SUCCESS
FINAL_ASSET_VERIFY: SUCCESS
FINAL_RUNTIME_CONFIG_VERIFY: SUCCESS
FINAL_INDEX_COMMIT: SUCCESS
FINAL_INDEX_VERIFY: SUCCESS
FINAL_APP_SMOKE: STATIC PASS
LEGACY_PIPELINE: COMPLETE
```

---

## 7. Remaining real-environment limitations

| Verified in automation or on Windows | Still requires Windows acceptance |
|---|---|
| Error classification against simulated 400/404/DirectoryNotFound/SPException | Real SharePoint error payloads from this farm |
| Stabilization and bounded retry logic | Real propagation timing — the retry budget may need tuning |
| Exact-URL library provisioning logic and one successful `siteDB1` / `siteUsersDb1` deployment | Repeat the JSOM path while capturing the final physical library URLs |
| TXT preservation, SHA verification, index-last commit in automation | Real pre-deploy backup bytes and index-last order on an update |
| Lease, locking, resume, cancel, retry (real MongoDB) | Behaviour under real network interruption |
| Contract compatibility with the on-disk Site Builder | Real browser JSOM script loading from `_layouts/15` |
| CORS, preflight, Private Network Access headers | Real Chrome/Edge behaviour on the closed network |
| Direct runtime URL and target validation in simulation | Confirm the deployed app no longer reports `missing_runtime_config` |

The JSOM library-creation path and the real SharePoint error payloads carry the
highest residual risk, because they are the two things a simulation cannot
faithfully reproduce.

---

## 8. Next acceptance after the `siteDB1` Windows run

### A — Update the existing `siteDB1` logical target

- [ ] Deploy another Release to `schedule | siteDB1 | siteUsersDb1`
- [ ] `PRE_DEPLOY_BACKUP` is attempted before folder/seed/release mutations
- [ ] The backup outcome and copied/skipped/failed counts are visible in the Run
- [ ] Deployment still reaches COMPLETE
- [ ] Every original TXT file is byte-identical after deployment
- [ ] `<siteAssetsRoot>/Backups/backup-<timestamp>` exists and contains the copied files

### B — Observe or force a backup failure

- [ ] Cause at least one backup read/copy/verification failure
- [ ] The backup outcome is FAILED or PARTIAL and appears as a warning
- [ ] The deployment continues through the normal pipeline
- [ ] A valid deployment may still finish SUCCEEDED
- [ ] The durable backup record retains the error and file counts

### C — Open a completed Run

- [ ] Primary action is `פתח אתר`
- [ ] Secondary action is `ריליסים אחרונים`
- [ ] External SharePoint diagnostics are not the primary success CTA
- [ ] A failed Run still exposes SharePoint diagnostics prominently

### D — Open the Site workspace

- [ ] The Site name opens the internal `#/sites/:siteId` route
- [ ] Current Release, recent deployment attempts, recent Runs and backup summary are correct
- [ ] The ten canonical TXT paths match `shared/siteRuntime.js`
- [ ] The link to all backups opens `#/backups?siteId=<siteId>`

### E — Open the deployed Site Builder app

- [ ] The app does not show `missing_runtime_config`
- [ ] `sitebuilder-runtime-config.json` is beside `index.html`
- [ ] `sitebuilder-deployment.json` is beside `index.html`
- [ ] Runtime host, `siteCode`, library roots, `siteAssetsRoot`, backend and final path match `siteDB1`
- [ ] Runtime deployment job/release metadata matches the completed Run

### F — Recheck two library pairs in the same `schedule` Web

- [ ] The original `siteDB | siteUsersDb` target remains independent
- [ ] The `siteDB1 | siteUsersDb1` target remains independent
- [ ] A deployment lock on one target does not block the other
- [ ] Each target receives its own Runtime Config and final URL
- [ ] No runtime path, TXT data, release history or backup metadata leaks between targets
