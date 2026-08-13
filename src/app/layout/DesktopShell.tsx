import { Check, LayoutGrid, MonitorDown, Plus, Settings } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  builtinDefinitions,
  getWidgetDefinition,
  type WidgetDefinition,
  type WidgetId
} from '../../widgets/widget-registry';
import type {
  SandboxExtension,
  SandboxExtensionDraft
} from '../../data/nowly-repository';
import { useModuleLayout } from '../../widgets/useModuleLayout';
import { TemplatePickerDialog } from '../../widgets/TemplatePickerDialog';
import { ModuleGrid, type ModuleGridItem } from './ModuleGrid';
import { TransparencyControl } from '../TransparencyControl';
import { DEFAULT_OPACITY, useTransparency } from '../useTransparency';

type DesktopShellProps = {
  mode?: 'foreground' | 'wallpaper';
  time: string;
  dateText: string;
  summary: string;
  modules: Partial<Record<WidgetId, ReactNode>>;
  definitions?: WidgetDefinition[];
  sandboxExtensions?: SandboxExtension[];
  onInstallExtension?: (draft: SandboxExtensionDraft) => Promise<unknown>;
  onUninstallExtension?: (id: string) => Promise<unknown>;
  isModeSwitching?: boolean;
  onSetWallpaper?: () => void;
  onWallpaperDoubleClick?: () => void;
  onOpenSettings?: () => void;
};

// The wallpaper layer sits behind the app content. It stays hidden until a
// wallpaper source is configured; for now it only anchors the stacking order
// so the transparency layer can reveal the shell background beneath modules.
function WallpaperLayer() {
  return <div className="wallpaper-layer" data-testid="wallpaper-layer" aria-hidden="true" hidden />;
}

export function DesktopShell({
  mode = 'foreground',
  time,
  dateText,
  summary,
  modules,
  definitions = builtinDefinitions,
  sandboxExtensions = [],
  onInstallExtension,
  onUninstallExtension,
  isModeSwitching = false,
  onSetWallpaper,
  onWallpaperDoubleClick,
  onOpenSettings
}: DesktopShellProps) {
  const foreground = mode === 'foreground';
  const { layout, move, resize, addWidget, removeWidget, presentIds } =
    useModuleLayout(definitions);
  const { opacity, setOpacity } = useTransparency();
  const [isEditing, setIsEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewingTransparency, setPreviewingTransparency] = useState(false);

  // Transparency persists as a wallpaper-only look. As the wallpaper it fades
  // the whole app content, topbar included, so the wallpaper shows through
  // everything. While the slider popover is open we also preview the fade live
  // in foreground, but only on the workspace — leaving the topbar (and the
  // slider itself) fully usable so you never lose the control you're dragging.
  const faded = opacity < DEFAULT_OPACITY;
  const topbarStyle = !foreground && faded ? { opacity } : undefined;
  const workspaceStyle =
    (!foreground || previewingTransparency) && faded ? { opacity } : undefined;

  const items: ModuleGridItem[] = layout
    .filter(
      (entry) => modules[entry.id] !== undefined && getWidgetDefinition(entry.id, definitions) !== undefined
    )
    .map((entry) => ({
      id: entry.id,
      rect: { x: entry.x, y: entry.y, w: entry.w, h: entry.h },
      content: modules[entry.id]
    }));

  return (
    <div
      data-testid="desktop-root"
      onDoubleClickCapture={foreground ? undefined : onWallpaperDoubleClick}
      className="app-shell"
    >
      <WallpaperLayer />
      <header className="topbar" style={topbarStyle}>
        <div className="date-copy">
          <strong>{dateText}</strong>
          <p>{summary}</p>
        </div>
        <div className="top-actions">
          <span className="topbar-time" aria-label={`当前时间 ${time}`}>
            {time}
          </span>
          {foreground ? (
            <TransparencyControl opacity={opacity} onChange={setOpacity} onOpenChange={setPreviewingTransparency} />
          ) : null}
          {foreground && isEditing ? (
            <button
              type="button"
              className="btn"
              aria-label="添加模块"
              onClick={() => setPickerOpen(true)}
            >
              <Plus aria-hidden="true" />
              添加模块
            </button>
          ) : null}
          {foreground ? (
            <button
              type="button"
              className={`btn btn-icon${isEditing ? ' is-active' : ''}`}
              aria-label={isEditing ? '完成编辑' : '编辑布局'}
              aria-pressed={isEditing}
              onClick={() => setIsEditing((current) => !current)}
            >
              {isEditing ? <Check aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
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
      <main className="workspace" style={workspaceStyle}>
        <ModuleGrid
          items={items}
          editing={foreground && isEditing}
          definitions={definitions}
          onMove={move}
          onResize={resize}
          onRemove={removeWidget}
        />
      </main>

      {foreground && pickerOpen ? (
        <TemplatePickerDialog
          presentIds={presentIds}
          sandboxExtensions={sandboxExtensions}
          onClose={() => setPickerOpen(false)}
          onAdd={(id) => addWidget(id)}
          onRemove={(id) => removeWidget(id)}
          onInstallExtension={(draft) => onInstallExtension?.(draft) ?? Promise.resolve()}
          onUninstallExtension={(extension) => void onUninstallExtension?.(extension.id)}
        />
      ) : null}
    </div>
  );
}
