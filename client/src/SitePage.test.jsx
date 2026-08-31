import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import SitePage from './SitePage.jsx';
import { api } from './api.js';
import { buildSiteIdentity, buildTxtSeedPlan } from '../../shared/siteRuntime.js';

const identity = buildSiteIdentity({
  host: 'portal.army.idf',
  siteCode: 'schedule',
  siteDbFolder: 'siteDB1',
  usersDbFolder: 'siteUsersDb1',
});

function siteFixture(overrides = {}) {
  return {
    id: 'site-a',
    name: 'Schedule A',
    unit: 'Operations',
    managerName: 'Manager',
    status: 'ACTIVE',
    currentVersion: '1.4.0',
    currentReleaseId: 'release-1',
    lastPublishedAt: '2026-08-31T10:00:00.000Z',
    storageBackend: 'txt',
    ...identity,
    targetKey: 'portal.army.idf|schedule|sitedb1|siteusersdb1',
    finalUrl: identity.finalAppUrl,
    identity,
    activeRun: null,
    currentRelease: {
      id: 'release-1',
      version: '1.4.0',
      buildId: 'build-140',
      deployedAt: '2026-08-31T10:00:00.000Z',
    },
    latestAvailableRelease: { id: 'release-2', version: '1.5.0', buildId: 'build-150' },
    lastSuccessfulRun: { id: 'run-success-123456', finishedAt: '2026-08-31T10:00:00.000Z', finalUrl: identity.finalAppUrl },
    runs: [
      {
        id: 'run-success-123456',
        state: 'SUCCEEDED',
        type: 'UPDATE',
        createdAt: '2026-08-31T09:55:00.000Z',
        finishedAt: '2026-08-31T10:00:00.000Z',
        release: { id: 'release-1', version: '1.4.0', buildId: 'build-140' },
      },
      {
        id: 'run-failed-654321',
        state: 'FAILED',
        type: 'UPDATE',
        createdAt: '2026-08-30T09:55:00.000Z',
        finishedAt: '2026-08-30T09:56:00.000Z',
        release: { id: 'release-old', version: '1.3.0', buildId: 'build-130' },
      },
    ],
    backups: [{
      id: 'backup-1',
      runId: 'run-success-123456',
      outcome: 'FAILED',
      sourceVersion: '1.3.0',
      copiedCount: 0,
      fileCount: 10,
      createdAt: '2026-08-31T09:56:00.000Z',
    }],
    plan: {
      txtSeeds: buildTxtSeedPlan(identity).map(({ fileName, path }) => ({ fileName, path })),
    },
    ...overrides,
  };
}

function mockSiteRequests(detail = siteFixture()) {
  vi.spyOn(api, 'site').mockResolvedValue(detail);
  vi.spyOn(api, 'sites').mockResolvedValue([detail]);
  vi.spyOn(api, 'releases').mockResolvedValue([
    { id: 'release-2', version: '1.5.0' },
    { id: 'release-1', version: '1.4.0' },
  ]);
  vi.spyOn(api, 'config').mockResolvedValue({ sharePointHosts: ['portal.army.idf'] });
  vi.spyOn(api, 'runs').mockResolvedValue([]);
}

describe('Site workspace route', () => {
  it('loads the requested Site with current release, scoped runs, canonical paths and backup warning', async () => {
    mockSiteRequests();

    render(<MemoryRouter initialEntries={['/sites/site-a']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Schedule A' })).toBeInTheDocument();
    expect(api.site).toHaveBeenCalledWith('site-a');
    expect(screen.getByText('build-140')).toBeInTheDocument();
    expect(screen.getAllByText('1.3.0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('נכשל').length).toBeGreaterThan(0);
    expect(screen.getByText(/הפריסה יכולה להצליח גם כאשר הגיבוי נכשל/)).toBeInTheDocument();
    expect(document.querySelectorAll('.canonical-path-list > div')).toHaveLength(10);
    expect(screen.getByRole('link', { name: /כל הגיבויים של האתר/ })).toHaveAttribute('href', '/backups?siteId=site-a');
  });

  it('renders the internal not-found state for a missing Site', async () => {
    vi.spyOn(api, 'site').mockRejectedValue(new Error('האתר לא נמצא.'));
    vi.spyOn(api, 'releases').mockResolvedValue([]);
    vi.spyOn(api, 'config').mockResolvedValue({ sharePointHosts: ['portal.army.idf'] });
    vi.spyOn(api, 'runs').mockResolvedValue([]);

    render(<MemoryRouter initialEntries={['/sites/missing']}><App /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'האתר לא נמצא' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /חזרה לאתרים/ })).toHaveAttribute('href', '/sites');
  });

  it('derives path previews from canonical identity fields and locks only those fields during a run', async () => {
    const detail = siteFixture({
      activeRun: { jobId: 'active-run', state: 'DEPLOYING', stateLabel: 'בפריסה' },
    });
    mockSiteRequests(detail);

    render(
      <MemoryRouter initialEntries={['/sites/site-a?section=edit']}>
        <Routes><Route path="/sites/:siteId" element={<SitePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('זהות היעד נעולה זמנית')).toBeInTheDocument();
    expect(screen.getByLabelText('שם האתר')).toBeEnabled();
    expect(screen.getByLabelText('Host')).toBeDisabled();
    expect(screen.getByLabelText('siteDbFolder')).toBeDisabled();
  });

  it('updates the final URL preview immediately when an unlocked canonical field changes', async () => {
    mockSiteRequests();

    render(
      <MemoryRouter initialEntries={['/sites/site-a?section=edit']}>
        <Routes><Route path="/sites/:siteId" element={<SitePage />} /></Routes>
      </MemoryRouter>,
    );

    const siteDbFolder = await screen.findByLabelText('siteDbFolder');
    fireEvent.change(siteDbFolder, { target: { value: 'siteDBFinance' } });
    await waitFor(() => {
      expect(screen.getByText('https://portal.army.idf/sites/schedule/siteDBFinance/dist/index.html')).toBeInTheDocument();
    });
  });

  it('renders an invalid legacy Site as repairable instead of crashing the workspace', async () => {
    const invalid = siteFixture({
      identity: null,
      identityError: 'Invalid siteCode "?".',
      targetKey: '',
      finalUrl: '',
      siteCode: '?',
      plan: null,
      latestAvailableRelease: null,
    });
    mockSiteRequests(invalid);

    render(
      <MemoryRouter initialEntries={['/sites/site-a?section=edit']}>
        <Routes><Route path="/sites/:siteId" element={<SitePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('זהות היעד השמורה אינה תקינה')).toBeInTheDocument();
    expect(await screen.findByLabelText('siteCode')).toBeEnabled();
    expect(screen.queryByRole('link', { name: 'פתח אתר' })).not.toBeInTheDocument();
    expect(screen.getByText(/תקן את זהות היעד כדי להציג/)).toBeInTheDocument();
  });

  it('defaults to the installed Release when the API reports no newer Release', async () => {
    mockSiteRequests(siteFixture({ latestAvailableRelease: null }));

    render(
      <MemoryRouter initialEntries={['/sites/site-a']}>
        <Routes><Route path="/sites/:siteId" element={<SitePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('ריליס לפריסה')).toHaveValue('release-1');
  });
});
