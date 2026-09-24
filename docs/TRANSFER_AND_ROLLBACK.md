# Transfer to the closed Windows environment, and rollback

## 1. What to carry in

Four artifacts. None of them live in Git — all are generated, and all are
`.gitignore`d. Rebuild them from the tagged source rather than trusting an old copy.

The topology is a **SharePoint-hosted UI plus an isolated IIS API**. The three
frontend artifacts are **not** copied into the API application folder.

| # | Artifact | Built by | Exact destination |
|---|---|---|---|
| 1 | Site Builder `dist-universal/` | `npm run build:universal` (site-builder) | **not placed by hand** — uploaded as a Release through the Release Manager UI, then deployed per target |
| 2 | Release Manager `client/dist/` | `npm run build:client` | the SharePoint library hosting the management UI, e.g. `/sites/tools/SiteAssets/site-release-manager/`. Its origin must be listed in `CLIENT_ORIGINS` on the API |
| 3 | SharePoint deployer `sharepoint-deployer/client/dist/` | `npm run build:deployer` | the library named by `SHAREPOINT_DEPLOYER_PATH`, default `/sites/tools/SiteAssets/site-release-deployer/` |
| 4 | Server-only package | `SERVER_ONLY_PACKAGE_DIR=<dir> npm run package:iis-server-only` | the IIS application folder, e.g. `C:\inetpub\srm-api` |

Carry the generated `artifact-manifest.json` alongside them and check the hashes
on arrival. Artifact 1 is the only one an operator uploads through the UI; 2–4
are placed on the server.

### Whitening / inspection notes

- The server-only package contains `node_modules/` resolved on the BUILD machine.
  Its manifest states `windowsRuntimeIncluded: false` and
  `windowsDependencyCompatibilityValidated: false` — deliberate and honest: no
  Windows runtime was bundled and no Windows-native dependency check ran on macOS.
- **There is no registry in the closed environment, so `npm ci` is not a recovery
  plan.** `node_modules/` ships inside the artifact. If a dependency turns out to
  need a native Windows build, use one of:
  a) rebuild the artifact on a Windows host;
  b) `npm ci --omit=dev` against an approved internal registry mirror;
  c) carry an `npm pack` / cache tarball set in and run
     `npm ci --omit=dev --offline --cache <carried-cache>`.
  Record which route was used in the acceptance report.
- No `.env`, no `storage/`, no Git metadata, no tests and no frontend bundles are
  inside the server-only package. Verified by `npm run verify:iis-server-only`.
- Nothing in the package contains secrets. `.env.example` is a template.

## 2. Install / replace

```powershell
Stop-WebAppPool -Name 'SiteReleaseManager'
```

1. **Back up first** — copy the existing application folder aside, and keep it
   until acceptance passes.
2. Replace ONLY these entries in the application folder:
   `index.cjs`, `web.config`, `package.json`, `package-lock.json`, `src/`, `node_modules/`.
3. **Do NOT touch** the items in section 3.
4. Merge any NEW keys from `.env.example` into the existing `.env`. This release
   adds:
   - `MANAGEMENT_SESSION_SECRET` — **required**, 32+ characters, unique per
     installation. `Get-Random` is NOT a cryptographic generator; on
     PowerShell 5.1 use:
     ```powershell
     $bytes = [byte[]]::new(48)
     [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
     [Convert]::ToBase64String($bytes)
     ```
   - `MANAGEMENT_SESSION_TTL_SECONDS` — optional, defaults to 28800.
   Also REMOVE, if present: `TRUSTED_SITE_ACCESS_ENABLED`,
   `TRUSTED_SITE_ACCESS_HEADER`, `TRUSTED_SITE_ACCESS_SOURCE`. They are no longer
   read; per-site access now comes only from each site's explicit `dataAccess` lists.

```powershell
Start-WebAppPool -Name 'SiteReleaseManager'
```

5. Confirm the IIS prerequisites in `IIS-DEPLOY-README.txt`, especially the two
   `allowedServerVariables` entries — URL Rewrite silently refuses to set a
   server variable that is not allow-listed, which leaves the trusted identity
   header empty and refuses every management session with no obvious cause.

Then work through the canonical entry point,
[`docs/WINDOWS_ACCEPTANCE_CHECKLIST.md`](./WINDOWS_ACCEPTANCE_CHECKLIST.md),
starting with the authentication topology in
[`docs/WINDOWS_IIS_ACCEPTANCE.md`](./WINDOWS_IIS_ACCEPTANCE.md).

The server refuses to start in production without `MANAGEMENT_SESSION_SECRET`.
That is intentional: a missing or guessable secret would make management session
tokens forgeable.

## 3. MUST be preserved — never overwrite

- `.env` in the application folder (real configuration and secrets)
- `storage/` — releases, deployments, local simulations, temp
- the MongoDB databases: `MONGO_DB_NAME` (tracking, jobs, runs, backups) and
  `BUILDER_DATA_MONGO_DB_NAME` (Site Builder application documents)
- existing release and deployment history
- every TXT site's SharePoint content: TXT data files, media, and backup folders

An immutable stored release is never rewritten by this upgrade. TXT sites are not
migrated and must behave exactly as before.

## 4. Rollback

Nothing in this release performs a schema migration, so rollback is a file swap.

1. `Stop-WebAppPool -Name 'SiteReleaseManager'`
2. Restore the application folder you copied aside in step 1 of section 2.
3. Restore the previous `.env` if you edited it. The older build does not
   understand `MANAGEMENT_SESSION_SECRET`; leaving the key present is harmless.
4. `Start-WebAppPool -Name 'SiteReleaseManager'`
5. Confirm `/api/health` responds and an existing TXT site still loads.

Mongo data written while the new build was running stays valid: site documents
gained no new required fields, and `dataAccess` was already present.

### Roll back the whole contract, not one piece

The API, the management UI, the deployer and the Site Builder runtime form one
contract. Rolling back only the API leaves a UI that sends
`Authorization: Bearer` and an `Idempotency-Key` to a server that ignores both,
and a `web.config` whose route-specific authentication no longer matches the
application. Restore the matching versions of artifacts 2, 3 and 4 together, and
note the Release the targets were on before deciding whether artifact 1 also
needs reverting.

Never restore an old copy OVER newly written live data: `.env`, `storage/`, the
Mongo databases and site content are preservation targets in both directions.

Rolling back re-opens what this release closes — `/readyz` requiring an identity,
the trusted-identity header being spoofable on requests that resolve to a real
file, consequential mutations protected only by blanket IIS authentication, and
non-idempotent creation — so treat rollback as temporary.

If only the Site Builder Universal artifact needs reverting, redeploy the previous
Release from Release Manager; stored releases are immutable and remain available.

## 5. Explicitly NOT part of this procedure

No global Node installation change, no IIS-wide reset or reboot, no IISNode
upgrade, no account switching, no production data migration, and no live restore.
