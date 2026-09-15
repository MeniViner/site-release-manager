const { Router } = require("express");
const { getDb } = require("../db.js");
const { backendQuery, releaseSupportsBackend, normalizeBackend } = require("../utils/backendMode.js");
const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const query = backendQuery(req.query.backend);
    const backend = req.query.backend ? normalizeBackend(req.query.backend) : null;
    const [sites, latestRelease] = await Promise.all([
      db.collection('sites').find(query).sort({ updatedAt: -1 }).toArray(),
      db.collection('releases').find({ status: 'READY' }).sort({ createdAt: -1 }).toArray(),
    ]);
    const compatibleRelease = latestRelease.find((release) => !backend || releaseSupportsBackend(release, backend)) || null;
    const latestVersion = compatibleRelease?.version || null;
    const byUnitMap = new Map();
    for (const site of sites) byUnitMap.set(site.unit, (byUnitMap.get(site.unit) || 0) + 1);

    res.json({
      totals: {
        all: sites.length,
        active: sites.filter((site) => site.status === 'ACTIVE' || site.status === 'TRACKED').length,
        outdated: latestVersion ? sites.filter((site) => site.currentVersion && site.currentVersion !== latestVersion).length : 0,
        waiting: sites.filter((site) => ['QUEUED','PREPARING_RELEASE','READY_FOR_SHAREPOINT','WAITING_FOR_BROWSER','DEPLOYING','PAUSED'].includes(site.status)).length,
      },
      storageBackend: backend,
      latestRelease: compatibleRelease ? { id: String(compatibleRelease._id), version: compatibleRelease.version } : null,
      recentSites: sites.slice(0, 8),
      outdatedSites: latestVersion
        ? sites.filter((site) => site.currentVersion !== latestVersion).slice(0, 8)
        : [],
      byUnit: [...byUnitMap.entries()].map(([unit, count]) => ({ unit, count })).sort((a, b) => b.count - a.count),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  dashboardRouter: dashboardRouter,
};
