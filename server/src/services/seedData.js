/**
 * TXT seed plan.
 *
 * The authoritative registry lives in shared/siteRuntime.js, mirrored from Site
 * Builder's FILE_NAMES. This module stays only as the historical entry point so
 * existing callers keep working against one source of truth.
 */

import { buildSiteIdentity, buildTxtSeedPlan } from '../../../shared/siteRuntime.js';

export function buildSeedFiles(site) {
  return buildTxtSeedPlan(buildSiteIdentity(site));
}

export { buildTxtSeedPlan };
