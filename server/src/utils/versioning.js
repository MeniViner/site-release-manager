export function parseReleaseVersion(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    normalized: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
  };
}

export function nextReleaseVersions(value) {
  const parsed = parseReleaseVersion(value);
  const base = parsed || { major: 0, minor: 0, patch: 0, normalized: '0.0.0' };
  return {
    baseVersion: base.normalized,
    hotfix: `${base.major}.${base.minor}.${base.patch + 1}`,
    minor: `${base.major}.${base.minor + 1}.0`,
    major: `${base.major + 1}.0.0`,
    recommended: parsed ? `${base.major}.${base.minor}.${base.patch + 1}` : '0.1.0',
  };
}
