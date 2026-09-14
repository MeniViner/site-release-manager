/**
 * TXT seed plan.
 *
 * The authoritative registry lives in shared/siteRuntime.js, mirrored from Site
 * Builder's FILE_NAMES. This module stays only as the historical entry point so
 * existing callers keep working against one source of truth.
 */

const { buildSiteIdentity, buildTxtSeedPlan } = require("../shared/siteRuntime.js");
function buildSeedFiles(site) {
  return buildTxtSeedPlan(buildSiteIdentity(site));
}

module.exports = {
  buildSeedFiles: buildSeedFiles,
  buildTxtSeedPlan: buildTxtSeedPlan,
};
