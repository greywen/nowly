import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScreenshotToolbar } from '../screenshot/ScreenshotToolbar';
import { setLanguage } from './index';

afterEach(() => {
  cleanup();
  setLanguage('zh');
});

it('updates screenshot labels after another window switches to English', () => {
  setLanguage('zh');
  render(<ScreenshotToolbar activeTool="select" onSelectTool={vi.fn()} onAction={vi.fn()} state={{
    selectionCrossesDisplays: false, annotationCount: 0, baseImageIsLong: false,
    captureTargetUnavailable: false, canUndo: false, canRedo: false, exporting: false
  }} />);
  expect(screen.getByRole('toolbar', { name: '截图编辑工具' })).toBeInTheDocument();
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'nowly.language', newValue: 'en' })));
  expect(screen.getByRole('toolbar', { name: 'Screenshot editing tools' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy image and finish' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '复制图片并完成' })).not.toBeInTheDocument();
});
