# Site Release Manager

מערכת קטנה לניהול ומעקב אחרי אתרי Site Builder מסוג TXT ולפריסת ריליסים אוניברסליים ל-SharePoint.

## העיקרון

Site Builder עבר למודל Runtime Config ולכן ריליס אינו כולל קוד מקור ואינו נבנה מחדש לכל אתר.

```text
npm run build ב-Site Builder פעם אחת
        ↓
dist אוניברסלי
        ↓
Release Manager שומר את dist כריליס
        ↓
בחירת אתר + ריליס
        ↓
Runtime Config קטן נוצר אוטומטית לאתר
        ↓
SharePoint Deployer מעלה את אותו dist + ה-overlay של האתר
```

השרת של Release Manager אינו צריך גישה ל-SharePoint ואינו מריץ Vite עבור Site Builder.

## מה כולל הפרויקט

- `client` — React/Vite: דשבורד, אתרים וריליסים.
- `server` — Express + MongoDB: מעקב, אחסון ריליסים ויצירת metadata לפריסה.
- `sharepoint-deployer` — דף סטטי שמותקן פעם אחת בכל SharePoint host ומבצע את הכתיבה מתוך הדפדפן.
- `storage/releases` — עותקי `dist` אוניברסליים.
- `storage/deployments` — overlay קטן לכל משימת פריסה; אין כאן Build של Site Builder.

## התחלה מהירה

```bash
npm run setup
npm run install:all
npm run dev
```

`npm run setup` יוצר `.env` אם חסר.

פקודות Mongo שימושיות:

```bash
npm run mongo:check
npm run mongo:start
npm run mongo:stop
```

## העלאת ריליס

ב-Site Builder:

```bash
npm run build
```

לאחר מכן במסך **ריליסים**:

- גוררים את תיקיית `dist` ישירות, או
- לוחצים "בחר תיקייה", או
- גוררים את תיקיית הפרויקט עצמה; המערכת תזהה רק `dist` הישירה ותתעלם מכל שאר הפרויקט, או
- מעלים `dist.zip` כ-Fallback.

הריליס חייב לכלול לפחות:

```text
index.html
assets/*.js
```

המערכת אינה שומרת מתוך הריליס את הקבצים הבאים, משום שהם נוצרים מחדש לכל אתר בזמן הפריסה:

```text
sitebuilder-runtime-config.json
sitebuilder-deployment.json
sharepoint-deploy-manifest.json
```

לכן אותו ריליס בדיוק ניתן לפריסה לכל האתרים.

## Runtime Config שנוצר לכל אתר

בזמן לחיצה על "עדכן" או התקנה חדשה, השרת יוצר `sitebuilder-runtime-config.json` schema v2 עבור האתר הנבחר. הוא כולל בין היתר:

- `storageBackend: "txt"`
- `host`
- `siteCode`
- `siteDbFolder`
- `usersDbFolder`
- `siteAssetsFolder`
- `imagesFolder`
- `widgetsDbTarget`
- `siteRoot`
- `siteApiRoot`
- `siteDbRoot`
- `usersDbRoot`
- `siteAssetsRoot`
- `imagesRoot`
- `sharePointSiteUrl`
- `allowedSiteRoot`
- `targetDistPath`
- `finalAppUrl`
- `releaseVersion`
- `releaseId`
- `deployedAt`

הקובץ נשלח לדפדפן יחד עם ה-dist ואינו משנה את קובצי JS/CSS של הריליס.


## בדיקת פריסה מקומית לפני SharePoint

ב-localhost, לאחר בחירת אתר וריליס ולחיצה על **עדכן**, המשימה נעצרת במצב `READY_FOR_SHAREPOINT` ולא פותחת את SharePoint אוטומטית. במסך המשימה מופיע כפתור:

```text
הרץ בדיקת פריסה מקומית
```

הבדיקה יוצרת סימולציה תחת `storage/local-simulations/<jobId>` ובודקת:

- יצירת מבנה TXT וקובצי seed.
- שכל קובצי ה-dist וה-overlay קיימים.
- SHA-256 של כל קובץ.
- Runtime Config עבור ה-host וה-siteCode הנכונים.
- Deployment metadata והריליס הנכון.
- `index.html` אחרון בסדר ההעלאה.
- שההפניות המקומיות מתוך `index.html` קיימות ב-dist.

אם הכול תקין מתקבל `✓ הבדיקה המקומית עברה`.

הבדיקה המקומית לא יכולה לבדוק את ארבעת הדברים שתלויים ב-SharePoint אמיתי: SharePoint REST, cookies/session, FormDigest והרשאות. אותם בודקים רק ב-Smoke ראשון בתוך הרשת הסגורה.

## אתר קיים לעומת אתר חדש

### הוסף אתר קיים למעקב

שומר את פרטי האתר בלבד. שום דבר לא נכתב ל-SharePoint. לאחר מכן ניתן לבחור ריליס וללחוץ "עדכן".

### התקן Site Builder

בוחר ריליס ומפעיל את SharePoint Deployer. הדף:

1. משתמש ב-session של המשתמש המחובר ל-SharePoint.
2. יוצר `siteDB` ו-`siteUsersDb` אם הם חסרים.
3. יוצר תיקיות וקובצי TXT חסרים.
4. מעלה את קובצי ה-dist.
5. מעלה את Runtime Config וה-deployment metadata של האתר.
6. מעלה `index.html` אחרון.
7. מאמת את האתר ומעדכן את סטטוס המעקב.

## SharePoint Deployer — התקנה חד-פעמית

```bash
npm run build:deployer
```

יש להעלות את תוכן:

```text
sharepoint-deployer/client/dist
```

לנתיב המוגדר ב-`SHAREPOINT_DEPLOYER_PATH` בכל Host שמוגדר ב-`SHAREPOINT_HOSTS`.

לדוגמה:

```text
/sites/tools/SiteAssets/site-release-deployer/
```

Hosts מוגדרים כמערך דרך `.env`:

```env
SHAREPOINT_HOSTS=portal.army.idf,mazi.army.idf
```

## PUBLIC_API_URL

בסביבה האמיתית דף ה-Deployer שרץ ב-SharePoint חייב להיות מסוגל למשוך את קובצי הריליס מה-Release Manager.

לכן:

```env
PUBLIC_API_URL=https://<internal-release-manager-address>
```

אין להשתמש ב-`localhost` כאשר SharePoint נפתח ממחשב אחר.

## TXT בלבד

בגרסה הנוכחית כל האתרים הם TXT. אין בחירה ב-Mongo ואין Provisioning לאתרי Mongo.

MongoDB בפרויקט הזה משמש רק את אפליקציית המעקב עצמה.

## Windows סגור

מכיוון שה-Release Manager כבר אינו בונה Site Builder, אין צורך ב-`builder-runtime`, Vite/esbuild/Rollup של Site Builder או `node_modules` נוסף עבור ריליסים.

על מחשב Windows מחובר באותה ארכיטקטורה:

```powershell
Copy-Item .env.example .env
npm run install:all
npm run build
npm run verify:transfer
```

לאחר הצלחה מעבירים את התיקייה, כולל `server/node_modules`, `client/dist` ו-`sharepoint-deployer/client/dist`, לסביבה הסגורה.

בסביבה הסגורה:

```powershell
npm start
```

נדרש MongoDB זמין והגדרות `.env` מתאימות.

## פקודות

```bash
npm run dev
npm run build
npm run start
npm run test
npm run verify:transfer
```


## Local deep deployment audit (v0.2.4)

For any deployment job in `READY_FOR_SHAREPOINT`, click **הרץ Audit מקומי מלא** before moving to the closed network. The audit validates the universal `dist`, runtime/deployment overlays, manifests, hashes, seed behavior, configured SharePoint host, MongoDB/storage, the local SharePoint Deployer build, and upload order. It also writes a copyable PASS/WARN/FAIL diagnostic log and `storage/local-simulations/<jobId>/local-verification-report.json`.

Warnings are expected locally for checks that require a real SharePoint environment: SharePoint REST, browser session/cookies, FormDigest, permissions, live network/CORS reachability, and verifying that the deployer was actually installed on the target SharePoint host.

## v0.2.6 — reruns, release editing and version suggestions

- A release can be deployed again even if the site is already on that version.
- If an active deployment exists, the UI asks for confirmation; on approval the old job is marked `INTERRUPTED` and a fresh deployment job is prepared.
- Releases can be edited (version + notes) without replacing the stored universal `dist`.
- The release form remembers the latest release and suggests the next SemVer numbers for Hotfix/Patch, Minor and Major.
- Run `npm run verify:system` before transfer to exercise the project scripts, Mongo check, server tests and both production builds.

## ריצות SharePoint וטלמטריה — v0.2.7

העמוד **ריצות SharePoint** שומר היסטוריה של ניסיונות הפריסה ומציג כל ריצה כציר שלבים. ריצות חדשות מתעדות אירועים מובנים עבור הכנת הריליס בשרת ועבור ה-SharePoint Deployer בדפדפן.

השלבים העיקריים:

1. יצירת משימת פריסה
2. בדיקת Universal dist
3. יצירת Runtime Config
4. יצירת Manifest וסדר העלאה
5. מעבר ל-SharePoint
6. טעינת ה-Deployer ואימות Host היעד
7. קבלת FormDigest
8. בדיקת/יצירת Document Libraries
9. בדיקת/יצירת תיקיות
10. בדיקת/יצירת קובצי TXT
11. העלאת קובצי הריליס
12. אימות `index.html` ו-JavaScript סופי
13. סיום ועדכון גרסת האתר

בכשל נשמרים, ככל שהם זמינים: השלב, הקובץ הנוכחי, HTTP status, method, URL, הפעולה, duration ו-preview מקוצר של תשובת SharePoint. כל המידע זמין גם להעתקה מתוך חלון פרטי הריצה.

ריצות שנוצרו לפני v0.2.7 מוצגות כ-runs היסטוריים ללא פירוט השלבים החדש; ריצות חדשות מקבלות טלמטריה מלאה.

## UI ריצות SharePoint — v0.2.8

דף `ריצות SharePoint` מציג כעת פילטרי מצב ככפתורים צבעוניים וממוספרים במקום Dropdown.
בתוך כל ריצה קיימת מפת פריסה קבועה של 15 שלבים, כך שקל לראות מיד מה הושלם, מה בתהליך, מה נכשל ומה עדיין ממתין. מתחת למפה נשאר ציר האירועים המפורט עם כל בקשות ה-REST והטלמטריה.

ה-Updater המצטבר של v0.2.8 מריץ לאחר החלפה ואימות מוצלחים גם `npm run dev` אוטומטית מתוך תיקיית הפרויקט.

## v0.3.0 — Release Manager UI inside SharePoint

The Release Manager frontend is now SharePoint-safe:

- `client/vite.config.js` uses `base: './'` so built asset URLs stay relative.
- `client/src/main.jsx` uses `HashRouter`, so routes remain under `index.html#/...`.
- Production API calls are resolved from `client/dist/release-manager-runtime-config.json`; they never fall back to `https://<sharepoint-host>/api/...`.
- `PUBLIC_API_URL` is written into that runtime file after every client production build.
- Local Vite development still uses the existing `/api` proxy.
- `CLIENT_ORIGINS` accepts multiple comma-separated origins; configured SharePoint hosts are also accepted automatically.
- SharePoint Deployer production output is `sharepoint-deployer/client/dist/`.

For the same-computer SharePoint test:

```env
PUBLIC_API_URL=http://127.0.0.1:4300
CLIENT_ORIGINS=http://localhost:5173,https://portal.army.idf,https://mazi.army.idf
```

Then run `npm run build`, upload `client/dist/` to the Release Manager SharePoint folder, keep `npm run dev` running on that same computer, and open the SharePoint-hosted `index.html#/...` page.

When the Node API later moves to the permanent internal server, change only `PUBLIC_API_URL` and run `npm run runtime:client`. This rewrites only `client/dist/release-manager-runtime-config.json`; the existing frontend JS/CSS assets stay unchanged.

`CREATE_PROJECT_7Z.txt` at the repository root contains the PowerShell command for creating a timestamped `.7z` of the entire project while excluding every `node_modules` folder and keeping `.env` files.

## IIS packaging (closed Windows server)

The project now includes an IISNode packaging path matching the layout that previously worked reliably on the closed server:

- root `web.config`
- root `index.js` IISNode entry
- bundled `runtime/node.exe` copied from the working Windows workstation at packaging time
- `server/src` + Windows `server/node_modules`
- `client/dist`
- `sharepoint-deployer/client/dist`
- `.env`
- `storage`

On the working Windows workstation, after local verification, double-click `CREATE_IIS_PACKAGE.cmd` or run `npm run package:iis`.
The generated timestamped `.7z` next to the project is the package to extract into the IIS physical folder.

IIS prerequisites remain IISNode + URL Rewrite. Use an Application Pool with **No Managed Code**. The generated `web.config` rewrites non-file requests to `index.js` and uses the bundled `runtime\\node.exe`, avoiding reliance on the server PATH.

If the Release Manager UI remains hosted inside SharePoint, set `PUBLIC_API_URL` / `client/dist/release-manager-runtime-config.json` to the final HTTPS IIS URL before packaging/uploading the UI.

## v0.3.2 — SharePoint runtime diagnostics and automatic manager UI deploy

The Release Manager production UI now loads its API runtime descriptor from the SharePoint-safe `release-manager-runtime-config.txt` first, with `.json` as a compatibility fallback. If loading fails, the bootstrap screen prints the exact requested URL, HTTP status, content type, parsing error and response preview. A `<!DOCTYPE`/HTML preview means SharePoint returned an HTML page instead of the runtime file.

`npm run build` on the closed Windows workstation can automatically replace the Release Manager UI at the configured SharePoint `dist` path. The deployment uses WebDAV + `robocopy /MIR`, copies `index.html` last, and verifies the runtime files in the target. Configure:

- `RELEASE_MANAGER_AUTO_SHAREPOINT_DEPLOY=true`
- `RELEASE_MANAGER_SHAREPOINT_HOST=portal.army.idf`
- `RELEASE_MANAGER_SHAREPOINT_DIST_PATH=/sites/alphateam/site_release_manager/dist`

The real SharePoint Deployer production output remains `sharepoint-deployer/client/dist/`.

## v0.3.3 — closed-Windows SharePoint local test workflow

For the first same-computer SharePoint test, `.env` should contain:

```env
PUBLIC_API_URL=http://127.0.0.1:4300
MONGO_URI=mongodb://127.0.0.1:27017
AUTO_START_MONGO=false
RELEASE_MANAGER_AUTO_SHAREPOINT_DEPLOY=true
RELEASE_MANAGER_SHAREPOINT_HOST=portal.army.idf
RELEASE_MANAGER_SHAREPOINT_DIST_PATH=/sites/alphateam/site_release_manager/dist
```

The simplest test command on the closed Windows workstation is:

```text
npm run sharepoint:test
```

It performs the manager UI build, deploys `client/dist` to the configured SharePoint
folder, then leaves the local Node API running at `127.0.0.1:4300`. Keep that
terminal open while using the Release Manager UI from SharePoint.

If the manager UI is already deployed, run only:

```text
npm run sharepoint:local
```

The production/server phase later changes only `PUBLIC_API_URL` to the internal
server HTTPS URL. The same SharePoint UI build/runtime-config model remains valid.

The Release Manager still stores universal Site Builder `dist` releases. Site
identity is not baked into those releases; the Site Builder runtime overlay is
created per target site during deployment.

## v0.3.4 — SharePoint deployment behavior

When the Release Manager UI itself is opened from the same SharePoint host as the target site, deployment runs automatically in a hidden SharePoint Deployer iframe. The user stays in the Release Manager and follows progress through the job/run telemetry. "Open SharePoint diagnostics" remains only as a troubleshooting fallback.

Before `npm run sharepoint:test`, the deployer tool is built from `sharepoint-deployer/ready` into `sharepoint-deployer/client/dist` and published to `SHAREPOINT_DEPLOYER_PUBLISH_PATH` (default `/sites/tools/SiteAssets/site-release-deployer`).

## v0.3.5 — SharePoint deployment execution model

For same-host deployment (for example the Release Manager and target site are both on `portal.army.idf`), the Release Manager UI itself executes the SharePoint REST deployment. No separate SharePoint Deployer page is required for normal operation.

The global deployment coordinator automatically picks up jobs in `READY_FOR_SHAREPOINT` or `DEPLOYING`, runs the SharePoint stages in the current SharePoint page, and can resume an idempotent deployment after navigation/reload.

The external deployer URL remains only as a diagnostic/cross-host fallback.
