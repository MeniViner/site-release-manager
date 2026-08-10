import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const rootDir = path.resolve(serverDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

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

const configuredClientOrigins = csv(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:5173');
const clientOrigins = Array.from(new Set([
  ...configuredClientOrigins,
  ...sharePointHosts.map((host) => `https://${host}`),
]));

export const config = Object.freeze({
  port: Number(process.env.PORT || 4300),
  clientOrigins,
  // Kept for compatibility with older diagnostics/UI code.
  clientOrigin: clientOrigins[0] || 'http://localhost:5173',
  publicApiUrl: String(process.env.PUBLIC_API_URL || 'http://127.0.0.1:4300').replace(/\/+$/, ''),
  mongoUri: String(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'),
  mongoDbName: String(process.env.MONGO_DB_NAME || 'site_release_manager'),
  storageRoot: resolveFromRoot(process.env.STORAGE_ROOT, './storage'),
  sharePointHosts,
  sharePointDeployerPath: `/${String(process.env.SHAREPOINT_DEPLOYER_PATH || '/sites/tools/SiteAssets/site-release-deployer/index.html').replace(/^\/+/, '')}`,
  maxReleaseBytes: Number(process.env.MAX_RELEASE_MB || 500) * 1024 * 1024,
  maxReleaseFiles: Number(process.env.MAX_RELEASE_FILES || 12000),
});

export const paths = Object.freeze({
  releases: path.join(config.storageRoot, 'releases'),
  builds: path.join(config.storageRoot, 'deployments'),
  localSimulations: path.join(config.storageRoot, 'local-simulations'),
  temp: path.join(config.storageRoot, 'temp'),
});
