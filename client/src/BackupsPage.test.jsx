import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import BackupsPage from './BackupsPage.jsx';
import { api } from './api.js';

describe('Backups page', () => {
  it('loads real backup metadata, keeps the Site filter in the route and applies outcome filters', async () => {
    vi.spyOn(api, 'sites').mockResolvedValue([{
      id: 'site-a',
      name: 'Schedule A',
      siteDbFolder: 'siteDB1',
    }]);
    vi.spyOn(api, 'backups').mockResolvedValue([{
      id: 'backup-a',
      siteId: 'site-a',
      runId: 'run-123456',
      storageBackend: 'txt',
      sourceVersion: '1.3.0',
      incomingVersion: '1.4.0',
      outcome: 'FAILED',
      copiedCount: 0,
      fileCount: 10,
      totalSizeBytes: 0,
      createdAt: '2026-08-31T10:00:00.000Z',
      backupUrl: '',
      target: { siteCode: 'schedule', siteDbFolder: 'siteDB1', usersDbFolder: 'siteUsersDb1' },
      site: {
        name: 'Schedule A',
        finalUrl: 'https://portal.army.idf/sites/schedule/siteDB1/dist/index.html',
        tracked: true,
      },
    }]);

    render(<MemoryRouter initialEntries={['/backups?siteId=site-a']}><BackupsPage /></MemoryRouter>);

    expect(await screen.findByText('Schedule A')).toBeInTheDocument();
    expect(api.backups).toHaveBeenCalledWith({ siteId: 'site-a', backend: '', outcome: '' });
    expect(screen.getByText('0/10')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('תוצאה'), { target: { value: 'FAILED' } });
    await waitFor(() => {
      expect(api.backups).toHaveBeenLastCalledWith({ siteId: 'site-a', backend: '', outcome: 'FAILED' });
    });
    expect(screen.queryByRole('button', { name: /שחזור/ })).not.toBeInTheDocument();
  });
});
