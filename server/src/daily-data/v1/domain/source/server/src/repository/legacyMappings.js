import crypto from 'crypto';

const normalizeSlashes = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/');

export const LEGACY_MAPPINGS = Object.freeze([
  {
    key: 'masterConfig',
    fileName: 'bihs_master_config_v1.txt',
    scope: 'config',
    entityId: 'master',
    mode: 'singleton',
  },
  {
    key: 'users',
    fileName: 'users_data.txt',
    scope: 'admins',
    mode: 'list',
    itemIdField: 'id',
    rootType: 'array',
  },
  {
    key: 'events',
    fileName: 'events_data.txt',
    scope: 'events',
    mode: 'list-with-settings',
    itemIdField: 'id',
    listProperty: 'events',
    rootType: 'object',
  },
  {
    key: 'navigation',
    fileName: 'nav_data.txt',
    scope: 'navigation',
    mode: 'list',
    itemIdField: 'id',
    rootType: 'array',
  },
  {
    key: 'siteContent',
    fileName: 'site_content_data.txt',
    scope: 'content',
    entityId: 'site',
    mode: 'singleton',
  },
  {
    key: 'theme',
    fileName: 'theme_data.txt',
    scope: 'design',
    entityId: 'theme',
    mode: 'singleton',
  },
  {
    key: 'widgets',
    fileName: 'widgets_data.txt',
    scope: 'widgets',
    entityId: 'config',
    mode: 'singleton',
    reason: 'widgets_data.txt is a mixed object with multiple nested lists and active item settings',
  },
  {
    key: 'externalLinks',
    fileName: 'external_links_data.txt',
    scope: 'externalLinks',
    mode: 'list',
    itemIdField: 'id',
    rootType: 'array',
  },
  {
    key: 'gantt',
    fileName: 'gantt_data.txt',
    scope: 'gantt',
    entityId: 'settings',
    mode: 'singleton',
  },
  {
    key: 'boom',
    fileName: 'boom_data.txt',
    scope: 'boom',
    entityId: 'settings',
    mode: 'singleton',
    optionalWhenMissing: true,
  },
]);

export function normalizeLegacyKey(key) {
  const raw = String(key || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    try {
      return normalizeSlashes(new URL(raw).pathname).replace(/^\/+/, '');
    } catch {
      return normalizeSlashes(raw).replace(/^\/+/, '');
    }
  }

  return normalizeSlashes(raw).replace(/^\/+/, '');
}

export function getLegacyMapping(key) {
  const normalized = normalizeLegacyKey(key);
  const fileName = normalized.split('/').pop()?.toLowerCase() || normalized.toLowerCase();
  return LEGACY_MAPPINGS.find((mapping) => mapping.fileName.toLowerCase() === fileName) || {
    key: 'unknown',
    fileName,
    scope: 'legacy',
    entityId: normalized,
    mode: 'singleton',
    unknown: true,
  };
}

export function getLegacyMetaEntityId(key) {
  return normalizeLegacyKey(key);
}

export function getLegacyListMetaEntityId(key) {
  const normalized = normalizeLegacyKey(key);
  const suffix = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 10);
  return `__legacy_meta_${suffix}`;
}

export function describeLegacyMapping(mapping) {
  if (mapping.unknown) {
    return 'unknown legacy key stored as singleton in legacy scope';
  }
  if (mapping.mode === 'list') {
    return `${mapping.fileName} list items stored as ${mapping.scope} documents`;
  }
  if (mapping.mode === 'list-with-settings') {
    return `${mapping.fileName} list items stored as ${mapping.scope} documents with a settings meta document`;
  }
  return `${mapping.fileName} stored as singleton ${mapping.scope}:${mapping.entityId}`;
}
