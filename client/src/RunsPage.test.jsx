import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import RunsPage from './RunsPage.jsx';
import { api } from './api.js';

function runFixture(state) {
  const run = {
    id: `run-${state.toLowerCase()}`,
    state,
    storedState: state,
    type: 'UPDATE',
    progress: 100,
    canCancel: false,
    canRetry: state === 'FAILED',
    canResume: false,
    createdAt: '2026-08-31T10:00:00.000Z',
    startedAt: '2026-08-31T10:00:01.000Z',
    finishedAt: '2026-08-31T10:00:10.000Z',
    deployerUrl: 'https://portal.army.idf/SiteAssets/site-release-deployer/index.html',
    site: {
      id: 'site-a',
      name: 'Schedule A',
      unit: 'Operations',
      host: 'portal.army.idf',
      siteCode: 'schedule',
      finalUrl: 'https://portal.army.idf/sites/schedule/siteDB1/dist/index.html',
    },
    release: { id: 'release-1', version: '1.4.0' },
    runEvents: [],
    logs: [],
    stageSummary: [],
  };
  if (state === 'FAILED') {
    run.failureInfo = {
      stage: 'CREATE_FOLDERS',
      stageLabel: 'יצירת תיקיות',
      message: 'raw payload: secret diagnostic text',
      errorClass: 'PATH_COLLISION',
      details: { diagnosticMessage: 'raw payload: secret diagnostic text' },
    };
  }
  return run;
}

async function renderRun(state) {
  const run = runFixture(state);
  vi.spyOn(api, 'runs').mockResolvedValue([run]);
  vi.spyOn(api, 'run').mockResolvedValue(run);
  render(<MemoryRouter initialEntries={[`/runs?runId=${run.id}`]}><RunsPage /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'פרטי ריצת SharePoint' });
  return run;
}

describe('terminal Run actions', () => {
  it('makes open Site and recent releases the successful Run actions while diagnostics stay tertiary', async () => {
    const run = await renderRun('SUCCEEDED');

    expect(screen.getByRole('link', { name: 'פתח אתר' })).toHaveAttribute('href', run.site.finalUrl);
    expect(screen.getByRole('button', { name: /ריליסים אחרונים/ })).toBeInTheDocument();
    expect(document.querySelector('.run-action-diagnostic')).not.toBeInTheDocument();
    expect(screen.getByText('אבחון SharePoint').closest('details')).toBeInTheDocument();
  });

  it('keeps SharePoint diagnostics prominent for a failed Run', async () => {
    await renderRun('FAILED');

    const diagnostics = screen.getByRole('link', { name: 'אבחון SharePoint' });
    expect(diagnostics).toHaveClass('run-action-diagnostic');
    expect(screen.getAllByText('נמצא ב-SharePoint אובייקט אחר שאינו תואם לנתיב הפריסה.')).toHaveLength(2);
    expect(screen.queryByText(/secret diagnostic text/)).not.toBeInTheDocument();
  });
});

describe('failure diagnostics never expose raw server content', () => {
  it('sanitises the SharePoint response preview before rendering it', async () => {
    const hostile = [
      '<html><body>SharePoint error</body></html>',
      'Authorization: Bearer abcdef0123456789',
      'set-cookie: FedAuth=SECRETCOOKIEVALUE',
      'https://portal.army.idf/_api/web?token=SUPERSECRETTOKEN',
    ].join(' ');

    const { sanitizeReleaseDiagnostic } = await import('../../shared/userFacingErrors.js');
    const safe = sanitizeReleaseDiagnostic(hostile);

    expect(safe).not.toContain('<html>');
    expect(safe).not.toContain('<body>');
    expect(safe).toContain('[html]');
    expect(safe).not.toContain('abcdef0123456789');
    expect(safe).not.toContain('SECRETCOOKIEVALUE');
    expect(safe).not.toContain('SUPERSECRETTOKEN');
    expect(safe).toContain('[redacted]');
    expect(safe.length).toBeLessThanOrEqual(500);
  });
});
