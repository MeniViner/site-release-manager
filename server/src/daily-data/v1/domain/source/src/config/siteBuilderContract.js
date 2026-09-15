export const SITE_BUILDER_DEFAULT_APP_VERSION = '0.1.14';
export const SITE_BUILDER_DATA_SCHEMA_VERSION = '1.0.0';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function normalizeSiteBuilderAppVersion(value) {
    const normalized = String(value ?? '').trim();
    return SEMVER_RE.test(normalized) ? normalized : SITE_BUILDER_DEFAULT_APP_VERSION;
}

export function buildSupportedFrontendRange(appVersion = SITE_BUILDER_DEFAULT_APP_VERSION) {
    const normalized = normalizeSiteBuilderAppVersion(appVersion);
    return `^${normalized}`;
}
