const {
  buildSiteIdentity,
  buildTxtSeedPlan,
  requiredLibraries,
  requiredFolders,
} = require("../shared/siteRuntime.js");
const { normalizeBackend, releaseSupportsBackend } = require("../utils/backendMode.js");

function buildMongoSharePointPlan(identity, extraDistFolders = []) {
  return {
    libraries: [
      {
        title: identity.siteDbFolder,
        urlSegment: identity.siteDbFolder,
        rootFolder: identity.siteDbRoot,
        role: 'frontend',
      },
    ],
    folders: [
      identity.imagesRoot,
      identity.targetDistPath,
      ...[...new Set(extraDistFolders.filter(Boolean))].sort().map((relative) => `${identity.targetDistPath}/${relative}`),
    ],
    seedFiles: [],
    permissionsMarker: null,
  };
}

const PROFILES = Object.freeze({
  txt: Object.freeze({
    backend: 'txt',
    capabilities: Object.freeze({ txtSeeds: true, txtBackup: true, permissionsMarker: true }),
    buildSharePointPlan(identity, extraDistFolders = []) {
      return {
        libraries: requiredLibraries(identity),
        folders: requiredFolders(identity, extraDistFolders),
        seedFiles: buildTxtSeedPlan(identity),
        permissionsMarker: `${identity.usersDbRoot}/.permissions-setup.json`,
      };
    },
  }),
  mongo: Object.freeze({
    backend: 'mongo',
    capabilities: Object.freeze({ txtSeeds: false, txtBackup: false, permissionsMarker: false }),
    buildSharePointPlan: buildMongoSharePointPlan,
  }),
});

function deploymentProfileFor(site) {
  return PROFILES[normalizeBackend(site?.storageBackend)];
}

function assertReleaseCompatibility(release, backend) {
  if (!releaseSupportsBackend(release, backend)) {
    const error = new Error(`Release ${release?.version || ''} does not support the ${backend.toUpperCase()} backend.`);
    error.statusCode = 409;
    error.code = 'RELEASE_BACKEND_INCOMPATIBLE';
    throw error;
  }
}

function buildBackendDeploymentPlan(site, release, extraDistFolders = []) {
  const identity = buildSiteIdentity(site);
  const profile = deploymentProfileFor(site);
  assertReleaseCompatibility(release, profile.backend);
  return {
    backend: profile.backend,
    capabilities: profile.capabilities,
    identity,
    ...profile.buildSharePointPlan(identity, extraDistFolders),
  };
}

module.exports = {
  PROFILES,
  deploymentProfileFor,
  assertReleaseCompatibility,
  buildBackendDeploymentPlan,
  buildMongoSharePointPlan,
};
