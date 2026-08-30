/**
 * Canonical Site Builder target identity, mirrored from Site Builder's
 * `src/config/sharepointRuntimeDescriptor.js`.
 *
 * Site Builder validates every derived path it receives and throws when a value
 * disagrees with what it would have derived itself. Release Manager therefore
 * derives here in exactly the same way instead of storing competing values.
 *
 * server/test/siteBuilderContract.test.js feeds this module's output straight
 * into the real Site Builder descriptor to prove there is no drift.
 */

export const RUNTIME_DEFAULTS = Object.freeze({
  siteDbFolder: 'siteDB',
  usersDbFolder: 'siteUsersDb',
  siteAssetsFolder: 'siteAssets',
  imagesFolder: 'images',
  widgetsDbTarget: 'users',
  bootstrapLibrary: 'SiteAssets',
  bootstrapFolder: 'sitebuilder-bootstrap',
  storageBackend: 'txt',
});

/**
 * Site Builder's FILE_NAMES registry. `target: 'site'` resolves under
 * siteAssetsRoot; `target: 'widgets'` follows the site's widgetsDbTarget.
 */
export const TXT_DATA_FILES = Object.freeze([
  { key: 'masterConfig', fileName: 'bihs_master_config_v1.txt', target: 'site' },
  { key: 'users', fileName: 'users_data.txt', target: 'site' },
  { key: 'events', fileName: 'events_data.txt', target: 'site' },
  { key: 'navigation', fileName: 'nav_data.txt', target: 'site' },
  { key: 'siteContent', fileName: 'site_content_data.txt', target: 'site' },
  { key: 'theme', fileName: 'theme_data.txt', target: 'site' },
  { key: 'externalLinks', fileName: 'external_links_data.txt', target: 'site' },
  { key: 'gantt', fileName: 'gantt_data.txt', target: 'site' },
  { key: 'boom', fileName: 'boom_data.txt', target: 'site' },
  { key: 'widgets', fileName: 'widgets_data.txt', target: 'widgets' },
]);

const text = (value) => String(value ?? '').trim();

export class SiteIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SiteIdentityError';
    this.statusCode = 400;
  }
}

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const SITE_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,49}$/;
const HOST_PATTERN = /^[a-z0-9][a-z0-9.-]{1,120}$/;

export function normalizeSegment(value, fallback, label) {
  const raw = text(value) || text(fallback);
  if (!SEGMENT_PATTERN.test(raw)) {
    throw new SiteIdentityError(`${label} must be a single SharePoint folder name (got "${text(value) || '(empty)'}").`);
  }
  if (raw === '.' || raw === '..') throw new SiteIdentityError(`${label} cannot be a traversal segment.`);
  return raw;
}

/**
 * Build the complete derived identity for one logical Site Builder target.
 *
 * Two logical targets inside the same SharePoint Web share `siteCode` but have
 * different siteDbFolder/usersDbFolder, and therefore different everything
 * downstream. Nothing here reads global or previous-run state.
 */
export function buildSiteIdentity(site = {}) {
  const host = text(site.host).toLowerCase();
  if (!HOST_PATTERN.test(host)) throw new SiteIdentityError(`Invalid SharePoint host "${text(site.host) || '(empty)'}".`);
  const siteCode = text(site.siteCode).toLowerCase();
  if (!SITE_CODE_PATTERN.test(siteCode)) throw new SiteIdentityError(`Invalid siteCode "${text(site.siteCode) || '(empty)'}".`);

  const siteDbFolder = normalizeSegment(site.siteDbFolder, RUNTIME_DEFAULTS.siteDbFolder, 'siteDbFolder');
  const usersDbFolder = normalizeSegment(site.usersDbFolder, RUNTIME_DEFAULTS.usersDbFolder, 'usersDbFolder');
  const siteAssetsFolder = normalizeSegment(site.siteAssetsFolder, RUNTIME_DEFAULTS.siteAssetsFolder, 'siteAssetsFolder');
  const imagesFolder = normalizeSegment(site.imagesFolder, RUNTIME_DEFAULTS.imagesFolder, 'imagesFolder');
  const bootstrapLibrary = normalizeSegment(site.bootstrapLibrary, RUNTIME_DEFAULTS.bootstrapLibrary, 'bootstrapLibrary');
  const bootstrapFolder = normalizeSegment(site.bootstrapFolder, RUNTIME_DEFAULTS.bootstrapFolder, 'bootstrapFolder');
  const widgetsDbTarget = text(site.widgetsDbTarget || RUNTIME_DEFAULTS.widgetsDbTarget).toLowerCase() === 'site' ? 'site' : 'users';
  const storageBackend = text(site.storageBackend || RUNTIME_DEFAULTS.storageBackend).toLowerCase() === 'mongo' ? 'mongo' : 'txt';

  if (siteDbFolder.toLowerCase() === usersDbFolder.toLowerCase()) {
    throw new SiteIdentityError('siteDbFolder and usersDbFolder must be two different Document Libraries.');
  }

  const siteRoot = `/sites/${siteCode}`;
  const siteDbRoot = `${siteRoot}/${siteDbFolder}`;
  const usersDbRoot = `${siteRoot}/${usersDbFolder}`;
  const siteAssetsRoot = `${siteDbRoot}/${siteAssetsFolder}`;
  const imagesRoot = `${siteDbRoot}/${imagesFolder}`;
  const targetDistPath = `${siteDbRoot}/dist`;
  const sharePointSiteUrl = `https://${host}${siteRoot}`;

  return Object.freeze({
    host,
    siteCode,
    siteId: text(site.siteId) || siteCode,
    siteRoot,
    siteApiRoot: siteRoot,
    siteDbFolder,
    siteDbRoot,
    usersDbFolder,
    usersDbRoot,
    siteAssetsFolder,
    siteAssetsRoot,
    imagesFolder,
    imagesRoot,
    imageBaseFolderServerRelativeUrl: imagesRoot,
    widgetsDbTarget,
    bootstrapLibrary,
    bootstrapFolder,
    storageBackend,
    sharePointSiteUrl,
    allowedSiteRoot: sharePointSiteUrl,
    targetDistPath,
    finalAppUrl: `https://${host}${targetDistPath}/index.html`,
    siteBaseUrl: `https://${host}${targetDistPath}`,
  });
}

/**
 * Stable canonical key for one logical target. Deployment locks key on this,
 * not on a Mongo _id, so two Site records pointing at the same physical target
 * cannot deploy concurrently.
 */
export function canonicalTargetKey(identity) {
  return [identity.host, identity.siteCode, identity.siteDbFolder, identity.usersDbFolder]
    .map((part) => String(part).toLowerCase())
    .join('|');
}

/** Server-relative path of one TXT data file for this identity. */
export function txtFilePath(identity, definition) {
  const root = definition.target === 'widgets'
    ? (identity.widgetsDbTarget === 'site' ? identity.siteAssetsRoot : identity.usersDbRoot)
    : identity.siteAssetsRoot;
  return `${root}/${definition.fileName}`;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Default content for a MISSING TXT file. Existing non-empty files are never
 * touched — these bodies only ever create a file that does not exist yet.
 */
export const TXT_SEED_CONTENT = Object.freeze({
  masterConfig: () => json({ schemaVersion: '1.0.0' }),
  users: () => json([]),
  events: () => json({ displayCount: 3, displayMode: 'default', events: [] }),
  navigation: () => json([]),
  siteContent: () => json({}),
  theme: () => json({}),
  externalLinks: () => json([]),
  boom: () => json({}),
  widgets: () => json({}),
  gantt: () => json({
    enabled: false,
    buttonLabel: 'גאנט עבודה',
    pageTitle: 'גאנט עבודה',
    description: '',
    groupBy: 'category',
    defaultView: 'month',
    showLegend: true,
    showToday: true,
    categories: [],
    items: [],
  }),
});

/** Full TXT seed plan for one logical target. */
export function buildTxtSeedPlan(identity) {
  return TXT_DATA_FILES.map((definition) => ({
    key: definition.key,
    fileName: definition.fileName,
    path: txtFilePath(identity, definition),
    content: (TXT_SEED_CONTENT[definition.key] || (() => json({})))(),
  }));
}

/**
 * Document Libraries that must exist for this target, with the exact physical
 * root folder URL SharePoint has to end up with. Auto-suffixing is a failure,
 * not an acceptable outcome.
 */
export function requiredLibraries(identity) {
  return [
    { title: identity.siteDbFolder, urlSegment: identity.siteDbFolder, rootFolder: identity.siteDbRoot, role: 'siteDb' },
    { title: identity.usersDbFolder, urlSegment: identity.usersDbFolder, rootFolder: identity.usersDbRoot, role: 'usersDb' },
  ];
}

/** Folders that must exist inside those libraries, parent-first. */
export function requiredFolders(identity, extraDistFolders = []) {
  const base = [
    identity.siteAssetsRoot,
    identity.imagesRoot,
    identity.targetDistPath,
  ];
  const extras = [...new Set(extraDistFolders.filter(Boolean))]
    .sort()
    .map((relative) => `${identity.targetDistPath}/${relative}`);
  return [...base, ...extras];
}
