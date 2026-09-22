/**
 * SharePoint REST client used by the in-browser deployment worker.
 *
 * Everything here is dependency-injected (`fetchImpl`, `sha256`, `sleep`) so the
 * exact same code path that runs inside authenticated SharePoint is driven by
 * the Node test-suite against a simulated eventually-consistent farm.
 *
 * NODE/BROWSER BOUNDARY: this module never runs on the Node API server against a
 * real SharePoint host. Node has no SharePoint cookie, no FormDigest and no JSOM.
 * The API server only imports it for tests.
 */

const { classifySharePointError, sharePointError, SP_ERROR } = require("./sharepointErrors.js");
const ODATA_VERBOSE = 'application/json;odata=verbose';
const SEED_CONTENT_TYPE = 'text/plain; charset=utf-8';
const ASSET_CONTENT_TYPE = 'application/octet-stream';

/**
 * OData path escaping, mirrored from Site Builder's `escOData`.
 * A single quote doubles; the characters SharePoint refuses to route are encoded.
 */
function escapeODataPath(value) {
  return String(value ?? '')
    .replace(/'/g, "''")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
}

/** SharePoint rejects some characters outright rather than reporting "not found". */
const ILLEGAL_PATH_CHARS = /["*:<>|]/;

function assertServerRelativePath(value, label = 'path') {
  const raw = String(value ?? '');
  if (!raw.startsWith('/')) throw new Error(`${label} must be a server-relative path starting with "/" (got "${raw}").`);
  if (raw.includes('//')) throw new Error(`${label} contains an empty path segment: ${raw}`);
  if (raw.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`${label} contains a traversal segment: ${raw}`);
  }
  if (ILLEGAL_PATH_CHARS.test(raw)) throw new Error(`${label} contains characters SharePoint does not allow: ${raw}`);
  return raw;
}

const cacheBustSuffix = (url, token) => `${url}${url.includes('?') ? '&' : '?'}srmCacheBust=${token}`;

function unwrapODataRecord(payload) {
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'd')) {
    const value = payload.d;
    if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
    return value && typeof value === 'object' ? value : null;
  }
  const value = payload?.value ?? payload;
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value && typeof value === 'object' ? value : null;
}

function unwrapODataCollection(payload) {
  const value = payload?.d?.results ?? payload?.value ?? payload?.results ?? payload;
  return Array.isArray(value) ? value : [];
}

const positiveInteger = (value) => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

const listIdFrom = (record) => String(
  record?.ParentList?.Id
  ?? record?.List?.Id
  ?? record?.ParentListId
  ?? record?.ListId
  ?? '',
).replace(/[{}]/g, '').toLowerCase();

const explicitExists = (record) => (
  typeof record?.Exists === 'boolean' ? record.Exists : null
);

const folderPathFrom = (record) => normalizePath(record?.ServerRelativeUrl || '');

function classifyFolderProbe({
  status,
  payload,
  expectedPath,
  libraryRoot = false,
  probeKind = libraryRoot ? 'library-root' : 'list-item',
} = {}) {
  const numericStatus = Number(status || 0);
  const expected = normalizePath(expectedPath);
  if (numericStatus === 401 || numericStatus === 403) {
    return {
      ready: false,
      exists: false,
      authorization: true,
      reason: 'FOLDER_PROBE_AUTHORIZATION_FAILED',
      expectedPath: expected,
      status: numericStatus,
      errorClass: numericStatus === 401 ? SP_ERROR.AUTH_FAILURE : SP_ERROR.PERMISSION_DENIED,
    };
  }
  if (numericStatus === 404) {
    return { ready: false, exists: false, reason: 'FOLDER_NOT_FOUND', expectedPath: expected, status: numericStatus };
  }
  if (numericStatus < 200 || numericStatus >= 300) {
    return { ready: false, exists: false, reason: 'FOLDER_PROBE_FAILED', expectedPath: expected, status: numericStatus };
  }

  const record = unwrapODataRecord(payload);
  if (!record) {
    return { ready: false, exists: false, reason: 'FOLDER_METADATA_UNRECOGNIZED', expectedPath: expected, status: numericStatus };
  }
  if (libraryRoot) {
    const actualPath = normalizePath(record?.RootFolder?.ServerRelativeUrl);
    const id = String(record?.Id || '');
    const baseTemplate = Number(record?.BaseTemplate);
    const exists = Boolean(id || actualPath || record?.Title);
    let reason = 'LIBRARY_ROOT_READY';
    if (!id) reason = 'LIBRARY_ID_UNCONFIRMED';
    else if (baseTemplate !== 101) reason = 'LIBRARY_NOT_DOCUMENT_LIBRARY';
    else if (!samePath(actualPath, expected)) reason = 'LIBRARY_ROOT_PATH_MISMATCH';
    return {
      ready: reason === 'LIBRARY_ROOT_READY',
      exists,
      reason,
      expectedPath: expected,
      actualPath,
      status: numericStatus,
      id,
      baseTemplate: Number.isFinite(baseTemplate) ? baseTemplate : null,
    };
  }

  const explicitlyMissing = record.Exists === false;
  const id = positiveInteger(record.Id);
  const objectType = Number(record.FileSystemObjectType);
  const actualPath = normalizePath(record.FileRef ?? record.Folder?.ServerRelativeUrl ?? record.ServerRelativeUrl);
  const exists = explicitlyMissing ? false : Boolean(id || record.Exists === true || actualPath);
  let reason = 'LIST_BACKED_FOLDER_READY';
  if (explicitlyMissing) reason = 'FOLDER_NOT_FOUND';
  else if (!actualPath) reason = 'FOLDER_METADATA_UNRECOGNIZED';
  else if (!samePath(actualPath, expected)) reason = 'FOLDER_PATH_MISMATCH';
  else if (probeKind === 'folder-object' && !id) reason = 'FOLDER_OBJECT_VISIBLE_WAITING_FOR_LIST_ITEM';
  else if (!id) reason = 'FOLDER_LIST_ITEM_ID_UNCONFIRMED';
  else if (!Number.isFinite(objectType)) reason = 'FOLDER_OBJECT_TYPE_UNCONFIRMED';
  else if (objectType !== 1) reason = 'FOLDER_NAME_COLLISION';
  return {
    ready: reason === 'LIST_BACKED_FOLDER_READY',
    exists,
    reason,
    expectedPath: expected,
    actualPath,
    status: numericStatus,
    id,
    fileSystemObjectType: Number.isFinite(objectType) ? objectType : null,
    parentPath: normalizePath(record.FileDirRef),
    ownerListId: listIdFrom(record),
  };
}

function classifyFolderReadiness({
  expectedPath,
  expectedParentPath,
  expectedLibraryId,
  listItem,
  folder,
  parentEntries = [],
  listItemMissing = false,
  folderMissing = false,
} = {}) {
  const expected = normalizePath(expectedPath);
  const expectedParent = normalizePath(expectedParentPath);
  const expectedListId = String(expectedLibraryId || '').replace(/[{}]/g, '').toLowerCase();
  const item = unwrapODataRecord(listItem);
  const folderRecord = unwrapODataRecord(folder);
  const entries = unwrapODataCollection(parentEntries);
  const actualFileRef = normalizePath(item?.FileRef || '');
  const actualFolderRef = normalizePath(item?.Folder?.ServerRelativeUrl || '');
  const folderObjectPath = folderPathFrom(folderRecord);

  if (explicitExists(folderRecord) === false) {
    return { ready: false, exists: false, contradiction: Boolean(item), reason: 'FOLDER_NOT_FOUND', expectedPath: expected };
  }
  if (!item) {
    if (folderMissing && listItemMissing) {
      return { ready: false, exists: false, reason: 'FOLDER_NOT_FOUND', expectedPath: expected };
    }
    return {
      ready: false,
      exists: Boolean(folderRecord) && !folderMissing,
      unknown: !folderRecord && !folderMissing,
      reason: folderRecord ? 'FOLDER_OBJECT_VISIBLE_WAITING_FOR_LIST_ITEM' : 'FOLDER_METADATA_UNRECOGNIZED',
      expectedPath: expected,
    };
  }

  const id = positiveInteger(item.Id);
  if (!id) return { ready: false, exists: true, reason: 'FOLDER_LIST_ITEM_ID_UNCONFIRMED', expectedPath: expected };
  const itemObjectType = Number(item.FileSystemObjectType);
  if (!Number.isFinite(itemObjectType)) {
    return { ready: false, exists: true, reason: 'FOLDER_OBJECT_TYPE_UNCONFIRMED', expectedPath: expected, listItemId: id };
  }
  if (itemObjectType !== 1) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_NAME_COLLISION', expectedPath: expected, listItemId: id };
  }
  if (!actualFileRef) return { ready: false, exists: true, reason: 'FOLDER_FILE_REF_MISSING', expectedPath: expected, listItemId: id };
  if (!samePath(actualFileRef, expected)) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_PATH_MISMATCH', expectedPath: expected, actualPath: actualFileRef, listItemId: id };
  }
  if (!actualFolderRef) return { ready: false, exists: true, reason: 'FOLDER_FOLDER_REF_MISSING', expectedPath: expected, listItemId: id };
  if (!samePath(actualFolderRef, expected)) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_PATH_MISMATCH', expectedPath: expected, actualPath: actualFolderRef, listItemId: id };
  }

  const actualListId = listIdFrom(item);
  if (!actualListId) return { ready: false, exists: true, reason: 'FOLDER_LIBRARY_ID_MISSING', expectedPath: expected, listItemId: id };
  if (expectedListId && actualListId !== expectedListId) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_OWNER_LIBRARY_MISMATCH', expectedPath: expected, expectedLibraryId: expectedListId, actualLibraryId: actualListId, listItemId: id };
  }

  if (!folderRecord || explicitExists(folderRecord) !== true) {
    return { ready: false, exists: true, reason: 'FOLDER_OBJECT_NOT_CONFIRMED', expectedPath: expected, listItemId: id };
  }
  if (!folderObjectPath || !samePath(folderObjectPath, expected)) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_PATH_MISMATCH', expectedPath: expected, actualPath: folderObjectPath, listItemId: id };
  }

  const matchingEntries = entries.filter((entry) => samePath(folderPathFrom(entry), expected));
  if (!matchingEntries.length) {
    return { ready: false, exists: true, reason: 'FOLDER_PARENT_ENUMERATION_MISMATCH', expectedPath: expected, expectedParentPath: expectedParent, listItemId: id };
  }
  if (matchingEntries.length !== 1) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_PARENT_ENUMERATION_MISMATCH', expectedPath: expected, listItemId: id };
  }
  const parentEntry = matchingEntries[0];
  if (explicitExists(parentEntry) === false) {
    return { ready: false, exists: false, contradiction: true, reason: 'FOLDER_PARENT_ENUMERATION_MISMATCH', expectedPath: expected, listItemId: id };
  }
  const entryItem = unwrapODataRecord(parentEntry.ListItemAllFields);
  if (!entryItem || positiveInteger(entryItem.Id) !== id) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_PARENT_ENUMERATION_MISMATCH', expectedPath: expected, listItemId: id };
  }
  if (Number(entryItem.FileSystemObjectType) !== 1) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_PARENT_ENUMERATION_MISMATCH', expectedPath: expected, listItemId: id };
  }
  if (!samePath(entryItem.FileRef, expected)) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_PARENT_ENUMERATION_MISMATCH', expectedPath: expected, actualPath: normalizePath(entryItem.FileRef), listItemId: id };
  }
  const parentListId = listIdFrom(entryItem);
  if (!parentListId || (expectedListId && parentListId !== expectedListId)) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_OWNER_LIBRARY_MISMATCH', expectedPath: expected, expectedLibraryId: expectedListId, actualLibraryId: parentListId, listItemId: id };
  }

  const actualParent = expected.slice(0, expected.lastIndexOf('/'));
  if (!samePath(actualParent, expectedParent)) {
    return { ready: false, exists: true, contradiction: true, reason: 'FOLDER_PARENT_MISMATCH', expectedPath: expected, expectedParentPath: expectedParent, actualParentPath: actualParent, listItemId: id };
  }
  return {
    ready: true,
    exists: true,
    reason: 'LIST_BACKED_FOLDER_READY',
    expectedPath: expected,
    actualPath: actualFileRef,
    parentPath: expectedParent,
    libraryId: actualListId,
    listItemId: id,
  };
}

/**
 * @param {object} options
 * @param {string} options.webUrl        absolute SharePoint web URL, no trailing slash
 * @param {Function} options.fetchImpl
 * @param {Function} [options.getDigest] async () => FormDigest string
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.onRequest] structured request logger
 * @param {Function} [options.nowToken]  cache-bust token generator
 */
function createSharePointClient(options = {}) {
  const {
    webUrl,
    fetchImpl,
    getDigest,
    signal,
    onRequest,
    nowToken = () => `${Date.now()}`,
  } = options;

  if (!webUrl) throw new Error('createSharePointClient requires webUrl.');
  if (typeof fetchImpl !== 'function') throw new Error('createSharePointClient requires fetchImpl.');

  const base = String(webUrl).replace(/\/+$/, '');

  /**
   * Perform one SharePoint request. Never throws on an HTTP error status: the
   * caller decides whether a given status is a failure or an expected answer
   * (a missing file is a normal answer during seed provisioning).
   */
  async function raw(url, init = {}, context = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const requestUrl = method === 'GET' ? cacheBustSuffix(url, nowToken()) : url;
    const headers = { ...(init.headers || {}) };
    if (method !== 'GET' && getDigest) headers['X-RequestDigest'] = await getDigest();

    let response = null;
    let bodyText = '';
    let cause = null;
    try {
      response = await fetchImpl(requestUrl, {
        credentials: 'include',
        cache: 'no-store',
        signal,
        ...init,
        headers,
      });
      if (!response.ok) bodyText = await safeText(response);
    } catch (error) {
      cause = error;
    }

    const status = response ? Number(response.status) : null;
    const result = {
      ok: Boolean(response?.ok),
      status,
      response,
      bodyText,
      url,
      method,
      operation: context.operation || '',
      target: context.target || '',
      normalized: null,
    };
    if (!result.ok) {
      result.normalized = classifySharePointError({
        httpStatus: status,
        body: bodyText,
        operation: context.operation,
        target: context.target,
        url,
        method,
        cause,
      });
    }
    if (onRequest) await onRequest(result);
    return result;
  }

  /** Same as `raw`, but a non-OK response becomes a classified Error. */
  async function required(url, init, context) {
    const result = await raw(url, init, context);
    if (!result.ok) throw sharePointError(result.normalized);
    return result;
  }

  async function getContextInfo() {
    const result = await required(`${base}/_api/contextinfo`, {
      method: 'POST',
      headers: { Accept: ODATA_VERBOSE, 'Content-Type': ODATA_VERBOSE },
    }, { operation: 'contextinfo', target: base });
    const data = await result.response.json();
    const digest = unwrapODataRecord(data)?.GetContextWebInformation?.FormDigestValue;
    if (!digest) {
      throw sharePointError(classifySharePointError({
        httpStatus: result.status,
        body: 'contextinfo returned an empty FormDigestValue',
        operation: 'contextinfo',
        url: `${base}/_api/contextinfo`,
      }));
    }
    return digest;
  }

  /**
   * Read one Document Library by title.
   * @returns {Promise<{found:boolean, library:object|null, normalized:object|null}>}
   */
  async function readLibraryByTitle(title) {
    const url = `${base}/_api/web/lists/GetByTitle('${escapeODataPath(title)}')`
      + '?$select=Id,Title,BaseTemplate,BaseType,OnQuickLaunch,RootFolder/ServerRelativeUrl,RootFolder/WelcomePage&$expand=RootFolder';
    const result = await raw(url, { headers: { Accept: ODATA_VERBOSE } }, { operation: `read-library:${title}`, target: title });
    if (result.ok) {
      const data = await result.response.json();
      return { found: true, library: normalizeLibrary(unwrapODataRecord(data)), normalized: null };
    }
    // MISSING is the normal "library does not exist yet" answer and arrives as
    // 404 or as 400 + FileNotFound on this farm.
    if (result.normalized.errorClass === SP_ERROR.MISSING) {
      return { found: false, library: null, normalized: result.normalized };
    }
    throw sharePointError(result.normalized);
  }

  /** Read every list so a root-folder URL collision can be detected precisely. */
  async function readAllLibraries() {
    const url = `${base}/_api/web/lists`
      + '?$select=Id,Title,BaseTemplate,BaseType,OnQuickLaunch,RootFolder/ServerRelativeUrl&$expand=RootFolder&$top=5000';
    const result = await required(url, { headers: { Accept: ODATA_VERBOSE } }, { operation: 'read-all-lists', target: base });
    const data = await result.response.json();
    const items = data?.d?.results || data?.value || [];
    return items.map(normalizeLibrary).filter(Boolean);
  }

  /**
   * Probe a folder. A generic HTTP 200 is not enough: a real folder must be
   * backed by a list item (FileSystemObjectType === 1) whose path matches
   * exactly, or be a Document Library root with BaseTemplate 101.
   *
   * Mirrors Site Builder's `classifySharePointFolderProbe`.
   */
  async function probeFolder(folderPath, {
    expectLibraryRoot = false,
    libraryTitle = '',
    libraryId = '',
    parentPath = '',
  } = {}) {
    assertServerRelativePath(folderPath, 'folder');

    if (expectLibraryRoot) {
      const title = libraryTitle || folderPath.split('/').filter(Boolean).at(-1);
      const { found, library } = await readLibraryByTitle(title);
      if (!found) return { ready: false, reason: 'FOLDER_NOT_FOUND', exists: false, library: null };
      if (Number(library.baseTemplate) !== 101) {
        return { ready: false, reason: 'LIBRARY_EXISTS_NOT_DOCUMENT_LIBRARY', exists: true, contradiction: true, library };
      }
      if (!library.id) return { ready: false, reason: 'LIBRARY_ROOT_NOT_READY', exists: true, library };
      if (libraryId && normalizeListId(library.id) !== normalizeListId(libraryId)) {
        return { ready: false, reason: 'LIBRARY_ROOT_LIST_ID_MISMATCH', exists: true, contradiction: true, library };
      }
      if (!samePath(library.rootFolder, folderPath)) {
        return { ready: false, reason: 'LIBRARY_ROOT_MISMATCH', exists: true, contradiction: true, library };
      }
      return { ready: true, reason: 'LIBRARY_ROOT_READY', exists: true, library };
    }

    const expectedParent = normalizePath(parentPath || folderPath.slice(0, folderPath.lastIndexOf('/')));
    const itemUrl = `${base}/_api/web/GetFolderByServerRelativeUrl('${escapeODataPath(folderPath)}')/ListItemAllFields`
      + '?$select=Id,FileSystemObjectType,FileRef,Folder/ServerRelativeUrl,ParentList/Id&$expand=Folder,ParentList';
    const folderUrl = `${base}/_api/web/GetFolderByServerRelativeUrl('${escapeODataPath(folderPath)}')`
      + '?$select=Exists,Name,ServerRelativeUrl';
    const parentBaseUrl = `${base}/_api/web/GetFolderByServerRelativeUrl('${escapeODataPath(expectedParent)}')/Folders`;
    const parentUrl = parentBaseUrl
      + '?$select=Exists,Name,ServerRelativeUrl,ListItemAllFields/Id,ListItemAllFields/FileSystemObjectType,ListItemAllFields/FileRef,ListItemAllFields/ParentList/Id'
      + '&$expand=ListItemAllFields,ListItemAllFields/ParentList';
    const parentFallbackUrl = `${parentBaseUrl}?$select=Exists,Name,ServerRelativeUrl`;

    const readProbe = async (url, operation) => {
      const result = await raw(url, { headers: { Accept: ODATA_VERBOSE } }, { operation, target: folderPath });
      if (!result.ok && [SP_ERROR.AUTH_FAILURE, SP_ERROR.PERMISSION_DENIED].includes(result.normalized.errorClass)) {
        return {
          missing: false,
          authorization: true,
          status: result.status,
          errorClass: result.normalized.errorClass,
          payload: null,
        };
      }
      if (!result.ok && result.normalized.errorClass !== SP_ERROR.MISSING) throw sharePointError(result.normalized);
      return {
        missing: !result.ok,
        payload: result.ok ? await result.response.json() : null,
      };
    };

    const itemRead = await readProbe(itemUrl, `probe-folder-list-item:${folderPath}`);
    if (itemRead.authorization) {
      return {
        ready: false,
        exists: false,
        authorization: true,
        reason: 'FOLDER_PROBE_AUTHORIZATION_FAILED',
        status: itemRead.status,
        errorClass: itemRead.errorClass,
      };
    }
    const folderRead = await readProbe(folderUrl, `probe-folder-object:${folderPath}`);
    if (folderRead.authorization) {
      return {
        ready: false,
        exists: false,
        authorization: true,
        reason: 'FOLDER_PROBE_AUTHORIZATION_FAILED',
        status: folderRead.status,
        errorClass: folderRead.errorClass,
      };
    }
    if (itemRead.missing && folderRead.missing) {
      return { ready: false, reason: 'FOLDER_NOT_FOUND', exists: false, expectedPath: normalizePath(folderPath) };
    }
    let parentRead;
    try {
      parentRead = await readProbe(parentUrl, `probe-folder-parent-enumeration:${expectedParent}`);
    } catch (error) {
      const errorClass = error?.sharePoint?.errorClass || error?.errorClass;
      if (error?.httpStatus !== 400 || errorClass !== SP_ERROR.TRANSIENT_NOT_READY) throw error;
      parentRead = await readProbe(parentFallbackUrl, `probe-folder-parent-enumeration-fallback:${expectedParent}`);
      if (!parentRead.missing) {
        const item = unwrapODataRecord(itemRead.payload);
        parentRead.payload = {
          value: unwrapODataCollection(parentRead.payload).map((entry) => (
            samePath(entry?.ServerRelativeUrl, folderPath)
              ? { ...entry, ListItemAllFields: item }
              : entry
          )),
        };
      }
    }
    if (parentRead.authorization) {
      return {
        ready: false,
        exists: false,
        authorization: true,
        reason: 'FOLDER_PROBE_AUTHORIZATION_FAILED',
        status: parentRead.status,
        errorClass: parentRead.errorClass,
      };
    }
    return classifyFolderReadiness({
      expectedPath: folderPath,
      expectedParentPath: expectedParent,
      expectedLibraryId: libraryId,
      listItem: itemRead.payload,
      folder: folderRead.payload,
      parentEntries: parentRead.payload,
      listItemMissing: itemRead.missing,
      folderMissing: folderRead.missing,
    });
  }

  /** Compatibility REST creator; production uses the list-bound JSOM adapter. */
  async function createFolder(folderPath) {
    assertServerRelativePath(folderPath, 'folder');
    const parent = folderPath.slice(0, folderPath.lastIndexOf('/'));
    const leaf = folderPath.slice(folderPath.lastIndexOf('/') + 1);

    const url = `${base}/_api/web/GetFolderByServerRelativeUrl('${escapeODataPath(parent)}')/Folders/add('${escapeODataPath(leaf)}')`;
    const result = await raw(url, { method: 'POST', headers: { Accept: ODATA_VERBOSE } }, {
      operation: `create-folder:${folderPath}`,
      target: folderPath,
    });
    if (result.ok) return { created: true, alreadyExisted: false, normalized: null };
    if (result.normalized.errorClass === SP_ERROR.ALREADY_EXISTS) {
      return { created: false, alreadyExisted: true, normalized: result.normalized };
    }
    if (result.normalized.errorClass === SP_ERROR.PERMISSION_DENIED || result.normalized.errorClass === SP_ERROR.AUTH_FAILURE) {
      throw sharePointError(result.normalized);
    }
    return { created: false, alreadyExisted: false, normalized: result.normalized };
  }

  /**
   * Read a file's bytes.
   * Only the canonical server-relative form is used — the web-relative
   * GetFileByServerRelativeUrl variant is invalid on this farm.
   */
  async function readFile(filePath) {
    assertServerRelativePath(filePath, 'file');
    const url = `${base}/_api/web/GetFileByServerRelativeUrl('${escapeODataPath(filePath)}')/$value`;
    const result = await raw(url, { headers: { Accept: '*/*' } }, { operation: `read-file:${filePath}`, target: filePath });
    if (result.ok) {
      const bytes = new Uint8Array(await result.response.arrayBuffer());
      return { found: true, bytes, status: result.status };
    }
    if (result.normalized.errorClass === SP_ERROR.MISSING) {
      return { found: false, bytes: null, status: result.status, normalized: result.normalized };
    }
    throw sharePointError(result.normalized);
  }

  async function uploadFile(filePath, bytes, contentType = ASSET_CONTENT_TYPE, options = {}) {
    assertServerRelativePath(filePath, 'file');
    const folder = filePath.slice(0, filePath.lastIndexOf('/'));
    const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
    const encodedName = encodeURIComponent(fileName).replace(/'/g, '%27');
    const overwrite = options.overwrite !== false;
    const url = `${base}/_api/web/GetFolderByServerRelativeUrl('${escapeODataPath(folder)}')`
      + `/Files/Add(overwrite=${overwrite ? 'true' : 'false'},url='${encodedName}')`;
    const result = await raw(url, {
      method: 'POST',
      headers: { Accept: ODATA_VERBOSE, 'Content-Type': contentType },
      body: bytes,
    }, { operation: `upload-file:${filePath}`, target: filePath });
    if (!result.ok) throw sharePointError(result.normalized);
    return { uploaded: true };
  }

  return {
    webUrl: base,
    raw,
    required,
    getContextInfo,
    readLibraryByTitle,
    readAllLibraries,
    probeFolder,
    createFolder,
    readFile,
    uploadFile,
  };
}

function normalizeLibrary(record) {
  if (!record) return null;
  const rootFolder = record.RootFolder?.ServerRelativeUrl || record.RootFolder?.serverRelativeUrl || '';
  return {
    id: String(record.Id || record.id || ''),
    title: String(record.Title ?? record.title ?? ''),
    baseTemplate: Number(record.BaseTemplate ?? record.baseTemplate ?? NaN),
    baseType: record.BaseType ?? record.baseType ?? null,
    onQuickLaunch: record.OnQuickLaunch === true,
    rootFolder: normalizePath(rootFolder),
    welcomePage: String(record.RootFolder?.WelcomePage ?? ''),
  };
}

function normalizePath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try { path = new URL(raw).pathname; } catch { return ''; }
  }
  try { path = decodeURIComponent(path); } catch { /* Preserve already-decoded percent characters. */ }
  const normalized = `/${path.replace(/^\/+|\/+$/g, '')}`.replace(/\/{2,}/g, '/');
  return normalized === '/' ? '' : normalized.normalize('NFC');
}

function samePath(left, right) {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

const normalizeListId = (value) => String(value || '').replace(/[{}]/g, '').toLowerCase();

async function safeText(response) {
  try { return (await response.text()).slice(0, 1500); } catch { return ''; }
}

module.exports = {
  escapeODataPath: escapeODataPath,
  assertServerRelativePath: assertServerRelativePath,
  createSharePointClient: createSharePointClient,
  normalizePath: normalizePath,
  samePath: samePath,
  unwrapODataRecord: unwrapODataRecord,
  unwrapODataCollection: unwrapODataCollection,
  classifyFolderReadiness: classifyFolderReadiness,
  classifyFolderProbe: classifyFolderProbe,
  ODATA_VERBOSE: ODATA_VERBOSE,
  SEED_CONTENT_TYPE: SEED_CONTENT_TYPE,
  ASSET_CONTENT_TYPE: ASSET_CONTENT_TYPE,
};
