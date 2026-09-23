# Transfer to the closed Windows environment, and rollback

## 1. What to carry in

Four artifacts. None of them live in Git — all are generated, and all are
`.gitignore`d. Rebuild them from the tagged source rather than trusting an old copy.

| # | Artifact | Built by | Goes to |
|---|---|---|---|
| 1 | Site Builder `dist-universal/` | `npm run build:universal` (site-builder) | uploaded as a Release in Release Manager |
| 2 | Release Manager `client/dist/` | `npm run build:client` | served by the Release Manager server |
| 3 | SharePoint deployer `sharepoint-deployer/client/dist/` | `npm run build:deployer` | the SharePoint deployer library |
| 4 | Server-only package | `SERVER_ONLY_PACKAGE_DIR=<dir> npm run package:iis-server-only` | the IIS application folder |

Carry the generated `artifact-manifest.json` alongside them and check the hashes
on arrival. Artifact 1 is the only one an operator uploads through the UI; 2–4
are placed on the server.

### Whitening / inspection notes

- The server-only package contains `node_modules/` resolved on the BUILD machine.
  Its manifest states `windowsRuntimeIncluded: false` and
  `windowsDependencyCompatibilityValidated: false` — this is deliberate and honest:
  no Windows runtime was bundled and no Windows-native dependency check was run on
  macOS. If any dependency turns out to need a native Windows build, run
  `npm ci --omit=dev` on the Windows host inside the package folder.
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
     installation. Generate with:
     `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))`
   - `MANAGEMENT_SESSION_TTL_SECONDS` — optional, defaults to 28800.
   Also REMOVE, if present: `TRUSTED_SITE_ACCESS_ENABLED`,
   `TRUSTED_SITE_ACCESS_HEADER`, `TRUSTED_SITE_ACCESS_SOURCE`. They are no longer
   read; per-site access now comes only from each site's explicit `dataAccess` lists.

```powershell
Start-WebAppPool -Name 'SiteReleaseManager'
```

Then work through `docs/WINDOWS_IIS_ACCEPTANCE.md`.

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

Rolling back re-opens the two defects this release closes — `/readyz` requiring
an identity, and the trusted-identity header being spoofable on requests that
resolve to a real file — so treat rollback as temporary.

If only the Site Builder Universal artifact needs reverting, redeploy the previous
Release from Release Manager; stored releases are immutable and remain available.

## 5. Explicitly NOT part of this procedure

No global Node installation change, no IIS-wide reset or reboot, no IISNode
upgrade, no account switching, no production data migration, and no live restore.
