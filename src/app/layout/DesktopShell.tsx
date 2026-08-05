import { LayoutGrid, MonitorDown, Settings } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { getWidgetDefinition, type WidgetId } from '../../widgets/widget-registry';
import { useModuleLayout } from '../../widgets/useModuleLayout';
import { ModuleGrid, type ModuleGridItem } from './ModuleGrid';

type DesktopShellProps = {
  mode?: 'foreground' | 'wallpaper';
  time: string;
  dateText: string;
  summary: string;
  modules: Partial<Record<WidgetId, ReactNode>>;
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
  modules,
  isModeSwitching = false,
  onSetWallpaper,
  onWallpaperDoubleClick,
  onOpenSettings
}: DesktopShellProps) {
  const foreground = mode === 'foreground';
  const { layout, reorder, cyclePreset, reset } = useModuleLayout();
  const [isEditing, setIsEditing] = useState(false);

  const items: ModuleGridItem[] = layout
    .filter((entry) => modules[entry.id] !== undefined && getWidgetDefinition(entry.id) !== undefined)
    .map((entry) => ({ id: entry.id, presetId: entry.presetId, content: modules[entry.id] }));

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
          {foreground && isEditing ? (
            <button type="button" className="btn" aria-label="重置布局" onClick={reset}>
              重置布局
            </button>
          ) : null}
          {foreground ? (
            <button
              type="button"
              className={`btn btn-icon${isEditing ? ' is-active' : ''}`}
              aria-label="编辑布局"
              aria-pressed={isEditing}
              onClick={() => setIsEditing((current) => !current)}
            >
              <LayoutGrid aria-hidden="true" />
            </button>
          ) : null}
          {foreground ? (
            <button type="button" className="btn btn-icon" aria-label="打开设置" onClick={onOpenSettings}>
              <Settings aria-hidden="true" />
            </button>
          ) : null}
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
        <ModuleGrid
          items={items}
          editing={foreground && isEditing}
          onReorder={reorder}
          onCyclePreset={cyclePreset}
        />
      </main>
    </div>
  );
}
