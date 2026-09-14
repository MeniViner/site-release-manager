const BACKENDS = Object.freeze(['txt', 'mongo']);

function normalizeBackend(value, fallback = 'txt') {
  const backend = String(value || fallback).trim().toLowerCase();
  if (!BACKENDS.includes(backend)) {
    const error = new Error(`Unsupported storage backend "${value}".`);
    error.statusCode = 400;
    error.code = 'INVALID_BACKEND';
    throw error;
  }
  return backend;
}

function backendQuery(value) {
  if (value === undefined || value === null || value === '') return {};
  return { storageBackend: normalizeBackend(value) };
}

function releaseSupportsBackend(release, backend) {
  const supported = release?.universalProof?.storageCompatibility;
  return Array.isArray(supported) && supported.map((item) => String(item).toLowerCase()).includes(backend);
}

module.exports = { BACKENDS, normalizeBackend, backendQuery, releaseSupportsBackend };
