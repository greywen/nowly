import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AboutDialog } from './AboutDialog';
import { t } from '../i18n';
import type { UpdateCheckState } from './useUpdateCheck';

describe('AboutDialog', () => {
  it('never claims a pending update check is up to date', () => {
    render(<AboutDialog onClose={vi.fn()} />);
    expect(screen.queryByText(t('about.upToDate'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('about.noUpdates'))).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(t('about.checking'));
    expect(screen.getByRole('button', { name: t('about.storeView') })).toBeInTheDocument();
  });

  it('shows the installed version and retry after a Store error', () => {
    const update: UpdateCheckState = {
      version: { currentVersion: '1.1.11.0', distribution: 'msix' },
      status: 'error', error: 'Offline', updateAvailable: false,
      retry: vi.fn(), openStore: vi.fn(), opening: false, openError: null, openedInBrowser: false,
    };
    render(<AboutDialog onClose={vi.fn()} update={update} />);
    expect(screen.getByText('1.1.11.0')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Offline');
    expect(screen.getByRole('button', { name: t('about.retry') })).toBeInTheDocument();
    expect(screen.queryByText(t('about.upToDate'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('about.noUpdates'))).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(t('about.checkError'));
  });

  it('keeps unpackaged Store access without explanatory copy', () => {
    const update: UpdateCheckState = {
      version: { currentVersion: '0.1.5', distribution: 'unpackaged' },
      status: 'unsupported', error: null, updateAvailable: false,
      retry: vi.fn(), openStore: vi.fn(), opening: false, openError: null, openedInBrowser: false,
    };
    render(<AboutDialog onClose={vi.fn()} update={update} />);
    expect(screen.getByRole('button', { name: t('about.storeView') })).toBeInTheDocument();
    expect(screen.queryByText(t('about.storeManaged'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('about.storeSeparate'))).not.toBeInTheDocument();
  });

  it.each(['checking', 'upToDate', 'available'] as const)('shows the correct message for %s', status => {
    const update: UpdateCheckState = {
      version: { currentVersion: '1.1.11.0', distribution: 'msix' },
      status, error: null, updateAvailable: status === 'available',
      retry: vi.fn(), openStore: vi.fn(), opening: false, openError: null, openedInBrowser: false,
    };
    render(<AboutDialog onClose={vi.fn()} update={update} />);
    expect(screen.getByRole('status')).toHaveTextContent(t(status === 'checking' ? 'about.checking'
      : status === 'upToDate' ? 'about.noUpdates' : 'about.updateAvailable'));
    if (status !== 'upToDate') expect(screen.queryByText(t('about.noUpdates'))).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t(status === 'available' ? 'about.storeUpdate' : 'about.storeView') })).toBeEnabled();
  });
});
