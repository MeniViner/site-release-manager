import crypto from 'crypto';

const DEFAULT_PREFIX = 'site_';
const DEFAULT_MAX_LENGTH = 96;

const hash = (value, length = 10) =>
  crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);

const sanitizePrefix = (value) => {
  const cleaned = String(value || DEFAULT_PREFIX)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return cleaned ? `${cleaned.replace(/_?$/u, '')}_` : DEFAULT_PREFIX;
};

export function sanitizeSiteCollectionName(siteIdOrSlug, options = {}) {
  const prefix = sanitizePrefix(options.prefix || process.env.SITE_COLLECTION_PREFIX || DEFAULT_PREFIX);
  const maxLength = Math.max(32, Number(options.maxLength || DEFAULT_MAX_LENGTH));
  const hashLength = Math.max(6, Math.min(24, Number(options.hashLength || 10)));
  const raw = String(siteIdOrSlug ?? '').trim();
  const stableHash = hash(raw, hashLength);

  const lowered = raw.toLowerCase();
  let base = lowered
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[/\\\s.]+/g, '_')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/-+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!base || base === 'system') {
    base = 'site';
  }

  if (base.startsWith('system_')) {
    base = `site_${base}`;
  }

  const suffix = `_${stableHash}`;
  const maxBaseLength = Math.max(4, maxLength - prefix.length - suffix.length);
  const truncatedBase = base.slice(0, maxBaseLength).replace(/^_+|_+$/g, '') || 'site';

  return `${prefix}${truncatedBase}${suffix}`
    .replace(/_+/g, '_')
    .slice(0, maxLength);
}

export function assertSafeCollectionName(collectionName) {
  const value = String(collectionName ?? '');
  if (!/^[a-z0-9_][a-z0-9_-]*$/u.test(value)) {
    throw new Error(`Unsafe MongoDB collection name: ${value}`);
  }
  if (value.startsWith('system.')) {
    throw new Error(`Unsafe MongoDB collection name: ${value}`);
  }
  if (value.length > DEFAULT_MAX_LENGTH) {
    throw new Error(`MongoDB collection name is too long: ${value.length}`);
  }
  return value;
}
