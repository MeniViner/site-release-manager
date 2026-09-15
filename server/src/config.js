const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const serverDir = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(serverDir, '..');
// The full source tree is <root>/server/src; the server-only IIS artifact is
// intentionally flat at <artifact>/src. Resolve either topology explicitly.
const rootDir = fs.existsSync(path.join(repositoryRoot, 'package.json')) ? repositoryRoot : serverDir;
dotenv.config({ path: path.join(rootDir, '.env') });
const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const appVersion = String(rootPackage.version || 'unknown');

const resolveFromRoot = (value, fallback) => {
  const raw = String(value || fallback || '').trim();
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
};

const csv = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().replace(/\/+$/, ''))
  .filter(Boolean);

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
  publicApiUrl: String(process.env.PUBLIC_API_URL || 'http://127.0.0.1:4300').replace(/\/+$/, ''),
  mongoUri: String(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'),
  mongoDbName: String(process.env.MONGO_DB_NAME || 'site_release_manager'),
  // Builder application documents deliberately use a different database from
  // Release Manager's tracking, jobs, and backup records.
  builderDataMongoDbName: String(process.env.BUILDER_DATA_MONGO_DB_NAME || `${process.env.MONGO_DB_NAME || 'site_release_manager'}_site_builder_data`),
  dailyDataApiUrl: String(process.env.PUBLIC_DAILY_DATA_API_URL || `${process.env.PUBLIC_API_URL || 'http://127.0.0.1:4300'}/api/daily-data/v1`).replace(/\/+$/, ''),
  nodeEnv: String(process.env.NODE_ENV || 'development'),
  trustedIdentityHeader: String(process.env.TRUSTED_IDENTITY_HEADER || 'x-iisnode-auth_user').toLowerCase(),
  trustedIdentityEnabled: String(process.env.TRUSTED_IDENTITY_ENABLED || 'false').toLowerCase() === 'true',
  dailyDataDevIdentityHeader: String(process.env.DAILY_DATA_DEV_IDENTITY_HEADER || 'x-daily-data-dev-user').toLowerCase(),
  trustedSiteAccessEnabled: String(process.env.TRUSTED_SITE_ACCESS_ENABLED || 'false').toLowerCase() === 'true',
  trustedSiteAccessHeader: String(process.env.TRUSTED_SITE_ACCESS_HEADER || 'x-iisnode-sharepoint-sites').toLowerCase(),
  storageRoot: resolveFromRoot(process.env.STORAGE_ROOT, './storage'),
  sharePointHosts,
  sharePointDeployerPath: `/${String(process.env.SHAREPOINT_DEPLOYER_PATH || '/sites/tools/SiteAssets/site-release-deployer/index.html').replace(/^\/+/, '')}`,
  maxReleaseBytes: Number(process.env.MAX_RELEASE_MB || 500) * 1024 * 1024,
  maxReleaseFiles: Number(process.env.MAX_RELEASE_FILES || 12000),
});

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
};
