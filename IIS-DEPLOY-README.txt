IIS DEPLOYMENT — SITE RELEASE MANAGER

This package follows the IISNode layout that previously worked on the closed server:

Browser / IIS
  -> web.config URL Rewrite
  -> index.js
  -> IISNode named pipe
  -> bundled runtime\node.exe
  -> Express API + client/dist
  -> MongoDB

Before creating the final IIS archive on the closed Windows workstation:
1. Make sure the current project works locally.
2. Make sure client/dist exists and release-manager-runtime-config.json contains the correct PUBLIC_API_URL.
3. Make sure server/node_modules is the Windows copy that already works locally.
4. Double-click CREATE_IIS_PACKAGE.cmd.

The generated archive contains only what IIS/runtime needs plus storage and .env. It does NOT include client/node_modules, root node_modules, or SharePoint-deployer node_modules.

IIS prerequisites on the server:
- IISNode installed.
- IIS URL Rewrite installed.
- MongoDB reachable from the server according to .env.
- Application Pool: No Managed Code.

The web.config deliberately uses runtime\node.exe copied from the working Windows machine, matching the previous successful deployment pattern and avoiding dependence on PATH.

After extracting on the IIS server:
- Set the IIS Site/Application Physical Path to the extracted site-release-manager-iis folder.
- Browse <IIS URL>/api/health. Expected: {"ok":true}
- Browse <IIS URL>/api/config. Expected: JSON.
- If the Release Manager UI remains hosted in SharePoint, set its release-manager-runtime-config.json apiBaseUrl to this IIS HTTPS URL.
