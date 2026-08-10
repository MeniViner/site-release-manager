import { describe, expect, it } from 'vitest';
import { buildSiteRuntime } from '../src/services/deploymentService.js';

describe('universal release per-site runtime overlay', () => {
  it('uses standard TXT SharePoint folders by default', () => {
    const runtime = buildSiteRuntime(
      { host: 'portal.army.idf', siteCode: 'alpha' },
      { _id: 'release-a', version: '1.2.3' },
      'job-a',
      '2026-08-10T12:00:00.000Z',
    );
    expect(runtime.siteDbRoot).toBe('/sites/alpha/siteDB');
    expect(runtime.usersDbRoot).toBe('/sites/alpha/siteUsersDb');
    expect(runtime.targetDistPath).toBe('/sites/alpha/siteDB/dist');
    expect(runtime.finalAppUrl).toBe('https://portal.army.idf/sites/alpha/siteDB/dist/index.html');
    expect(runtime.storageBackend).toBe('txt');
  });

  it('preserves non-default existing SharePoint library names', () => {
    const runtime = buildSiteRuntime(
      {
        host: 'portal.army.idf',
        siteCode: 'alphateam',
        siteDbFolder: 'kashrarDB1',
        usersDbFolder: 'siteUsersDb',
        siteAssetsFolder: 'siteAssets',
        imagesFolder: 'images',
        widgetsDbTarget: 'site',
      },
      { _id: 'release-b', version: '2.0.0' },
      'job-b',
      '2026-08-10T12:00:00.000Z',
    );
    expect(runtime.siteDbRoot).toBe('/sites/alphateam/kashrarDB1');
    expect(runtime.targetDistPath).toBe('/sites/alphateam/kashrarDB1/dist');
    expect(runtime.finalAppUrl).toBe('https://portal.army.idf/sites/alphateam/kashrarDB1/dist/index.html');
    expect(runtime.widgetsDbTarget).toBe('site');
  });
});
