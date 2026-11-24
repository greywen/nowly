import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import type { VoiceModelProgress, VoiceSettings, VoiceSettingsClient } from '../voice/voice-settings';
import { VoiceSettingsPanel } from './VoiceSettingsPanel';

const progress = vi.hoisted(() => ({ emit: null as null | ((payload: VoiceModelProgress) => void) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: (event: { payload: VoiceModelProgress }) => void) => {
    progress.emit = payload => handler({ payload });
    return () => undefined;
  })
}));

const base: VoiceSettings = { enabled: false, holdKey: 'Ctrl+Super', device: null, language: 'auto' };

function client(overrides: Partial<VoiceSettingsClient> = {}) {
  return {
    get: vi.fn(async () => base),
    save: vi.fn(async (value: VoiceSettings) => value),
    devices: vi.fn(async () => ['USB Mic']),
    modelStatus: vi.fn(async () => ({ installed: false, totalBytes: 240_000_000 })),
    download: vi.fn(async () => ({ installed: true, totalBytes: 240_000_000 })),
    cancelDownload: vi.fn(async () => undefined),
    deleteModel: vi.fn(async () => ({ installed: false, totalBytes: 240_000_000 })),
    recording: vi.fn(async () => undefined),
    ...overrides
  } satisfies VoiceSettingsClient;
}

describe('VoiceSettingsPanel', () => {
  beforeEach(() => { progress.emit = null; });

  it('saves each change and rolls back a rejected hold key', async () => {
    const api = client({
      save: vi.fn(async (value: VoiceSettings) => {
        if (value.holdKey === 'Ctrl+Alt+A') throw { code: 'validation', field: 'holdKey', message: 'taken' };
        return value;
      })
    });
    const user = userEvent.setup();
    render(<VoiceSettingsPanel client={api} />);
    const enabled = await screen.findByRole('checkbox', { name: t('settings.voiceEnabled') });
    await waitFor(() => expect(enabled).toBeEnabled());
    await user.click(enabled);
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ ...base, enabled: true }));
    expect(screen.getByText(t('settings.voiceModelRequired'))).toBeVisible();

    const key = screen.getByLabelText(t('settings.voiceHoldKey'));
    fireEvent.focus(key);
    fireEvent.keyDown(key, { key: 'Control', code: 'ControlLeft' });
    fireEvent.keyDown(key, { key: 'Alt', code: 'AltLeft' });
    fireEvent.keyDown(key, { key: 'a', code: 'KeyA' });
    fireEvent.keyUp(key, { key: 'a', code: 'KeyA' });
    expect(await screen.findByRole('alert')).toHaveTextContent(t('settings.voiceHoldKeyRejected'));
    expect(key).toHaveValue('Ctrl+Win');
  });

  it('records a modifier-only hold on the first release and pauses the current one meanwhile', async () => {
    const api = client();
    render(<VoiceSettingsPanel client={api} takenShortcuts={['Ctrl+Alt+A']} />);
    const key = await screen.findByLabelText(t('settings.voiceHoldKey'));
    await waitFor(() => expect(key).toBeEnabled());
    fireEvent.focus(key);
    expect(api.recording).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(key, { key: 'Control', code: 'ControlLeft' });
    fireEvent.keyUp(key, { key: 'Control', code: 'ControlLeft' });
    expect(screen.getByRole('alert')).toHaveTextContent(t('settings.voiceHoldKeyInvalid'));

    fireEvent.keyDown(key, { key: 'Control', code: 'ControlLeft' });
    fireEvent.keyDown(key, { key: 'Alt', code: 'AltLeft' });
    fireEvent.keyDown(key, { key: 'a', code: 'KeyA' });
    fireEvent.keyUp(key, { key: 'a', code: 'KeyA' });
    expect(screen.getByRole('alert')).toHaveTextContent(t('settings.shortcutDuplicate'));

    fireEvent.keyDown(key, { key: 'Control', code: 'ControlLeft' });
    fireEvent.keyDown(key, { key: 'Shift', code: 'ShiftLeft' });
    fireEvent.keyUp(key, { key: 'Shift', code: 'ShiftLeft' });
    fireEvent.keyUp(key, { key: 'Control', code: 'ControlLeft' });
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ ...base, holdKey: 'Ctrl+Shift' }));
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(key).toHaveValue('Ctrl+Shift');
    fireEvent.blur(key);
    expect(api.recording).toHaveBeenLastCalledWith(false);
  });

  it('shows download progress, can cancel quietly, and deletes an installed model', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const api = client({
      download: vi.fn(() => new Promise<never>((_resolve, reject) => { finish = reject; })),
      cancelDownload: vi.fn(async () => finish({ code: 'conflict', message: 'cancelled' }))
    });
    const user = userEvent.setup();
    const { unmount } = render(<VoiceSettingsPanel client={api} />);
    await user.click(await screen.findByRole('button', { name: t('settings.voiceModelDownload') }));
    act(() => progress.emit?.({ done: 60, total: 240 }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText(t('settings.voiceModelDownloading', { percent: 25 }))).toBeVisible();
    await user.click(screen.getByRole('button', { name: t('common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();

    const installed = client({ modelStatus: vi.fn(async () => ({ installed: true, totalBytes: 240_000_000 })) });
    render(<VoiceSettingsPanel client={installed} />);
    expect(await screen.findByText(t('settings.voiceModelInstalled', { size: '240 MB' }))).toBeVisible();
    await user.click(screen.getByRole('button', { name: t('settings.voiceModelDelete') }));
    expect(await screen.findByText(t('settings.voiceModelMissing', { size: '240 MB' }))).toBeVisible();
  });

  it('focuses the group for each request from the Bar', async () => {
    const { rerender } = render(<VoiceSettingsPanel client={client()} focusRequest={1} />);
    const group = await screen.findByRole('group', { name: t('settings.voiceTitle') });
    await waitFor(() => expect(group).toHaveFocus());
    (document.activeElement as HTMLElement).blur();
    rerender(<VoiceSettingsPanel client={client()} focusRequest={2} />);
    await waitFor(() => expect(screen.getByRole('group', { name: t('settings.voiceTitle') })).toHaveFocus());
  });
});
