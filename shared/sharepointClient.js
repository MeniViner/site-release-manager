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

import { classifySharePointError, sharePointError, SP_ERROR } from './sharepointErrors.js';

export const ODATA_VERBOSE = 'application/json;odata=verbose';
export const SEED_CONTENT_TYPE = 'text/plain; charset=utf-8';
export const ASSET_CONTENT_TYPE = 'application/octet-stream';

/**
 * OData path escaping, mirrored from Site Builder's `escOData`.
 * A single quote doubles; the characters SharePoint refuses to route are encoded.
 */
export function escapeODataPath(value) {
  return String(value ?? '')
    .replace(/'/g, "''")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
}

/** SharePoint rejects some characters outright rather than reporting "not found". */
const ILLEGAL_PATH_CHARS = /["*:<>|]/;

export function assertServerRelativePath(value, label = 'path') {
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

/**
 * @param {object} options
 * @param {string} options.webUrl        absolute SharePoint web URL, no trailing slash
 * @param {Function} options.fetchImpl
 * @param {Function} [options.getDigest] async () => FormDigest string
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.onRequest] structured request logger
 * @param {Function} [options.nowToken]  cache-bust token generator
 */
export function createSharePointClient(options = {}) {
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
    const digest = data?.d?.GetContextWebInformation?.FormDigestValue;
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
      return { found: true, library: normalizeLibrary(data?.d), normalized: null };
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
  async function probeFolder(folderPath, { expectLibraryRoot = false, libraryTitle = '' } = {}) {
    assertServerRelativePath(folderPath, 'folder');

    if (expectLibraryRoot) {
      const title = libraryTitle || folderPath.split('/').filter(Boolean).at(-1);
      const { found, library } = await readLibraryByTitle(title);
      if (!found) return { ready: false, reason: 'FOLDER_NOT_FOUND', exists: false, library: null };
      if (Number(library.baseTemplate) !== 101) {
        return { ready: false, reason: 'LIBRARY_EXISTS_NOT_DOCUMENT_LIBRARY', exists: true, library };
      }
      if (!library.id) return { ready: false, reason: 'LIBRARY_ROOT_NOT_READY', exists: true, library };
      if (normalizePath(library.rootFolder) !== normalizePath(folderPath)) {
        return { ready: false, reason: 'LIBRARY_ROOT_MISMATCH', exists: true, library };
      }
      return { ready: true, reason: 'LIBRARY_ROOT_READY', exists: true, library };
    }

    const url = `${base}/_api/web/GetFolderByServerRelativeUrl('${escapeODataPath(folderPath)}')/ListItemAllFields`
      + '?$select=Id,FileSystemObjectType,FileRef,Folder/ServerRelativeUrl&$expand=Folder';
    const result = await raw(url, { headers: { Accept: ODATA_VERBOSE } }, { operation: `probe-folder:${folderPath}`, target: folderPath });

    if (!result.ok) {
      if (result.normalized.errorClass === SP_ERROR.MISSING) {
        return { ready: false, reason: 'FOLDER_NOT_FOUND', exists: false };
      }
      throw sharePointError(result.normalized);
    }

    const data = await result.response.json();
    const item = data?.d ?? data ?? {};
    const id = Number(item.Id);
    const fsType = Number(item.FileSystemObjectType);
    const fileRef = normalizePath(item.FileRef || item.Folder?.ServerRelativeUrl || '');

    if (!Number.isInteger(id) || id <= 0) {
      // The folder object is visible but SharePoint has not committed its list
      // item yet. This is precisely the window that used to need a page refresh.
      return { ready: false, reason: 'FOLDER_OBJECT_VISIBLE_WAITING_FOR_LIST_ITEM', exists: true };
    }
    if (fsType !== 1) return { ready: false, reason: 'FOLDER_METADATA_UNRECOGNIZED', exists: true };
    if (fileRef && fileRef !== normalizePath(folderPath)) {
      return { ready: false, reason: 'LIST_BACKED_FOLDER_NOT_READY', exists: true };
    }
    return { ready: true, reason: 'LIST_BACKED_FOLDER_READY', exists: true, listItemId: id };
  }

  /**
   * Create a folder. Two request shapes are tried because this farm accepts one
   * or the other depending on where the parent lives.
   */
  async function createFolder(folderPath) {
    assertServerRelativePath(folderPath, 'folder');
    const parent = folderPath.slice(0, folderPath.lastIndexOf('/'));
    const leaf = folderPath.slice(folderPath.lastIndexOf('/') + 1);

    const candidates = [
      {
        url: `${base}/_api/web/GetFolderByServerRelativeUrl('${escapeODataPath(parent)}')/Folders/add('${escapeODataPath(leaf)}')`,
        init: { method: 'POST', headers: { Accept: ODATA_VERBOSE } },
      },
      {
        url: `${base}/_api/web/folders`,
        init: {
          method: 'POST',
          headers: { Accept: ODATA_VERBOSE, 'Content-Type': ODATA_VERBOSE },
          body: JSON.stringify({ __metadata: { type: 'SP.Folder' }, ServerRelativeUrl: folderPath }),
        },
      },
    ];

    let lastNormalized = null;
    for (const candidate of candidates) {
      const result = await raw(candidate.url, candidate.init, { operation: `create-folder:${folderPath}`, target: folderPath });
      if (result.ok) return { created: true, alreadyExisted: false, normalized: null };
      lastNormalized = result.normalized;
      // "Already exists" is success: another attempt in this same run, or a
      // previous run, already created it. Never delete and recreate.
      if (result.normalized.errorClass === SP_ERROR.ALREADY_EXISTS) {
        return { created: false, alreadyExisted: true, normalized: result.normalized };
      }
      if (result.normalized.errorClass === SP_ERROR.PERMISSION_DENIED || result.normalized.errorClass === SP_ERROR.AUTH_FAILURE) {
        throw sharePointError(result.normalized);
      }
    }
    return { created: false, alreadyExisted: false, normalized: lastNormalized };
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

export function normalizePath(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

async function safeText(response) {
  try { return (await response.text()).slice(0, 1500); } catch { return ''; }
}
