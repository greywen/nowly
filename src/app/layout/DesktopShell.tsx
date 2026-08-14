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
import { BlurControl } from '../BlurControl';
import { DEFAULT_BLUR, useBlur } from '../useBlur';
import { t } from '../../i18n';

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
  overlay?: ReactNode;
};

// The wallpaper layer sits behind the app content. It stays hidden until a
// wallpaper source is configured; for now it only anchors the stacking order
// so the blur filter can soften the modules over the desktop wallpaper.
function WallpaperLayer() {
  return <div className="wallpaper-layer" data-testid="wallpaper-layer" aria-hidden="true" hidden />;
}

export function DesktopShell({
  mode = 'foreground',
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
  onOpenSettings,
  overlay
}: DesktopShellProps) {
  const foreground = mode === 'foreground';
  const { layout, move, resize, addWidget, removeWidget, presentIds } =
    useModuleLayout(definitions);
  const { blur, setBlur } = useBlur();
  const [isEditing, setIsEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewingBlur, setPreviewingBlur] = useState(false);

  // Blur persists as a wallpaper-only look. As the wallpaper it softens the
  // whole app content, topbar included, so the modules read as a frosted layer
  // over the desktop. While the slider popover is open we also preview the blur
  // live in foreground, but only on the workspace — leaving the topbar (and the
  // slider itself) crisp so you never lose the control you're dragging.
  const blurred = blur > DEFAULT_BLUR;
  const blurFilter = `blur(${blur}px)`;
  const topbarStyle = !foreground && blurred ? { filter: blurFilter } : undefined;
  const workspaceStyle =
    (!foreground || previewingBlur) && blurred ? { filter: blurFilter } : undefined;

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
          {foreground ? (
            <BlurControl blur={blur} onChange={setBlur} onOpenChange={setPreviewingBlur} />
          ) : null}
          {foreground && isEditing ? (
            <button
              type="button"
              className="btn"
              aria-label={t('shell.addModule')}
              onClick={() => setPickerOpen(true)}
            >
              <Plus aria-hidden="true" />
              {t('shell.addModule')}
            </button>
          ) : null}
          {foreground ? (
            <button
              type="button"
              className={`btn btn-icon${isEditing ? ' is-active' : ''}`}
              aria-label={isEditing ? t('shell.finishEditing') : t('shell.editLayout')}
              aria-pressed={isEditing}
              onClick={() => setIsEditing((current) => !current)}
            >
              {isEditing ? <Check aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
            </button>
          ) : null}
          {foreground ? (
            <button type="button" className="btn btn-icon" aria-label={t('shell.openSettings')} onClick={onOpenSettings}>
              <Settings aria-hidden="true" />
            </button>
          ) : null}
          {foreground ? (
            <button
              type="button"
              className="btn btn-icon btn-primary"
              aria-label={t('shell.setWallpaper')}
              disabled={isModeSwitching}
              onClick={onSetWallpaper}
            >
              <MonitorDown aria-hidden="true" />
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

      {overlay}

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
