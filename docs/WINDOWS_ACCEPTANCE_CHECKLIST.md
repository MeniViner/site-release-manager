# Windows Acceptance Checklist — Release Manager TXT Pipeline

Everything in this repository has been verified on macOS against a simulated
eventually-consistent SharePoint farm. **No part of it has been executed against
the real closed SharePoint environment.** This checklist is what turns that into
a real acceptance result with the least manual effort.

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
- [ ] Editing is blocked while a run is active
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
FINAL_INDEX_COMMIT: SUCCESS
FINAL_INDEX_VERIFY: SUCCESS
FINAL_APP_SMOKE: STATIC PASS
LEGACY_PIPELINE: COMPLETE
```

---

## 7. Known macOS limitations (why this checklist exists)

| Verified on macOS | NOT verified anywhere yet |
|---|---|
| Error classification against simulated 400/404/DirectoryNotFound/SPException | Real SharePoint error payloads from this farm |
| Stabilization and bounded retry logic | Real propagation timing — the retry budget may need tuning |
| Exact-URL library provisioning logic | Real JSOM `SP.ListCreationInformation` behaviour |
| TXT preservation, SHA verification, index-last commit | Real SharePoint REST upload semantics |
| Lease, locking, resume, cancel, retry (real MongoDB) | Behaviour under real network interruption |
| Contract compatibility with the on-disk Site Builder | Real browser JSOM script loading from `_layouts/15` |
| CORS, preflight, Private Network Access headers | Real Chrome/Edge behaviour on the closed network |

The JSOM library-creation path and the real SharePoint error payloads carry the
highest residual risk, because they are the two things a simulation cannot
faithfully reproduce.
