import { MonitorDown, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

type DesktopShellProps = {
  mode?: 'foreground' | 'wallpaper';
  time: string;
  dateText: string;
  summary: string;
  calendar: ReactNode;
  matrix: ReactNode;
  notes: ReactNode;
  isModeSwitching?: boolean;
  onSetWallpaper?: () => void;
  onWallpaperDoubleClick?: () => void;
  onOpenSettings?: () => void;
};

export function DesktopShell({
  mode = 'foreground',
  time,
  dateText,
  summary,
  calendar,
  matrix,
  notes,
  isModeSwitching = false,
  onSetWallpaper,
  onWallpaperDoubleClick,
  onOpenSettings
}: DesktopShellProps) {
  const foreground = mode === 'foreground';

  return (
    <div
      data-testid="desktop-root"
      onDoubleClickCapture={foreground ? undefined : onWallpaperDoubleClick}
      className="app-shell"
    >
      <header className="topbar">
        <div className="date-copy">
          <strong>{dateText}</strong>
          <p>{summary}</p>
        </div>
        <div className="top-actions">
          <span className="topbar-time" aria-label={`当前时间 ${time}`}>
            {time}
          </span>
          {foreground ? <button type="button" className="btn btn-icon" aria-label="打开设置" onClick={onOpenSettings}><Settings aria-hidden="true" /></button> : null}
          {foreground ? (
            <button
              type="button"
              className="btn btn-primary"
              aria-label="设为壁纸"
              disabled={isModeSwitching}
              onClick={onSetWallpaper}
            >
              <MonitorDown aria-hidden="true" />
              {isModeSwitching ? '设置中' : '设为壁纸'}
            </button>
          ) : null}
        </div>
      </header>
      <main className="workspace">
        <section className="card calendar-card">{calendar}</section>
        <aside className="side-column">
          <section className="card priority-card">{matrix}</section>
          <section className="card notes-card">{notes}</section>
        </aside>
      </main>
    </div>
  );
}
