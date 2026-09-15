const FOLDER_KINDS = new Set(['folder', 'directory', 'category', 'container']);
const LINK_KINDS = new Set(['link', 'url', 'network-folder', 'network-link']);
const RESERVED_BROWSER_TARGETS = new Set(['_blank', '_self', '_parent', '_top']);

export const NAVIGATION_TARGET_MODES = Object.freeze({
    MANUAL: 'manual',
    SHAREPOINT_AUTO: 'sharepoint-auto',
});

export const NAVIGATION_TARGET_KINDS = Object.freeze({
    URL: 'url',
    LIBRARY: 'library',
    FOLDER: 'folder',
});

/**
 * Site Builder navigation is capped at exactly three levels:
 * 1 = category (SharePoint document library), 2 = subcategory (folder),
 * 3 = leaf item (manual link or nested folder). There is no level 4.
 */
export const NAVIGATION_MAX_LEVEL = 3;

/** Folder depth below the owning library root: 0 = library root, 1 = level 2, 2 = level 3. */
export const NAVIGATION_MAX_FOLDER_DEPTH = NAVIGATION_MAX_LEVEL - 1;

const KNOWN_TARGET_BINDING_KEYS = Object.freeze([
    'version',
    'mode',
    'targetKind',
    'state',
    'serverRelativeUrl',
    'listId',
    'libraryTitle',
    'libraryRootServerRelativeUrl',
    'parentServerRelativeUrl',
    'physicalName',
    'provisionKey',
]);

const KNOWN_TARGET_BINDING_KEY_SET = new Set(KNOWN_TARGET_BINDING_KEYS);

function asTrimmedText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeServerRelativeUrl(value) {
    const raw = asTrimmedText(value);
    if (!raw) return '';
    let path = raw;
    if (/^https?:\/\//i.test(raw)) {
        try {
            path = new URL(raw).pathname;
        } catch {
            return '';
        }
    }
    const normalized = `/${path.replace(/^\/+|\/+$/g, '')}`.replace(/\/{2,}/g, '/');
    if (normalized.split('/').some((segment) => segment === '.' || segment === '..')) return '';
    return normalized === '/' ? '' : normalized;
}

function parentServerRelativePath(value) {
    const normalized = normalizeServerRelativeUrl(value);
    const slash = normalized.lastIndexOf('/');
    return slash > 0 ? normalized.slice(0, slash) : '';
}

function leafServerRelativeSegment(value) {
    return normalizeServerRelativeUrl(value).split('/').filter(Boolean).pop() || '';
}

function pickUnknownBindingMetadata(bindingLike) {
    const extra = {};
    Object.entries(bindingLike).forEach(([key, value]) => {
        if (KNOWN_TARGET_BINDING_KEY_SET.has(key)) return;
        const type = typeof value;
        if (type === 'string' || type === 'number' || type === 'boolean') extra[key] = value;
    });
    return extra;
}

export function normalizeNavigationTargetBinding(bindingLike) {
    if (!bindingLike || typeof bindingLike !== 'object' || Array.isArray(bindingLike)) return undefined;

    // Metadata the normalizer does not recognise is carried through untouched so
    // future/extra binding fields survive save/reload, backup and restore.
    const passthrough = pickUnknownBindingMetadata(bindingLike);

    if (bindingLike.mode === NAVIGATION_TARGET_MODES.MANUAL) {
        return {
            ...passthrough,
            version: 1,
            mode: NAVIGATION_TARGET_MODES.MANUAL,
            targetKind: NAVIGATION_TARGET_KINDS.URL,
            state: 'manual',
        };
    }

    if (bindingLike.mode !== NAVIGATION_TARGET_MODES.SHAREPOINT_AUTO) return undefined;
    const targetKind = bindingLike.targetKind === NAVIGATION_TARGET_KINDS.FOLDER
        ? NAVIGATION_TARGET_KINDS.FOLDER
        : NAVIGATION_TARGET_KINDS.LIBRARY;
    const serverRelativeUrl = normalizeServerRelativeUrl(bindingLike.serverRelativeUrl);
    const libraryRootServerRelativeUrl = normalizeServerRelativeUrl(
        bindingLike.libraryRootServerRelativeUrl
            || (targetKind === NAVIGATION_TARGET_KINDS.LIBRARY ? serverRelativeUrl : '')
    );
    if (!serverRelativeUrl || !libraryRootServerRelativeUrl) return undefined;

    const parentServerRelativeUrl = normalizeServerRelativeUrl(bindingLike.parentServerRelativeUrl)
        || (targetKind === NAVIGATION_TARGET_KINDS.FOLDER ? parentServerRelativePath(serverRelativeUrl) : '');
    // A library's physical name is its title, so it is only derived for folders.
    const physicalName = asTrimmedText(bindingLike.physicalName)
        || (targetKind === NAVIGATION_TARGET_KINDS.FOLDER ? leafServerRelativeSegment(serverRelativeUrl) : '');

    return {
        ...passthrough,
        version: 1,
        mode: NAVIGATION_TARGET_MODES.SHAREPOINT_AUTO,
        targetKind,
        state: 'verified',
        serverRelativeUrl,
        listId: asTrimmedText(bindingLike.listId),
        libraryTitle: asTrimmedText(bindingLike.libraryTitle),
        libraryRootServerRelativeUrl,
        ...(parentServerRelativeUrl ? { parentServerRelativeUrl } : {}),
        ...(physicalName ? { physicalName } : {}),
        provisionKey: asTrimmedText(bindingLike.provisionKey),
    };
}

/**
 * Folder depth of a verified binding inside its owning library.
 * 0 = library root (level 1), 1 = level 2 folder, 2 = level 3 folder.
 * Returns -1 when the binding path is not inside its own library root.
 */
export function getNavigationBindingFolderDepth(bindingLike) {
    const binding = normalizeNavigationTargetBinding(bindingLike);
    if (!binding || binding.mode !== NAVIGATION_TARGET_MODES.SHAREPOINT_AUTO) return -1;
    const root = binding.libraryRootServerRelativeUrl.toLowerCase();
    const path = binding.serverRelativeUrl.toLowerCase();
    if (path === root) return 0;
    if (!path.startsWith(`${root}/`)) return -1;
    return binding.serverRelativeUrl.slice(root.length + 1).split('/').filter(Boolean).length;
}

/** Navigation level (1-3) represented by a verified SharePoint binding. */
export function getNavigationBindingLevel(bindingLike) {
    const depth = getNavigationBindingFolderDepth(bindingLike);
    return depth < 0 ? -1 : depth + 1;
}

export function getNavigationTargetBinding(node) {
    return normalizeNavigationTargetBinding(node?.targetBinding);
}

export function getNavigationTargetMode(node) {
    return getNavigationTargetBinding(node)?.mode || NAVIGATION_TARGET_MODES.MANUAL;
}

export function createNavigationNodeId(prefix = 'nav') {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getNavigationChildren(node) {
    if (Array.isArray(node?.children)) return node.children;
    if (Array.isArray(node?.subLinks)) return node.subLinks;
    return [];
}

export function getNavigationUrl(node) {
    const candidates = [node?.url, node?.path, node?.href, node?.folderPath, node?.target];
    for (const candidate of candidates) {
        const value = asTrimmedText(candidate);
        if (!value || RESERVED_BROWSER_TARGETS.has(value.toLowerCase())) continue;
        return value;
    }
    return '';
}

export function getNavigationKind(node) {
    const explicitKind = asTrimmedText(node?.kind || node?.type).toLowerCase();
    if (FOLDER_KINDS.has(explicitKind)) return 'folder';
    if (LINK_KINDS.has(explicitKind)) return 'link';

    const children = getNavigationChildren(node);
    if (children.length > 0 || !getNavigationUrl(node)) return 'folder';
    return 'link';
}

export function getNavigationNodeModel(node) {
    const children = getNavigationChildren(node);
    const url = getNavigationUrl(node);
    const kind = getNavigationKind(node);

    return {
        node,
        kind,
        url,
        children,
        canOpen: Boolean(url),
        canExplore: children.length > 0,
        isHybrid: Boolean(url) && children.length > 0,
        isEmptyFolder: kind === 'folder' && children.length === 0 && !url,
    };
}

export function shouldExploreNavigationNode(node) {
    return getNavigationNodeModel(node).canExplore;
}
