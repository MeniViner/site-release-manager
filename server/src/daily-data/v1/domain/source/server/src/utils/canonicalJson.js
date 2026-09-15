import crypto from 'crypto';

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256OfCanonicalJson(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function deepMergeJson(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return cloneJson(patch);
  }

  const next = cloneJson(base);
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null) {
      next[key] = null;
      return;
    }

    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = deepMergeJson(next[key], value);
      return;
    }

    next[key] = cloneJson(value);
  });

  return next;
}
