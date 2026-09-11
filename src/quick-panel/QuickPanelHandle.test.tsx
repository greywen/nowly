import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QuickPanelHandle } from './QuickPanelHandle';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

it('opens immediately when the pointer enters', () => {
  render(<QuickPanelHandle />);

  fireEvent.mouseEnter(screen.getByRole('button', { name: '打开 AI 快捷面板' }));
  expect(invoke).toHaveBeenCalledWith('open_quick_panel');
});

it('makes every handle document surface transparent', () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  render(<QuickPanelHandle />);

  expect(document.documentElement.style.backgroundColor).toBe('transparent');
  expect(document.body.style.backgroundColor).toBe('transparent');
  expect(root.style.backgroundColor).toBe('transparent');
  root.remove();
});
