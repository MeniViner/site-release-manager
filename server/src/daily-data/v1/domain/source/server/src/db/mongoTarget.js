const safeName = (value, fallback) => (/^[a-zA-Z0-9._-]{1,128}$/.test(value) ? value : fallback);
const safeDecode = (value) => { try { return decodeURIComponent(value); } catch { return ''; } };

export function sanitizeMongoTarget(uri, databaseOverride = '') {
  const match = String(uri || '').match(/^(mongodb(?:\+srv)?):\/\/([^/?#]*)(?:\/([^?#]*))?(?:\?([^#]*))?/i);
  if (!match) {
    return { protocol: 'unknown', hosts: [], database: safeName(databaseOverride, '[unknown]'), tlsConfigured: false, authenticationConfigured: false };
  }
  const authority = match[2];
  const protocol = match[1].toLowerCase();
  const hosts = authority.slice(authority.lastIndexOf('@') + 1).split(',').filter(Boolean);
  const query = new URLSearchParams(match[4] || '');
  const tls = String(query.get('tls') || query.get('ssl') || '').toLowerCase();
  const replicaSet = query.get('replicaSet');
  return {
    protocol,
    hosts: hosts.map((host, index) => {
      const port = host.match(/:(\d+)$/)?.[1];
      return { alias: `mongo-host-${index + 1}`, ...(port ? { port: Number(port) } : {}) };
    }),
    database: safeName(databaseOverride || safeDecode(match[3] || ''), '[unknown]'),
    ...(replicaSet ? { replicaSet: safeName(replicaSet, '[redacted]') } : {}),
    tlsConfigured: protocol === 'mongodb+srv' || ['true', '1'].includes(tls),
    authenticationConfigured: authority.includes('@'),
  };
}

export function safeMongoError(error, database) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code || '') : '';
  return {
    name: error instanceof Error ? error.name : 'MongoConnectionError',
    message: `Target Mongo connection failed for database ${safeName(database, '[unknown]')}`,
    ...(code ? { code } : {}),
  };
}

export function getMongoTopology(client) {
  return client?.topology?.description?.type || 'unknown';
}
