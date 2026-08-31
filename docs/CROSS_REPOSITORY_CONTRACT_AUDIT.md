# Cross-Repository Contract Audit — Release Manager × Site Builder

Site Builder is authoritative. Release Manager must understand its contracts
exactly; where it re-states one, that re-statement has to be provable.

This audit lists every place the two repositories describe the same thing, the
decision taken for each, and the test that stops it drifting.

---

## Decisions at a glance

| Contract | Decision | Enforced by |
|---|---|---|
| Universal build manifest | Mirror + assert against the real artifact | `siteBuilderContract.test.js` |
| SharePoint runtime descriptor | Mirror + feed output into Site Builder's own descriptor | `siteBuilderContract.test.js` |
| TXT data-file registry | Mirror + assert against Site Builder's `FILE_NAMES` | `siteBuilderContract.test.js` |
| SharePoint error classification | **Superset**, deliberately not shared | `sharepointProvisioning.test.js` |
| Exact library provisioning | Independent implementation, same JSOM approach | `sharepointProvisioning.test.js` |
| Folder/file readiness | Independent implementation, same readiness definition | `sharepointProvisioning.test.js` |
| Deployment stages | Independent, semantically aligned | `deploymentPipeline.test.js` |
| Deployment pipeline (within Release Manager) | **De-duplicated** into one shared module | `localVerificationService` audit |

---

## 1. Universal build manifest

**Site Builder:** `scripts/deploymentArtifacts.mjs` emits it; `assertBuildManifest`
validates it.
**Release Manager:** `shared/universalManifest.js`.

*Decision: mirror, with a test against the real artifact.* Importing Site
Builder's module directly would make Release Manager unbuildable without a
sibling checkout, and would couple it to Site Builder's build tooling. Instead
the mirror is proven: `siteBuilderContract.test.js` validates the actual
`dist-universal/sharepoint-deploy-manifest.json` on disk, checks every declared
file exists at the declared size, and checks every `index.html` reference
resolves. If Site Builder changes the manifest, that test fails.

Deliberate divergences, both matching Site Builder's own rules:
- schema versions 2, 3 and 4 are accepted (older stored releases exist);
- a *source* artifact may not carry a target overlay, but the *deployment*
  manifest Release Manager regenerates must — `allowTargetOverlay` distinguishes
  the two;
- a manifest may never list itself, matching Site Builder's builder guard.

## 2. SharePoint runtime descriptor

**Site Builder:** `src/config/sharepointRuntimeDescriptor.js`.
**Release Manager:** `shared/siteRuntime.js`.

*Decision: mirror, verified by round-trip.* This is the strongest check
available: `siteBuilderContract.test.js` feeds Release Manager's generated
identity into Site Builder's real `createSharePointRuntimeDescriptor()`. That
function throws when any derived value disagrees with what it would have derived
itself, so a clean call across three different target shapes is proof the two
implementations agree on `siteRoot`, `siteDbRoot`, `usersDbRoot`,
`siteAssetsRoot`, `imagesRoot`, `targetDistPath` and `finalAppUrl`.

Release Manager is deliberately *stricter*: it rejects an empty host or
siteCode, and rejects `siteDbFolder === usersDbFolder`. Site Builder tolerates
development fallbacks that must never reach a deployment.

## 3. TXT data-file registry

**Site Builder:** `FILE_NAMES` plus the `resolveFilePath` widgets rule.
**Release Manager:** `TXT_DATA_FILES` in `shared/siteRuntime.js`.

*Decision: mirror, asserted by parsing Site Builder's source.* The test extracts
`FILE_NAMES` from the descriptor file and requires the two lists to be equal,
then asserts every seed path equals the descriptor's corresponding
`*FileServerRelativeUrl` across three `widgetsDbTarget` combinations.

**This audit found a real bug.** Release Manager's seed list was missing
`boom_data.txt`, so a fresh logical site was provisioned without it. Fixed, and
the test now prevents its recurrence.

## 4. SharePoint error classification

**Site Builder:** `isSharePointDirectoryNotReady` and
`isSharePointFileMissingResponse` — two regex predicates, no `SPException`
handling.
**Release Manager:** `shared/sharepointErrors.js` — a full classifier producing
nine named classes.

*Decision: superset, not shared.* Release Manager needs strictly more than Site
Builder does: it must distinguish `PERMISSION_DENIED` from `AUTH_FAILURE` from
`PATH_COLLISION` to decide whether waiting can help, and it must recognise a
bare `Microsoft.SharePoint.SPException` as transient. Site Builder does not.

Compatibility is one-directional and holds: everything Site Builder's predicates
call "not ready" (404, and 400 with a FileNotFound/DirectoryNotFound payload)
this classifier calls `MISSING`, and the stabilization barrier treats `MISSING`
as retryable. Tests cover all four shapes.

## 5. Exact library provisioning

**Site Builder:** `src/utils/sharePointExactLibraryProvisioning.js`.
**Release Manager:** `ensureExactLibrary` + `createExactLibraryViaJsom`.

*Decision: independent implementation using the same proven approach.* Site
Builder's module is browser-coupled and part of the frozen working flow; reusing
it would mean importing across repositories at runtime, which is not viable for
a SharePoint-hosted page. The essential mechanics are mirrored: JSOM
`SP.ListCreationInformation` with `set_templateType(101)` and an explicit
`set_url`, then verification of Id, Title, BaseTemplate and
RootFolder.ServerRelativeUrl.

Release Manager adds what its mission requires: an auto-suffixed root folder is
a hard failure (`LIBRARY_URL_ALLOCATION_FAILED`) rather than an accepted
outcome, and a root URL already owned by a different list is reported as
`LIBRARY_URL_COLLISION` and never deleted.

## 6. Folder and file readiness

**Site Builder:** `classifySharePointFolderProbe` — a folder is ready only when
`ListItemAllFields` returns `Id > 0`, `FileSystemObjectType === 1`, and a
matching path.
**Release Manager:** `client.probeFolder`, same definition.

*Decision: independent implementation, identical readiness rule.* Copying the
rule rather than the code, because Release Manager's client is dependency-
injected so it can be tested under Node. The rule matters more than the code: a
generic HTTP 200 is not sufficient evidence that a folder is writable.

## 7. Deployment stages

**Site Builder:** `legacyPipeline.js` stage list, used by its own setup page.
**Release Manager:** `shared/deploymentStages.js`, 21 stages.

*Decision: independent but semantically aligned.* Release Manager's list is a
superset covering the Node-side preparation Site Builder has no equivalent for.
The names that overlap are identical on purpose — `SHAREPOINT_CONTEXTINFO`,
`CREATE_LIBRARIES`, `CREATE_FOLDERS`, `CREATE_TXT_SEEDS`, `FINAL_ASSET_COPY`,
`FINAL_ASSET_VERIFY`, `FINAL_RUNTIME_CONFIG_VERIFY`, `FINAL_INDEX_COMMIT`, `FINAL_INDEX_VERIFY`,
`FINAL_APP_SMOKE`, `COMPLETE` — so evidence from either system reads the same.

---

## 8. Duplication removed *inside* Release Manager

The standalone SharePoint Deployer previously carried its own full copy of the
provisioning sequence. That copy is what drifted: it had no stabilization, no
error classification and no exact-URL library creation.

It now imports `shared/deploymentPipeline.js` — the same module the in-page
worker runs — and its build copies `shared/` alongside it. The local audit
verifies both that the shared modules shipped and that the pipeline still
contains the behaviour that matters, so the fallback path cannot silently
regress again.

---

## 9. What is NOT mirrored, on purpose

| Site Builder concern | Why Release Manager stays out |
|---|---|
| Legacy build and WebDAV existing-site deployment | Frozen working flow; the user explicitly protected it |
| TXT read/write semantics at runtime | Application behaviour, not deployment |
| SharePoint permissions setup | Changing role assignments is a security operation; Release Manager reports the state and refers the operator to Site Builder |
| Mongo repositories and migrations | Out of scope until TXT reaches acceptance |
| Backup and restore | Site Builder owns its own data lifecycle |

---

## 10. Running the audit

```bash
npm run test:full
```

The contract tests skip cleanly when the Site Builder sibling checkout is
absent. To point them elsewhere:

```bash
SITE_BUILDER_PATH=/path/to/site-builder npm --prefix server run test
```
