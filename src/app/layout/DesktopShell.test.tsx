import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesktopShell } from './DesktopShell';

describe('DesktopShell', () => {
  it('renders a fixed viewport shell with calendar, matrix, and notes regions', () => {
    render(
      <DesktopShell
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="今天 3 个日程 · 2 个重要任务 · 2 条便签"
        calendar={<div>calendar region</div>}
        matrix={<div>matrix region</div>}
        notes={<div>notes region</div>}
      />
    );

    expect(screen.getByText('09:41')).toBeInTheDocument();
    expect(screen.getByText('calendar region')).toBeInTheDocument();
    expect(screen.getByText('matrix region')).toBeInTheDocument();
    expect(screen.getByText('notes region')).toBeInTheDocument();
    expect(screen.getByTestId('desktop-root')).toHaveClass('h-screen', 'w-screen', 'overflow-hidden');
  });

  it('shows only the wallpaper action in the content header while foreground', () => {
    const onSetWallpaper = vi.fn();
    const { rerender } = render(
      <DesktopShell
        mode="foreground"
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        calendar={<div />}
        matrix={<div />}
        notes={<div />}
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
        calendar={<div />}
        matrix={<div />}
        notes={<div />}
      />
    );
    expect(screen.queryByRole('button', { name: '设为壁纸' })).not.toBeInTheDocument();
  });

  it('returns wallpaper mode to foreground on a double click anywhere', () => {
    const onWallpaperDoubleClick = vi.fn();
    render(
      <DesktopShell
        mode="wallpaper"
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="summary"
        calendar={<div>calendar region</div>}
        matrix={<div />}
        notes={<div />}
        onWallpaperDoubleClick={onWallpaperDoubleClick}
      />
    );

    fireEvent.doubleClick(screen.getByText('calendar region'));
    expect(onWallpaperDoubleClick).toHaveBeenCalledOnce();
  });

  it('does not inset the root from viewport edges', () => {
    render(
      <DesktopShell
        time="09:41"
        dateText="2026年7月23日 星期四"
        summary="今天 3 个日程 · 2 个重要任务 · 2 条便签"
        calendar={<div>calendar region</div>}
        matrix={<div>matrix region</div>}
        notes={<div>notes region</div>}
      />
    );

    expect(screen.getByTestId('desktop-root').className).not.toMatch(/(?:^|\s)(?:p-|sm:p-|xl:p-)/);
  });
});
