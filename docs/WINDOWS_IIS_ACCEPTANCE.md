# Windows / IIS acceptance

Everything in this file is what could NOT be proven on the build machine (macOS).
Each check states what PASS and FAIL look like, so acceptance is not a judgement call.

Run from the Windows host that serves Release Manager. `$Base` is the Release
Manager origin, e.g. `https://srm.army.idf`.

```powershell
$Base = 'https://srm.army.idf'
```

---

## 1. Service is up

```powershell
Invoke-RestMethod "$Base/api/health" | Format-List ok, appVersion, mongoDbName, builderDataMongoDbName
```

PASS: `ok = True` and the two database names match the intended installation.

---

## 2. Readiness is anonymous and JSON

Site Builder's deploy gate calls `{dailyDataApiUrl}/readyz` with NO credentials and
accepts ONLY JSON with `ok = true`. An HTML 200 is a failure.

```powershell
$r = Invoke-WebRequest "$Base/api/daily-data/v1/readyz" -UseBasicParsing
$r.StatusCode
$r.Headers['Content-Type']
$r.Headers['WWW-Authenticate']
$r.Content
```

PASS: `200`, content type `application/json`, `WWW-Authenticate` EMPTY, body `"ok":true`.
FAIL: `401`; any `WWW-Authenticate`; `text/html`; `"ok":false` (read `missingCollections`).

Same for `/api/daily-data/v1/healthz`.

---

## 3. Site data still requires identity

```powershell
try { Invoke-WebRequest "$Base/api/daily-data/v1/sites/any-site/data/alerts" -UseBasicParsing }
catch { $_.Exception.Response.StatusCode.value__ }
```

PASS: `401`. FAIL: `200` — readiness being open must never open site data.

---

## 4. THE POPUP CHECK — silent SSO, no native dialog

Do this in the browser the operators actually use, signed in as a domain user.

1. Open Release Manager from SharePoint.
2. Open DevTools → Network.
3. Click **Create Mongo Site** and complete the form.

Watch the request to `POST /api/auth/session`.

| Observation | Verdict |
|---|---|
| `201`, no dialog appeared | **PASS** — silent SSO works |
| A native Windows username/password box appears | **FAIL** — go to section 8 |
| `401` with JSON `management_identity_unavailable`, no dialog | **Expected unauthorized behavior**, not a crash. The identity was not established; fix the environment per section 8 |

The application itself never sends `WWW-Authenticate`. Any native dialog is issued
by IIS before the request reaches Node.

Only `POST /api/auth/session` is sent with credentials. Confirm in DevTools that
`POST /api/sites` carries `Authorization: Bearer ...` and NOT cookies/credentials.

---

## 5. Authorized create end to end

PASS requires all of:
- site appears in the list with a `srm-` prefixed `builderSiteId`;
- the creating operator is listed under **מנהלי נתונים** in the site's data-access panel;
- provisioning reports defaults created;
- `/readyz` now returns `"ok":true`.

---

## 6. Spoofing must not authorize

```powershell
$body = '{"mode":"install","unit":"u","name":"spoof","managerName":"m","host":"portal.army.idf","siteCode":"spoof","storageBackend":"mongo"}'
try {
  Invoke-WebRequest "$Base/api/sites" -Method POST -UseBasicParsing `
    -ContentType 'application/json' -Body $body `
    -Headers @{ 'X-IISNode-Auth-User' = 'DOMAIN\attacker'; 'X-IISNode-SharePoint-Sites' = 'srm-anything' }
} catch { $_.Exception.Response.StatusCode.value__ }
```

PASS: `401`. FAIL: `201` — URL Rewrite is not re-stamping the trusted header; check
that the `StampTrustedIdentityHeaders` rule exists, is FIRST, and has NO conditions.

Confirm the rewrite actually replaces the header:

```powershell
Get-WebConfiguration -Filter '/system.webServer/rewrite/rules/rule[@name="StampTrustedIdentityHeaders"]' -PSPath 'IIS:\Sites\SiteReleaseManager'
```

PASS: `replace="true"` on `HTTP_X_IISNODE_AUTH_USER`, and
`HTTP_X_IISNODE_SHAREPOINT_SITES` set to empty.

---

## 7. Unauthorized operator

Sign in as a domain user who is NOT in a site's `dataAccess` lists and read that
site's data.

PASS: `403`. FAIL: `200`.

---

## 8. Silent IWA environment checks

Run these only if section 4 produced a dialog.

```powershell
# Windows Authentication on, Anonymous off, for the API path
Get-WebConfigurationProperty -Filter '/system.webServer/security/authentication/windowsAuthentication' -Name enabled  -PSPath 'IIS:\Sites\SiteReleaseManager'
Get-WebConfigurationProperty -Filter '/system.webServer/security/authentication/anonymousAuthentication' -Name enabled -PSPath 'IIS:\Sites\SiteReleaseManager'

# Providers: Negotiate should precede NTLM
Get-WebConfiguration -Filter '/system.webServer/security/authentication/windowsAuthentication/providers' -PSPath 'IIS:\Sites\SiteReleaseManager'

# App pool identity
(Get-Item 'IIS:\AppPools\SiteReleaseManager').processModel.identityType

# SPN must exist for the app pool identity, or Kerberos silently degrades to NTLM
setspn -L <DOMAIN>\<AppPoolAccount>
setspn -Q HTTP/srm.army.idf
```

Browser policy — the usual cause of a dialog even when IIS is correct:

- the Release Manager origin must be in **Local Intranet**, not Internet;
- Local Intranet → Custom level → **Automatic logon only in Intranet zone**;
- for Chrome/Edge by policy: `AuthServerAllowlist` and
  `AuthNegotiateDelegateAllowlist` must include the Release Manager host.

Cross-origin note: the SharePoint-hosted UI calls Release Manager on another
origin, so the browser must be willing to send credentials to it. That is exactly
why only `POST /api/auth/session` is credentialed — it is the single request that
needs this, and it is made once per session rather than on every click.

DO NOT run an IIS-wide reset, reboot, or global IISNode upgrade as part of this.

---

## 9. Runtime overlay and Site Builder data path

On a deployed Site Builder target:

```powershell
Invoke-RestMethod 'https://portal.army.idf/sites/<web>/<library>/dist/site-builder-runtime-config.json' |
  Format-List storageBackend, siteId, dailyDataApiUrl
```

PASS: `storageBackend = mongo`, a stable `siteId`, and `dailyDataApiUrl` ending in
`/api/daily-data/v1`.

Then, in the app as an authorized user, edit and save content. PASS: the write
survives a reload and appears under that `siteId` in Mongo. FAIL: any fallback to
TXT, or a URL containing a duplicated `/api`.

---

## 10. An existing TXT site is unchanged

Open a TXT site that was working before the upgrade. PASS: loads and saves exactly
as before; its TXT files, media and backups are untouched.
