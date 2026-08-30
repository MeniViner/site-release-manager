/**
 * A simulated SharePoint farm that reproduces the real closed-environment
 * behaviour observed on Windows: a mutation succeeds, and the immediately
 * following read fails with HTTP 400 + FileNotFound / DirectoryNotFound before
 * the object becomes visible.
 *
 * It implements the fetch contract, so tests drive the production client and
 * provisioning code unchanged.
 */

import crypto from 'node:crypto';

const ODATA = 'application/json;odata=verbose';

export function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

const jsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? ODATA : null) },
  json: async () => payload,
  text: async () => JSON.stringify(payload),
  clone() { return this; },
  arrayBuffer: async () => Buffer.from(JSON.stringify(payload)),
});

const bytesResponse = (status, bytes) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/octet-stream' },
  json: async () => { throw new Error('not json'); },
  text: async () => Buffer.from(bytes).toString('utf8'),
  clone() { return this; },
  arrayBuffer: async () => Buffer.from(bytes),
});

/** The farm's "not there yet" answer: HTTP 400 carrying a FileNotFound payload. */
export const notFoundPayload = (type = 'System.IO.FileNotFoundException', code = '-2147024894') => ({
  error: { code: `${code}, ${type}`, message: { lang: 'en-US', value: 'File Not Found.' } },
});

export const directoryNotFoundPayload = () => ({
  error: { code: '-2147024893, System.IO.DirectoryNotFoundException', message: { lang: 'en-US', value: 'Could not find a part of the path.' } },
});

export const alreadyExistsPayload = () => ({
  error: { code: '-2130575342, Microsoft.SharePoint.SPException', message: { lang: 'en-US', value: 'A list, survey, discussion board, or document library with the specified title already exists in this Web site.' } },
});

const decodeODataArg = (value) => String(value)
  .replace(/%25/g, '%')
  .replace(/%23/g, '#')
  .replace(/%3F/gi, '?')
  .replace(/''/g, "'");

const stripQuery = (url) => url.split('?')[0];

export function createFakeSharePoint(config = {}) {
  const {
    webUrl = 'https://portal.army.idf/sites/schedule',
    /** How many reads of a freshly created object answer "not ready" first. */
    notReadyReads = 0,
    /** Which not-ready shape to use: 'file' | 'directory' | 'spexception' | '404'. */
    notReadyShape = 'file',
    /** Force library creation to report an error even though it commits. */
    libraryCreateReportsError = false,
    /** SharePoint auto-suffixes the created root folder URL. */
    autoSuffixLibraryUrl = false,
  } = config;

  const state = {
    lists: new Map(),   // title -> { id, title, baseTemplate, rootFolder }
    folders: new Map(), // path  -> { listItemId }
    files: new Map(),   // path  -> { bytes, contentType }
    pending: new Map(), // path  -> remaining not-ready reads
    requests: [],
    uploadSequence: [],
  };

  const base = webUrl.replace(/\/+$/, '');

  function markPending(key) {
    if (notReadyReads > 0) state.pending.set(key, notReadyReads);
  }

  /** Returns true when this read must answer "not ready yet". */
  function consumePending(key) {
    const remaining = state.pending.get(key);
    if (!remaining) return false;
    if (remaining <= 1) state.pending.delete(key);
    else state.pending.set(key, remaining - 1);
    return true;
  }

  function notReadyResponse() {
    if (notReadyShape === '404') return jsonResponse(404, notFoundPayload());
    if (notReadyShape === 'directory') return jsonResponse(400, directoryNotFoundPayload());
    if (notReadyShape === 'spexception') {
      return jsonResponse(400, { error: { code: '-1, Microsoft.SharePoint.SPException', message: { value: 'The farm is busy.' } } });
    }
    return jsonResponse(400, notFoundPayload());
  }

  /** Seed pre-existing state (an already-provisioned site). */
  function addLibrary(title, rootFolder, { baseTemplate = 101, id = `list-${state.lists.size + 1}` } = {}) {
    state.lists.set(title, { id, title, baseTemplate, rootFolder });
    state.folders.set(rootFolder, { listItemId: 0, isLibraryRoot: true });
    return state.lists.get(title);
  }

  function addFolder(path) {
    state.folders.set(path, { listItemId: state.folders.size + 100 });
  }

  function addFile(path, content) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    state.files.set(path, { bytes, contentType: 'text/plain' });
  }

  async function fetchImpl(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const clean = stripQuery(url);
    state.requests.push({ url: clean, method, contentType: init.headers?.['Content-Type'] || '' });

    if (clean === `${base}/_api/contextinfo` && method === 'POST') {
      return jsonResponse(200, { d: { GetContextWebInformation: { FormDigestValue: 'DIGEST,1' } } });
    }

    // --- lists ------------------------------------------------------------
    const byTitle = clean.match(/\/_api\/web\/lists\/GetByTitle\('(.+?)'\)$/);
    if (byTitle && method === 'GET') {
      const title = decodeODataArg(byTitle[1]);
      const list = state.lists.get(title);
      if (!list) return notReadyShape === '404' ? jsonResponse(404, notFoundPayload()) : jsonResponse(400, notFoundPayload());
      if (consumePending(`list:${title}`)) return notReadyResponse();
      return jsonResponse(200, {
        d: {
          Id: list.id, Title: list.title, BaseTemplate: list.baseTemplate, BaseType: 1, OnQuickLaunch: true,
          RootFolder: { ServerRelativeUrl: list.rootFolder, WelcomePage: 'Forms/AllItems.aspx' },
        },
      });
    }

    if (clean === `${base}/_api/web/lists` && method === 'GET') {
      return jsonResponse(200, {
        d: {
          results: [...state.lists.values()].map((list) => ({
            Id: list.id, Title: list.title, BaseTemplate: list.baseTemplate, BaseType: 1, OnQuickLaunch: true,
            RootFolder: { ServerRelativeUrl: list.rootFolder },
          })),
        },
      });
    }

    // --- folder probe -----------------------------------------------------
    const probe = clean.match(/\/_api\/web\/GetFolderByServerRelativeUrl\('(.+?)'\)\/ListItemAllFields$/);
    if (probe && method === 'GET') {
      const folderPath = decodeODataArg(probe[1]);
      const folder = state.folders.get(folderPath);
      if (!folder) return notReadyResponse();
      if (consumePending(`folder:${folderPath}`)) return notReadyResponse();
      return jsonResponse(200, {
        d: { Id: folder.listItemId || 1, FileSystemObjectType: 1, FileRef: folderPath, Folder: { ServerRelativeUrl: folderPath } },
      });
    }

    // --- folder create ----------------------------------------------------
    const addChild = clean.match(/\/_api\/web\/GetFolderByServerRelativeUrl\('(.+?)'\)\/Folders\/add\('(.+?)'\)$/);
    if (addChild && method === 'POST') {
      const parent = decodeODataArg(addChild[1]);
      const leaf = decodeODataArg(addChild[2]);
      const full = `${parent}/${leaf}`;
      if (!state.folders.has(parent)) return jsonResponse(400, directoryNotFoundPayload());
      if (state.folders.has(full)) return jsonResponse(400, alreadyExistsPayload());
      addFolder(full);
      markPending(`folder:${full}`);
      return jsonResponse(200, { d: { ServerRelativeUrl: full } });
    }

    if (clean === `${base}/_api/web/folders` && method === 'POST') {
      const body = JSON.parse(init.body);
      const full = body.ServerRelativeUrl;
      const parent = full.slice(0, full.lastIndexOf('/'));
      if (!state.folders.has(parent)) return jsonResponse(400, directoryNotFoundPayload());
      if (state.folders.has(full)) return jsonResponse(400, alreadyExistsPayload());
      addFolder(full);
      markPending(`folder:${full}`);
      return jsonResponse(200, { d: { ServerRelativeUrl: full } });
    }

    // --- file read --------------------------------------------------------
    const readFile = clean.match(/\/_api\/web\/GetFileByServerRelativeUrl\('(.+?)'\)\/\$value$/);
    if (readFile && method === 'GET') {
      const filePath = decodeODataArg(readFile[1]);
      const file = state.files.get(filePath);
      if (!file) return notReadyShape === '404' ? jsonResponse(404, notFoundPayload()) : jsonResponse(400, notFoundPayload());
      if (consumePending(`file:${filePath}`)) return notReadyResponse();
      return bytesResponse(200, file.bytes);
    }

    // --- file upload ------------------------------------------------------
    const upload = clean.match(/\/_api\/web\/GetFolderByServerRelativeUrl\('(.+?)'\)\/Files\/Add\(overwrite=true,url='(.+?)'\)$/);
    if (upload && method === 'POST') {
      const folderPath = decodeODataArg(upload[1]);
      const fileName = decodeURIComponent(upload[2].replace(/%27/g, "'"));
      if (!state.folders.has(folderPath)) return jsonResponse(400, directoryNotFoundPayload());
      const full = `${folderPath}/${fileName}`;
      const bytes = init.body instanceof Uint8Array ? init.body : new Uint8Array(Buffer.from(init.body));
      state.files.set(full, { bytes, contentType: init.headers?.['Content-Type'] || '' });
      state.uploadSequence.push(full);
      markPending(`file:${full}`);
      return jsonResponse(200, { d: { ServerRelativeUrl: full } });
    }

    return jsonResponse(404, notFoundPayload());
  }

  /**
   * The injected JSOM exact-library creator. Mirrors Site Builder's
   * SP.ListCreationInformation path, including the failure modes this project
   * must detect: an error-but-committed create, and SharePoint auto-suffixing.
   */
  async function createLibraryExact({ title, urlSegment, expectedRoot }) {
    if (state.lists.has(title)) throw Object.assign(new Error('list already exists'), { httpStatus: 400 });
    const parent = expectedRoot.slice(0, expectedRoot.lastIndexOf('/'));
    const actualSegment = autoSuffixLibraryUrl ? `${urlSegment}1` : urlSegment;
    const rootFolder = `${parent}/${actualSegment}`;
    addLibrary(title, rootFolder);
    markPending(`list:${title}`);
    if (libraryCreateReportsError) {
      throw Object.assign(new Error('JSOM executeQueryAsync reported a failure'), { httpStatus: 500 });
    }
    return { title, rootFolder };
  }

  return { webUrl: base, state, fetchImpl, createLibraryExact, addLibrary, addFolder, addFile, sha256Hex };
}

/** Fast, deterministic substitutes so tests never spend real wall-clock time. */
export const instantRetry = {
  sleep: async () => {},
  now: (() => { let t = 0; return () => { t += 10; return t; }; })(),
  random: () => 0.5,
};
