import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

const mocks = vi.hoisted(() => ({
  deploySharePointJob: vi.fn(),
}));

vi.mock('./sharepointDeploymentEngine.js', () => ({
  deploySharePointJob: mocks.deploySharePointJob,
}));

import SharePointDeploymentCoordinator from './SharePointDeploymentCoordinator.jsx';

const candidate = {
  id: 'run-1',
  attempt: 1,
  state: 'READY_FOR_SHAREPOINT',
  progress: 35,
  currentStage: 'BROWSER_ACTIVATE',
  site: { name: 'Schedule A', host: 'portal.army.idf' },
};

describe('deployment notification dismissal', () => {
  beforeEach(() => {
    mocks.deploySharePointJob.mockReset();
    vi.spyOn(api, 'runs').mockResolvedValue([candidate]);
  });

  it('manually closes a success notification without cancelling or mutating the completed Run', async () => {
    mocks.deploySharePointJob.mockResolvedValue({
      finalUrl: 'https://portal.army.idf/sites/schedule/siteDB1/dist/index.html',
    });

    render(<SharePointDeploymentCoordinator />);

    expect(await screen.findByText('פריסת SharePoint הושלמה')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'סגור התראת פריסה' }));
    await waitFor(() => expect(screen.queryByText('פריסת SharePoint הושלמה')).not.toBeInTheDocument());
    expect(mocks.deploySharePointJob).toHaveBeenCalledTimes(1);
  });

  it('offers the same accessible manual close action for a failure notification', async () => {
    mocks.deploySharePointJob.mockRejectedValue(new Error('SharePoint unavailable'));

    render(<SharePointDeploymentCoordinator />);

    expect(await screen.findByRole('alert')).toHaveTextContent('SharePoint unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'סגור התראת פריסה' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('shows a retried attempt even when the previous attempt notification was dismissed', async () => {
    mocks.deploySharePointJob.mockResolvedValue({
      finalUrl: 'https://portal.army.idf/sites/schedule/siteDB1/dist/index.html',
    });
    render(<SharePointDeploymentCoordinator />);

    expect(await screen.findByText('פריסת SharePoint הושלמה')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'סגור התראת פריסה' }));
    vi.mocked(api.runs).mockResolvedValue([{ ...candidate, attempt: 2 }]);

    await waitFor(
      () => expect(mocks.deploySharePointJob).toHaveBeenCalledTimes(2),
      { timeout: 4000 },
    );
    expect(await screen.findByText('פריסת SharePoint הושלמה')).toBeInTheDocument();
  });
});
