import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QuickPanelApp } from './QuickPanelApp';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  invoke: vi.fn(), remove: vi.fn()
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, handler) => {
  ipc.handlers.set(name, handler);
  return ipc.remove;
}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide: vi.fn() }) }));
beforeEach(() => {
  ipc.handlers.clear();
  ipc.invoke.mockReset();
  ipc.invoke.mockImplementation(async command => {
    if (command === 'quick_panel_state') return { visible: true, panel: 'ai-assistant' };
    if (command === 'assistant_get_config') return { endpoint: '', model: '', hasKey: false, permissions: { calendar: false, tasks: false, external: false } };
    if (command === 'get_app_settings') return { iconStyle: 'duotone', density: 'balanced' };
    if (command === 'quick_panel_hide') return;
    throw new Error(`Unexpected IPC ${command}`);
  });
});
it('renders a full drawer and focuses the composer without opening the main app', async () => {
  render(<QuickPanelApp />);
  expect(await screen.findByRole('heading', { name: 'AI 快捷面板' })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
  expect(screen.getByRole('region', { name: '当前聊天' })).toBeVisible();
  expect(ipc.invoke.mock.calls.some(([name]) => name === 'enter_foreground_mode')).toBe(false);
});
it('Escape hides the native window while preserving draft across visibility events', async () => {
  render(<QuickPanelApp />);
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value: '明天安排评审' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(document.querySelector('.assistant-panel')).toHaveAttribute('data-open', 'false'));
  await act(async () => ipc.handlers.get('quick-panel-open')?.({ payload: 'ai-assistant' }));
  expect(screen.getByRole('textbox')).toHaveValue('明天安排评审');
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
});
