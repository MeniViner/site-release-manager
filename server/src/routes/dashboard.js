import { Router } from 'express';
import { getDb } from '../db.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (_req, res, next) => {
  try {
    const db = getDb();
    const [sites, latestRelease] = await Promise.all([
      db.collection('sites').find({}).sort({ updatedAt: -1 }).toArray(),
      db.collection('releases').findOne({ status: 'READY' }, { sort: { createdAt: -1 } }),
    ]);
    const latestVersion = latestRelease?.version || null;
    const byUnitMap = new Map();
    for (const site of sites) byUnitMap.set(site.unit, (byUnitMap.get(site.unit) || 0) + 1);

    res.json({
      totals: {
        all: sites.length,
        active: sites.filter((site) => site.status === 'ACTIVE' || site.status === 'TRACKED').length,
        outdated: latestVersion ? sites.filter((site) => site.currentVersion && site.currentVersion !== latestVersion).length : 0,
        waiting: sites.filter((site) => ['PREPARING_RELEASE', 'READY_FOR_SHAREPOINT', 'DEPLOYING'].includes(site.status)).length,
      },
      latestRelease: latestRelease ? { id: String(latestRelease._id), version: latestRelease.version } : null,
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
