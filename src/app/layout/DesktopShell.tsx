import { MonitorDown } from 'lucide-react';
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
  onWallpaperDoubleClick
}: DesktopShellProps) {
  const foreground = mode === 'foreground';

  return (
    <div
      data-testid="desktop-root"
      onDoubleClickCapture={foreground ? undefined : onWallpaperDoubleClick}
      className="h-screen w-screen overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-sky-50 text-ink"
    >
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden xl:gap-4">
        <header className="flex min-h-[50px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-end gap-3">
            <div className="text-3xl font-black leading-none tracking-[-0.04em] xl:text-5xl">{time}</div>
            <div className="min-w-0 pb-1">
              <div className="truncate text-sm font-extrabold text-slate-700 xl:text-[15px]">{dateText}</div>
              <div className="mt-1 truncate text-xs font-bold text-muted">{summary}</div>
            </div>
          </div>
          {foreground && (
            <button
              type="button"
              aria-label="设为壁纸"
              disabled={isModeSwitching}
              onClick={onSetWallpaper}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-white/75 px-3 text-sm font-black text-slate-700 shadow-sm ring-1 ring-slate-200/80 disabled:cursor-wait disabled:opacity-60"
            >
              <MonitorDown className="h-4 w-4" />
              {isModeSwitching ? '设置中' : '设为壁纸'}
            </button>
          )}
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-[minmax(620px,1.58fr)_minmax(320px,0.72fr)] gap-3 overflow-hidden xl:gap-4">
          <section className="min-h-0 overflow-hidden rounded-panel border border-slate-200/80 bg-white/75 shadow-soft backdrop-blur-xl">
            {calendar}
          </section>
          <aside className="grid min-h-0 grid-rows-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-3 overflow-hidden xl:gap-4">
            <section className="min-h-0 overflow-hidden rounded-panel border border-slate-200/80 bg-white/75 shadow-soft backdrop-blur-xl">
              {matrix}
            </section>
            <section className="min-h-0 overflow-hidden rounded-panel border border-slate-200/80 bg-white/75 shadow-soft backdrop-blur-xl">
              {notes}
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}
