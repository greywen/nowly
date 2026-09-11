import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QuickPanelHandle } from './QuickPanelHandle';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

it('opens after a deliberate 300ms hover', async () => {
  render(<QuickPanelHandle />);

  fireEvent.mouseEnter(screen.getByRole('button', { name: '打开 AI 快捷面板' }));
  await act(async () => vi.advanceTimersByTimeAsync(299));
  expect(invoke).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(invoke).toHaveBeenCalledWith('open_quick_panel');
});

it('cancels opening when the pointer leaves before the delay', async () => {
  render(<QuickPanelHandle />);

  const handle = screen.getByRole('button', { name: '打开 AI 快捷面板' });
  fireEvent.mouseEnter(handle);
  fireEvent.mouseLeave(handle);
  await act(async () => vi.advanceTimersByTimeAsync(300));

  expect(invoke).not.toHaveBeenCalled();
});