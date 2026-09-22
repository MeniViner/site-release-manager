/**
 * Browser-only adapters.
 *
 * The provisioning logic in shared/ is pure and injectable. This module supplies
 * the three things only a real authenticated SharePoint page can provide:
 * a credentialed fetch, WebCrypto SHA-256, and JSOM exact-library creation.
 *
 * Everything here requires the authenticated SharePoint session. None of it can
 * or should run on the Node API server.
 */

/** SHA-256 over bytes, as lowercase hex, matching the manifest format. */
export async function sha256Hex(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const JSOM_SCRIPTS = ['init.js', 'MicrosoftAjax.js', 'SP.Runtime.js', 'SP.js'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-srm-jsom="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      return undefined;
    }
    const element = document.createElement('script');
    element.src = src;
    element.async = false;
    element.dataset.srmJsom = src;
    element.addEventListener('load', () => { element.dataset.loaded = 'true'; resolve(); });
    element.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(element);
    return undefined;
  });
}

/**
 * Load SharePoint's JSOM from the target web's _layouts, in dependency order.
 * Mirrors Site Builder's `ensureSharePointJsom`.
 */
export async function ensureSharePointJsom(webUrl) {
  if (window.SP?.ClientContext && window.SP?.ListCreationInformation && window.SP?.ListItemCreationInformation) return window.SP;
  const web = new URL(webUrl);
  const layouts = `${web.origin}${web.pathname.replace(/\/+$/, '')}/_layouts/15/`;
  for (const script of JSOM_SCRIPTS) {
    // Sequential on purpose: SP.js depends on SP.Runtime.js.
    // eslint-disable-next-line no-await-in-loop
    await loadScript(`${layouts}${script}`);
  }
  if (!window.SP?.ClientContext || !window.SP?.ListCreationInformation || !window.SP?.ListItemCreationInformation) {
    const error = new Error('SharePoint JSOM is unavailable on this page, so an exact-URL Document Library cannot be created.');
    error.code = 'SHAREPOINT_JSOM_UNAVAILABLE';
    error.errorClass = 'PERMANENT_FAILURE';
    throw error;
  }
  return window.SP;
}

function assertExactFolderName(value) {
  const name = String(value ?? '');
  if (!name || name.trim() !== name || name === '.' || name === '..' || /[/\\"*:<>|]/.test(name)) {
    const error = new Error('SharePoint folder name is invalid.');
    error.code = 'INVALID_FOLDER_NAME';
    error.errorClass = 'INVALID_PATH';
    throw error;
  }
  return name.normalize('NFC');
}

function applyJsomFailure(error, args) {
  const errorCode = Number(args?.get_errorCode?.());
  const errorType = String(args?.get_errorTypeName?.() || '');
  const message = String(args?.get_message?.() || error.message || '');
  error.sharePointCode = Number.isFinite(errorCode) ? String(errorCode) : '';
  if (errorCode === -2147024891 || /UnauthorizedAccess|AccessDenied/i.test(`${errorType} ${message}`)) {
    error.errorClass = 'PERMISSION_DENIED';
  } else if (/security validation|formdigest|sign.?in|authentication/i.test(`${errorType} ${message}`)) {
    error.errorClass = 'AUTH_FAILURE';
  } else if ([-2130575257, -2130245363].includes(errorCode) || /already exists/i.test(message)) {
    error.errorClass = 'ALREADY_EXISTS';
  }
  return error;
}

/**
 * Create a child item in the already-verified owning library. Unlike generic
 * web folder creation this binds the item to a List ID and an exact real parent.
 */
export function createLibraryBoundFolderViaJsom(webUrl) {
  return async function createFolderExact({ libraryId, parentPath, leafName, folderPath }) {
    const SP = await ensureSharePointJsom(webUrl);
    const exactLeaf = assertExactFolderName(leafName);
    const expectedPath = `${String(parentPath).replace(/\/+$/, '')}/${exactLeaf}`.normalize('NFC');
    if (expectedPath.toLowerCase() !== String(folderPath).normalize('NFC').toLowerCase()) {
      const error = new Error('SharePoint folder path does not match its exact parent and leaf name.');
      error.code = 'FOLDER_PATH_MISMATCH';
      error.errorClass = 'INVALID_PATH';
      throw error;
    }
    if (!libraryId) {
      const error = new Error('A verified SharePoint List ID is required for folder creation.');
      error.code = 'LIBRARY_ID_REQUIRED';
      error.errorClass = 'PERMANENT_FAILURE';
      throw error;
    }

    const context = new SP.ClientContext(webUrl);
    const list = context.get_web().get_lists().getById(libraryId);
    const creation = new SP.ListItemCreationInformation();
    creation.set_underlyingObjectType(SP.FileSystemObjectType.folder);
    creation.set_folderUrl(parentPath);
    creation.set_leafName(exactLeaf);
    const item = list.addItem(creation);
    item.update();
    context.load(item, 'Id', 'FileSystemObjectType', 'FileRef');

    return new Promise((resolve, reject) => {
      context.executeQueryAsync(
        () => resolve({
          created: true,
          listItemId: Number(item.get_id?.() || 0),
          fileSystemObjectType: Number(item.get_fileSystemObjectType?.() ?? 1),
          fileRef: item.get_item?.('FileRef') || folderPath,
        }),
        (_sender, args) => {
          const error = new Error(args?.get_message?.() || 'JSOM folder creation failed.');
          error.code = 'JSOM_FOLDER_QUERY_FAILED';
          error.operation = `create-folder:${folderPath}`;
          reject(applyJsomFailure(error, args));
        },
      );
    });
  };
}

/**
 * Create a Document Library with an EXACT root folder URL.
 *
 * REST list creation derives the root folder from the title and silently
 * auto-suffixes on collision (siteDB1158 becomes siteDB11581). Only JSOM's
 * SP.ListCreationInformation lets the URL be set explicitly, which is why the
 * proven Site Builder path is mirrored here.
 */
export function createExactLibraryViaJsom(webUrl) {
  return async function createLibraryExact({ title, urlSegment, description = 'Site Builder data library' }) {
    const SP = await ensureSharePointJsom(webUrl);
    const context = new SP.ClientContext(webUrl);
    const creation = new SP.ListCreationInformation();
    creation.set_title(title);
    creation.set_templateType(101);
    creation.set_url(urlSegment);

    const list = context.get_web().get_lists().add(creation);
    if (typeof list.set_description === 'function') list.set_description(description);
    if (typeof list.set_onQuickLaunch === 'function') list.set_onQuickLaunch(true);
    if (typeof list.update === 'function') list.update();

    const rootFolder = list.get_rootFolder();
    context.load(list, 'Id', 'Title', 'BaseTemplate', 'OnQuickLaunch');
    context.load(rootFolder, 'ServerRelativeUrl');

    return new Promise((resolve, reject) => {
      context.executeQueryAsync(
        () => {
          resolve({
            id: String(list.get_id?.() || ''),
            title: list.get_title?.() || title,
            baseTemplate: Number(list.get_baseTemplate?.() || 101),
            rootFolder: rootFolder.get_serverRelativeUrl?.() || '',
          });
        },
        (_sender, args) => {
          const message = args?.get_message?.() || 'JSOM list creation failed.';
          const error = new Error(message);
          error.code = 'JSOM_QUERY_FAILED';
          error.operation = `create-library:${title}`;
          // Deliberately NOT classified as permanent: the create may have
          // committed anyway, and verified target state decides.
          reject(error);
        },
      );
    });
  };
}

/** A stable per-tab identity so the write lease can name its holder. */
export function workerClientId() {
  const key = 'srm-worker-client-id';
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `${window.location.hostname}-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `${window.location.hostname}-${Math.random().toString(36).slice(2)}`;
  }
}
