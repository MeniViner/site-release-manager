const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const serverDir = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(serverDir, '..');

function readPackage(directory) {
  const packagePath = path.join(directory, 'package.json');
  if (!fs.existsSync(packagePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${packagePath}: ${error.message}`);
  }
}

const repositoryPackage = readPackage(repositoryRoot);
const serverPackage = readPackage(serverDir);
// An arbitrary parent package.json must never redirect the isolated artifact's
// .env and storage paths. Only the known repository package selects that root.
const rootDir = repositoryPackage?.name === 'site-release-manager'
  ? repositoryRoot
  : serverPackage?.name === 'site-release-manager-server'
    ? serverDir
    : null;
if (!rootDir) {
  throw new Error(`Could not identify the Site Release Manager application root from ${serverDir}.`);
}
dotenv.config({ path: path.join(rootDir, '.env') });
const rootPackage = readPackage(rootDir);
const appVersion = String(rootPackage.version || 'unknown');

const resolveFromRoot = (value, fallback) => {
  const raw = String(value || fallback || '').trim();
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
};

const csv = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().replace(/\/+$/, ''))
  .filter(Boolean);

function absoluteHttpUrl(value, label) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is required.`);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an absolute HTTP(S) URL without credentials, query parameters, or a fragment.`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/+$/, '');
}

function dailyDataApiUrl(value) {
  const normalized = absoluteHttpUrl(value, 'PUBLIC_DAILY_DATA_API_URL');
  if (!new URL(normalized).pathname.endsWith('/api/daily-data/v1')) {
    throw new Error('PUBLIC_DAILY_DATA_API_URL must end with /api/daily-data/v1.');
  }
  return normalized;
}

function trustedHeaderName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(normalized)) {
    throw new Error('TRUSTED_IDENTITY_HEADER must be a valid HTTP header name.');
  }
  if (normalized === 'x-iisnode-auth_user') {
    throw new Error('TRUSTED_IDENTITY_HEADER must use x-iisnode-auth-user; HTTP_X_IISNODE_AUTH_USER maps to hyphens, not underscores.');
  }
  return normalized;
}

const sharePointHosts = csv(process.env.SHAREPOINT_HOSTS || 'portal.army.idf,mazi.army.idf')
  .map((value) => value.toLowerCase());

function parseListenTarget(value, fallback = 4300) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

const configuredClientOrigins = csv(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:5173');
const clientOrigins = Array.from(new Set([
  ...configuredClientOrigins,
  ...sharePointHosts.map((host) => `https://${host}`),
]));

const config = Object.freeze({
  appVersion,
  // IISNode passes a named pipe through PORT. Express accepts either a numeric
  // TCP port or that string; coercing it with Number() corrupts the pipe.
  port: parseListenTarget(process.env.PORT, 4300),
  clientOrigins,
  // Kept for compatibility with older diagnostics/UI code.
  clientOrigin: clientOrigins[0] || 'http://localhost:5173',
  publicApiUrl: absoluteHttpUrl(process.env.PUBLIC_API_URL || 'http://127.0.0.1:4300', 'PUBLIC_API_URL'),
  mongoUri: String(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'),
  mongoDbName: String(process.env.MONGO_DB_NAME || 'site_release_manager'),
  // Builder application documents deliberately use a different database from
  // Release Manager's tracking, jobs, and backup records.
  builderDataMongoDbName: String(process.env.BUILDER_DATA_MONGO_DB_NAME || `${process.env.MONGO_DB_NAME || 'site_release_manager'}_site_builder_data`),
  dailyDataApiUrl: dailyDataApiUrl(process.env.PUBLIC_DAILY_DATA_API_URL || `${process.env.PUBLIC_API_URL || 'http://127.0.0.1:4300'}/api/daily-data/v1`),
  nodeEnv: String(process.env.NODE_ENV || 'development'),
  trustedIdentityHeader: trustedHeaderName(process.env.TRUSTED_IDENTITY_HEADER || 'x-iisnode-auth-user'),
  trustedIdentityEnabled: String(process.env.TRUSTED_IDENTITY_ENABLED || 'false').toLowerCase() === 'true',
  dailyDataDevIdentityHeader: String(process.env.DAILY_DATA_DEV_IDENTITY_HEADER || 'x-daily-data-dev-user').toLowerCase(),
  // Signs management session tokens. Production must supply a real secret;
  // development falls back to a per-process random value so tokens still cannot
  // be forged, and simply do not survive a restart.
  managementSessionSecret: String(process.env.MANAGEMENT_SESSION_SECRET || '').trim()
    || (String(process.env.NODE_ENV || 'development') === 'production'
      ? ''
      : require('node:crypto').randomBytes(32).toString('hex')),
  managementSessionTtlSeconds: Number(process.env.MANAGEMENT_SESSION_TTL_SECONDS || 8 * 60 * 60),
  storageRoot: resolveFromRoot(process.env.STORAGE_ROOT, './storage'),
  sharePointHosts,
  sharePointDeployerPath: `/${String(process.env.SHAREPOINT_DEPLOYER_PATH || '/sites/tools/SiteAssets/site-release-deployer/index.html').replace(/^\/+/, '')}`,
  maxReleaseBytes: Number(process.env.MAX_RELEASE_MB || 500) * 1024 * 1024,
  maxReleaseFiles: Number(process.env.MAX_RELEASE_FILES || 12000),
});

if (config.nodeEnv === 'production') {
  const missing = [
    'PUBLIC_API_URL',
    'PUBLIC_DAILY_DATA_API_URL',
    'MONGO_URI',
    'MONGO_DB_NAME',
    'BUILDER_DATA_MONGO_DB_NAME',
  ].filter((name) => !String(process.env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Production configuration is incomplete. Set: ${missing.join(', ')}.`);
  }
  if (!config.trustedIdentityEnabled) {
    throw new Error('Production requires TRUSTED_IDENTITY_ENABLED=true; Mongo management and daily-data access fail closed without a trusted identity boundary.');
  }
  // Management session tokens are the only thing standing between an
  // authenticated Windows principal and the create/provision API, so they
  // cannot be signed with an absent or guessable value.
  if (!config.managementSessionSecret || config.managementSessionSecret.length < 32) {
    throw new Error(
      'Production requires MANAGEMENT_SESSION_SECRET (at least 32 characters). '
      + 'Generate a unique random value per installation.',
    );
  }
}

const paths = Object.freeze({
  releases: path.join(config.storageRoot, 'releases'),
  builds: path.join(config.storageRoot, 'deployments'),
  localSimulations: path.join(config.storageRoot, 'local-simulations'),
  temp: path.join(config.storageRoot, 'temp'),
});

module.exports = {
  rootDir: rootDir,
  config: config,
  paths: paths,
  parseListenTarget: parseListenTarget,
  absoluteHttpUrl: absoluteHttpUrl,
  dailyDataApiUrl: dailyDataApiUrl,
  trustedHeaderName: trustedHeaderName,
};
