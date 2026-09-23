# Authentication topology and IIS acceptance

> **Canonical acceptance entry point is [`WINDOWS_ACCEPTANCE_CHECKLIST.md`](./WINDOWS_ACCEPTANCE_CHECKLIST.md).**
> Start there. It owns the TXT pipeline, the release/run matrix and the
> farm-specific limitations. This file owns one thing the checklist does not:
> the **authentication topology** and how to prove it. Run this before the
> checklist's section 1, because nothing else works if identity is wrong.

Throughout, `$Api` is the isolated IIS API origin and `$Portal` is the SharePoint
host. Set them once; every command below reuses them. The documented example is
`sitebuilderhub.idf` — substitute your own and do not mix hosts between commands.

```powershell
$Api    = 'https://sitebuilderhub.idf'
$Portal = 'https://portal.army.idf'
```

---

## 1. The topology, and why each piece is what it is

The architecture is a **SharePoint-hosted UI plus an isolated IIS API**. Three
independent authentication boundaries:

| Boundary | What it authenticates | Carried by |
|---|---|---|
| **A. Management** | an operator performing consequential Release Manager actions | `Authorization: Bearer <management session>` |
| **B. Daily Data** | the end user reading/writing a site's data | Windows identity, per-site `dataAccess` roles |
| **C. Deploy worker** | the browser worker mutating SharePoint | `X-SRM-Lease` |

The IIS configuration that makes A work without a credential dialog:

| Path | Anonymous | Windows | Enforced by |
|---|---|---|---|
| everything by default | **on** | off | the application |
| `/api/health`, `/api/config` | on | off | nothing (public) |
| `/api/daily-data/v1/healthz`, `/readyz` | on | off | nothing (public by design) |
| `/api/auth/session` | **off** | **on** | IIS — the only challenge point |
| `/api/daily-data/v1/sites/*` | **off** | **on** | IIS + per-site roles |
| `OPTIONS` for the above | on | off | rewrite → anonymous handler |
| every consequential mutation | on | off | **Bearer, in the application** |

Two properties make this safe rather than "anonymous management":

1. **Anonymous at IIS is not anonymous at the app.** Site create/update/delete/
   deploy, release upload/update/delete and data-access administration all
   require a signed management session. Previously they were protected only by
   blanket Windows auth, which is exactly why turning that off naively would have
   exposed them.
2. **The challenge point takes no preflight.** The client posts to
   `/api/auth/session` with credentials and no custom headers, so it is a
   CORS-*simple* request. A browser sends it directly; there is no OPTIONS to be
   rejected. Every other cross-origin call is Bearer-authorized against an
   anonymous path, so its preflight succeeds.

`OPTIONS` for the Windows-protected Daily Data routes is diverted by an inbound
rewrite rule to `/api/cors-preflight/daily-data`, which is anonymous. URL Rewrite
runs *before* authentication, so the preflight is answered with the application's
own CORS policy and never meets a 401. Nothing about the authenticated request
itself is relaxed.

`web.config` ships this configuration. It is executable, not advisory.

### Server prerequisites

```powershell
# Windows Authentication role service must be installed.
Get-WindowsFeature Web-Windows-Auth

# Negotiate must precede NTLM.
Get-WebConfiguration -Filter '/system.webServer/security/authentication/windowsAuthentication/providers' -PSPath "IIS:\Sites\$SiteName"

# URL Rewrite SILENTLY refuses to set a server variable that is not allow-listed.
# Without these two entries the trusted header stays EMPTY and every session is
# refused with no obvious cause.
Get-WebConfiguration -Filter '/system.webServer/rewrite/allowedServerVariables' -PSPath "IIS:\Sites\$SiteName"
```

To add them once, at server scope:

```powershell
Add-WebConfiguration -Filter '/system.webServer/rewrite/allowedServerVariables' -PSPath 'MACHINE/WEBROOT/APPHOST' -Value @{name='HTTP_X_IISNODE_AUTH_USER'}
Add-WebConfiguration -Filter '/system.webServer/rewrite/allowedServerVariables' -PSPath 'MACHINE/WEBROOT/APPHOST' -Value @{name='HTTP_X_IISNODE_SHAREPOINT_SITES'}
```

---

## 2. Generate the management session secret

Required in production; the server refuses to start without it. **Do not use
`Get-Random`** — it is not a cryptographic generator. On PowerShell 5.1:

```powershell
$bytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Put the result in `MANAGEMENT_SESSION_SECRET` in the application `.env`. It is
unique per installation and must never be committed or reused.

---

## 3. Acceptance

### 3.1 Service and readiness (anonymous)

```powershell
Invoke-RestMethod "$Api/api/health" | Format-List ok, appVersion, mongoDbName, builderDataMongoDbName

$r = Invoke-WebRequest "$Api/api/daily-data/v1/readyz" -UseBasicParsing
$r.StatusCode; $r.Headers['Content-Type']; $r.Headers['WWW-Authenticate']; $r.Content
```

PASS: `200`, `application/json`, `WWW-Authenticate` **empty**, body `"ok":true`.
FAIL: `401` (readiness is behind auth); any `WWW-Authenticate`; `text/html`;
`"ok":false` — read `missingCollections` / `reason`.

### 3.2 The issuer boundary — test this on its own

A mutation rejecting a forged header proves nothing: mutations do not read
identity headers at all. **Issuance** is where spoof resistance matters.

```powershell
# (a) No identity -> JSON refusal, never a challenge.
try { Invoke-WebRequest "$Api/api/auth/session" -Method POST -UseBasicParsing }
catch {
  $_.Exception.Response.StatusCode.value__         # expect 401
  $_.Exception.Response.Headers['WWW-Authenticate'] # expect EMPTY
}

# (b) A browser-supplied trusted header must NOT mint a session.
try {
  Invoke-WebRequest "$Api/api/auth/session" -Method POST -UseBasicParsing `
    -Headers @{ 'X-IISNode-Auth-User' = 'DOMAIN\attacker' }
} catch { $_.Exception.Response.StatusCode.value__ }   # expect 401
```

PASS for (b) is `401`. A `201` means URL Rewrite is not re-stamping the header —
check `allowedServerVariables` above and that `StampTrustedIdentityHeaders` is the
**first** rule and has **no** conditions:

```powershell
Get-WebConfiguration -Filter '/system.webServer/rewrite/rules/rule[@name="StampTrustedIdentityHeaders"]' -PSPath "IIS:\Sites\$SiteName"
```

> A fail-closed refusal proves the app does not trust bad input. It does **not**
> prove authentication succeeds. That is section 3.3.

### 3.3 THE POPUP CHECK — silent SSO

In the browser operators actually use, signed in as a domain user.

1. Open Release Manager from SharePoint. 2. DevTools → Network.
3. Click **Create Mongo Site** and complete the form.

Watch `POST /api/auth/session`:

| Observation | Verdict |
|---|---|
| `201`, no dialog | **PASS** — silent SSO works |
| A native username/password box appears | **FAIL** → section 4 |
| `401` JSON `management_identity_unavailable`, no dialog | Identity not established. Not a crash; fix per section 4 |

Also confirm in DevTools that `POST /api/sites` carries
`Authorization: Bearer …` and is **not** credentialed. If it is, the topology has
drifted.

### 3.4 Authorized creation, and that a retry does not duplicate

PASS requires all of: the site appears with a `srm-` prefixed `builderSiteId`;
the creating operator is listed under **מנהלי נתונים**; provisioning reports
defaults created; `/readyz` returns `"ok":true`.

Then prove idempotency — resend the same create with the same key:

```powershell
$key = [guid]::NewGuid().ToString()
$body = '{"mode":"install","unit":"u","name":"idem-probe","managerName":"m","host":"portal.army.idf","siteCode":"idemprobe","storageBackend":"mongo"}'
$h = @{ Authorization = "Bearer $Token"; 'Idempotency-Key' = $key; 'Content-Type' = 'application/json' }
Invoke-RestMethod "$Api/api/sites" -Method POST -Headers $h -Body $body
Invoke-RestMethod "$Api/api/sites" -Method POST -Headers $h -Body $body
```

PASS: the second call returns the **same** `builderSiteId` with `idempotent: true`,
and the site list gained exactly one site.

### 3.5 Ordinary user access, and denial

As a domain user listed in a site's `dataAccess`: reading that site's data
succeeds. As a user **not** listed: `403`. A forged
`X-IISNode-SharePoint-Sites` header changes nothing — the application no longer
reads it at all.

### 3.6 Runtime overlay on a deployed target

The runtime file is **`sitebuilder-runtime-config.json`** (no hyphen after
"site"). Do **not** accept a direct library GET as evidence: on this farm a
library may answer HTML for a JSON request. Use the app's own runtime
diagnostics, or an authenticated SharePoint REST read with a type check:

```powershell
$u = "$Portal/sites/<web>/_api/web/GetFileByServerRelativeUrl('/sites/<web>/<library>/dist/sitebuilder-runtime-config.json')/`$value"
$resp = Invoke-WebRequest $u -UseDefaultCredentials -Headers @{ Accept = 'application/json;odata=verbose' } -UseBasicParsing
if ($resp.Headers['Content-Type'] -notmatch 'json|octet-stream') { throw "Not JSON: $($resp.Headers['Content-Type'])" }
$cfg = $resp.Content | ConvertFrom-Json
$cfg | Format-List storageBackend, siteId, dailyDataApiUrl
```

PASS: `storageBackend = mongo`, a stable `siteId`, `dailyDataApiUrl` ending in
`/api/daily-data/v1`. Then edit and save content in the app as an authorized
user: the write must survive a reload and land under that `siteId` in Mongo.
FAIL: any TXT fallback, or a URL containing a duplicated `/api`.

### 3.7 TXT is unchanged

Open a TXT site that worked before the upgrade. PASS: loads and saves exactly as
before; its TXT files, media and backups untouched. TXT management now also
requires a management session, so confirm edit/deploy still work through the UI.

---

## 4. When a dialog appears

IIS is correct but the browser is not volunteering credentials. Check, in order:

- the API origin is in **Local Intranet**, not Internet;
- Local Intranet → Custom level → **Automatic logon only in Intranet zone**;
- for Chrome/Edge by policy, `AuthServerAllowlist` (and
  `AuthNegotiateDelegateAllowlist` if delegating) include the API host;
- an SPN exists for the app pool identity, or Kerberos degrades to NTLM:

```powershell
(Get-Item "IIS:\AppPools\$PoolName").processModel.identityType
setspn -Q HTTP/sitebuilderhub.idf
```

Do **not** run an IIS-wide reset, a reboot, or a global IISNode upgrade as part
of this.

---

## 5. Still genuinely external

Only these need the real environment; everything else above is proven locally:

1. Silent Windows SSO completing with no dialog (§3.3) — needs a domain-joined
   host, correct zone/policy and an SPN.
2. Windows-native dependency compatibility for the server-only package — the
   build machine is macOS and the package manifest says so explicitly.
3. Live SharePoint farm behaviour: historical folder repair and deployment
   against real libraries.
