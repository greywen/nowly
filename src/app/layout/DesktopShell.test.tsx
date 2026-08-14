import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { WidgetId } from '../../widgets/widget-registry';
import { DesktopShell } from './DesktopShell';

// useModuleLayout loads the layout from the repository via the Tauri bridge.
// Return the default built-in layout so calendar/matrix/notes render.
const defaultEntries = [
  { id: 'calendar', x: 0, y: 0, w: 7, h: 8 },
  { id: 'matrix', x: 7, y: 0, w: 5, h: 5 },
  { id: 'notes', x: 7, y: 5, w: 5, h: 3 }
];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((command: string, args?: { layout?: unknown }) =>
    command === 'save_module_layout' ? Promise.resolve(args?.layout ?? []) : Promise.resolve(defaultEntries)
  )
}));

function modules(overrides: Partial<Record<WidgetId, ReactNode>> = {}): Partial<Record<WidgetId, ReactNode>> {
  return {
    calendar: <div>calendar region</div>,
    matrix: <div>matrix region</div>,
    notes: <div>notes region</div>,
    ...overrides
  };
}

describe('DesktopShell', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders a fixed viewport shell with calendar, matrix, and notes regions', () => {
    render(
      <DesktopShell
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="今天 3 个日程 · 2 个重要任务 · 2 条便签"
        modules={modules()}
      />
    );

    expect(screen.getByText('2026年7月23日 星期四')).toBeInTheDocument();
    expect(screen.getByText('calendar region')).toBeInTheDocument();
    expect(screen.getByText('matrix region')).toBeInTheDocument();
    expect(screen.getByText('notes region')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-root')).toHaveClass('app-shell');
  });

  it('uses the approved single-screen Good shell without legacy visual effects', () => {
    render(
      <DesktopShell
        time="09:41"
        dateText="2026 年 7 月 23 日，星期四"
        summary="今天暂无日程 · 暂无重要任务 · 暂无便签"
        modules={modules()}
      />
    );

    const root = screen.getByTestId('desktop-root');
    expect(root).toHaveClass('app-shell');
    expect(root.className).not.toMatch(/gradient|backdrop|shadow-soft/);
    expect(screen.getByRole('banner')).toHaveClass('topbar');
    expect(screen.getByRole('main')).toHaveClass('workspace');
  });

  it('shows only the wallpaper action in the content header while foreground', () => {
    const onSetWallpaper = vi.fn();
    const { rerender } = render(
      <DesktopShell
        mode="foreground"
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={modules()}
        onSetWallpaper={onSetWallpaper}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '设为壁纸' }));
    expect(onSetWallpaper).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '最小化' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '最大化或还原' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭到托盘' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('window-titlebar')).not.toBeInTheDocument();

    rerender(
      <DesktopShell
        mode="wallpaper"
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={modules()}
      />
    );
    expect(screen.queryByRole('button', { name: '设为壁纸' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑布局' })).not.toBeInTheDocument();
  });

  it('returns wallpaper mode to foreground on a double click anywhere', () => {
    const onWallpaperDoubleClick = vi.fn();
    render(
      <DesktopShell
        mode="wallpaper"
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={modules()}
        onWallpaperDoubleClick={onWallpaperDoubleClick}
      />
    );

    fireEvent.doubleClick(screen.getByText('calendar region'));
    expect(onWallpaperDoubleClick).toHaveBeenCalledOnce();
  });

  it('blurs the whole app content only while running as the wallpaper', () => {
    localStorage.setItem('nowly:page-blur', '8');
    const { rerender } = render(
      <DesktopShell
        mode="foreground"
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={modules()}
      />
    );

    // Foreground only records the preference; content stays crisp.
    expect(screen.getByRole('banner').style.filter).toBe('');
    expect(screen.getByRole('main').style.filter).toBe('');

    rerender(
      <DesktopShell
        mode="wallpaper"
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={modules()}
      />
    );

    // Wallpaper mode blurs the topbar and workspace together.
    expect(screen.getByRole('banner').style.filter).toBe('blur(8px)');
    expect(screen.getByRole('main').style.filter).toBe('blur(8px)');
  });

  it('previews the blur live on the workspace while the slider is open in foreground', () => {
    localStorage.setItem('nowly:page-blur', '8');
    render(
      <DesktopShell
        mode="foreground"
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={modules()}
      />
    );

    // Opening the slider previews the blur on the workspace, but the topbar
    // stays crisp so the control itself remains usable.
    fireEvent.click(screen.getByRole('button', { name: '调整模糊' }));
    expect(screen.getByRole('main').style.filter).toBe('blur(8px)');
    expect(screen.getByRole('banner').style.filter).toBe('');
  });

  it('does not inset the root from viewport edges', () => {
    render(
      <DesktopShell
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="今天 3 个日程 · 2 个重要任务 · 2 条便签"
        modules={modules()}
      />
    );

    expect(screen.getByTestId('desktop-root').className).not.toMatch(/(?:^|\s)(?:p-|sm:p-|xl:p-)/);
  });

  it('toggles edit mode to reveal drag and resize handles without a reset control', () => {
    render(
      <DesktopShell
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={modules()}
      />
    );

    expect(screen.queryAllByTestId('module-frame-handle')).toHaveLength(0);
    expect(screen.queryAllByTestId('module-frame-resize')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '重置布局' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '编辑布局' }));

    expect(screen.getAllByTestId('module-frame-handle')).toHaveLength(3);
    expect(screen.getAllByTestId('module-frame-resize')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '添加模块' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重置布局' })).not.toBeInTheDocument();
  });

  it('leaves edit mode and hides the editing affordances again', () => {
    render(
      <DesktopShell
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={modules()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑布局' }));
    expect(screen.getAllByTestId('module-frame-resize')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: '完成编辑' }));
    expect(screen.queryAllByTestId('module-frame-resize')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '重置布局' })).not.toBeInTheDocument();
  });

  it('renders only the modules provided in the modules map', () => {
    render(
      <DesktopShell
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        modules={{ calendar: <div>calendar region</div> }}
      />
    );

    expect(screen.getByText('calendar region')).toBeInTheDocument();
    expect(screen.queryByText('matrix region')).not.toBeInTheDocument();
    expect(screen.queryByText('notes region')).not.toBeInTheDocument();
  });
});
