import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScrollCaptureAuxApp } from './ScrollCaptureAuxApp';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const state = { sessionId: '1', revision: 1, phase: 'prepare', width: 300, height: 0, point: [100, 100], region: { x: 0, y: 0, width: 300, height: 300 }, seams: [], reason: null };
beforeEach(() => { mocks.invoke.mockReset(); });

it('connects under StrictMode even when the first describe resolves after effect cleanup', async () => {
  const pending: Array<(value: unknown) => void> = [];
  mocks.invoke.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
  render(<StrictMode><ScrollCaptureAuxApp /></StrictMode>);
  await act(async () => { for (const resolve of pending) resolve(state); });
  expect(screen.queryByText('正在连接滚动截图…')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /开始/ })).toBeEnabled();
});
