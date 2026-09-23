import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddSiteModal } from './App.jsx';

/**
 * SharePoint hosting for a Mongo target is allocated by the server unless the
 * operator deliberately chooses it. The form keeps default folder names in
 * state, so sending them unconditionally would look like an explicit choice and
 * make the SECOND Mongo site in the same Web collide on the physical target.
 */
describe('AddSiteModal — Mongo hosting choice', () => {
  const renderModal = (backendMode) => {
    const onSave = vi.fn();
    render(
      <AddSiteModal
        backendMode={backendMode}
        hosts={['portal.army.idf']}
        releases={[]}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    return onSave;
  };

  const submit = () => fireEvent.click(screen.getByRole('button', { name: /צור והתקן|הוסף למעקב/ }));

  // The hosting controls live in the collapsed advanced section; role queries
  // filter out content inside a closed <details> as inaccessible.
  const openAdvanced = () => {
    const details = document.querySelector('details');
    if (details) details.open = true;
  };

  it('omits the hosting pair for Mongo so the server allocates it', () => {
    const onSave = renderModal('mongo');
    submit();
    const payload = onSave.mock.calls[0][0];
    expect(payload).not.toHaveProperty('siteDbFolder');
    expect(payload).not.toHaveProperty('usersDbFolder');
    expect(payload.storageBackend).toBe('mongo');
  });

  it('sends both libraries once the operator opts into choosing them', () => {
    const onSave = renderModal('mongo');
    openAdvanced();
    fireEvent.click(screen.getByRole('checkbox', { name: /בחירת ספריות אירוח/ }));
    fireEvent.change(screen.getByLabelText('ספריית האתר'), { target: { value: 'chosenSite' } });
    fireEvent.change(screen.getByLabelText('ספריית משתמשים'), { target: { value: 'chosenUsers' } });
    submit();
    const payload = onSave.mock.calls[0][0];
    expect(payload.siteDbFolder).toBe('chosenSite');
    expect(payload.usersDbFolder).toBe('chosenUsers');
  });

  it('does not offer the opt-in for TXT, which always names its libraries', () => {
    renderModal('txt');
    openAdvanced();
    expect(screen.queryByRole('checkbox', { name: /בחירת ספריות אירוח/ })).toBeNull();
    expect(screen.getByLabelText('ספריית האתר')).toBeInTheDocument();
    expect(screen.getByLabelText('ספריית משתמשים')).toBeInTheDocument();
  });

  it('never lets the browser choose the Mongo data identity', () => {
    const onSave = renderModal('mongo');
    submit();
    const payload = onSave.mock.calls[0][0];
    expect(payload).not.toHaveProperty('builderSiteId');
    expect(payload).not.toHaveProperty('backendApiUrl');
  });
});
