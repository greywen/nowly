import { useTranslation } from '../i18n';
import {
  ArrowRightUp,
  Check,
  Cursor,
  Download,
  GalleryCircle,
  Pencil,
  RadialBlur,
  Stop,
  UndoLeft,
  UndoRight,
  X
} from '../components/icons';
import {
  CONTROL_LABEL_KEYS,
  isDisabled,
  SCROLL_BLOCK_KEYS,
  scrollBlockReason,
  TOOL_ORDER,
  TOOLBAR_GROUPS,
  type ActionId,
  type ToolbarState,
  type ToolId
} from './toolbar-model';

// The editing toolbar.
//
// §5.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md fixes the
// order and grouping; design.md §14 fixes 40×40 buttons with 18px icons. §2.3
// forbids toast, banner and spinner here, so a blocked action explains itself
// through its own tooltip and accessible description instead.

export type ScreenshotToolbarProps = {
  activeTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  onAction: (action: ActionId) => void;
  state: ToolbarState;
};

// Solar icon components for each tool and action.
const ICONS: Record<ToolId | ActionId, React.ComponentType<{ size?: number }>> = {
  select: Cursor,
  rect: Stop,
  ellipse: GalleryCircle,
  arrow: ArrowRightUp,
  pen: Pencil,
  text: () => <span aria-hidden="true">T</span>, // No text icon in Solar, use glyph
  mosaic: RadialBlur,
  undo: UndoLeft,
  redo: UndoRight,
  scroll: () => <span aria-hidden="true">↕</span>, // No scroll icon, use glyph
  save: Download,
  cancel: X,
  done: Check
};

function isTool(control: ToolId | ActionId): control is ToolId {
  return (TOOL_ORDER as readonly string[]).includes(control);
}

export function ScreenshotToolbar({
  activeTool,
  onSelectTool,
  onAction,
  state
}: ScreenshotToolbarProps) {
  const { t } = useTranslation();
  const blocked = scrollBlockReason(state);

  return (
    // A toolbar role with a label, so the whole group is announced rather than
    // thirteen loose buttons.
    <div className="screenshot-toolbar" role="toolbar" aria-label={t('screenshot.toolbarLabel')}>
      {TOOLBAR_GROUPS.map((group, index) => (
        <div className="screenshot-toolbar__group" key={index}>
          {group.map((control) => {
            const label = t(CONTROL_LABEL_KEYS[control]);
            const disabled = isDisabled(control, state);
            // The reason travels with the control itself: §2.3 rules out a toast
            // or banner for this.
            const reason =
              control === 'scroll' && blocked ? t(SCROLL_BLOCK_KEYS[blocked]) : null;
            const tool = isTool(control);

            return (
              <button
                key={control}
                type="button"
                className="screenshot-toolbar__button"
                // A tool is a toggle, an action is not, so only tools carry a
                // pressed state.
                aria-pressed={tool ? control === activeTool : undefined}
                aria-label={label}
                aria-describedby={reason ? `screenshot-reason-${control}` : undefined}
                // Both, because a native tooltip does not reach a screen reader
                // and an aria description does not show on hover.
                title={reason ? `${label} — ${reason}` : label}
                disabled={disabled}
                onClick={() => (tool ? onSelectTool(control) : onAction(control as ActionId))}
              >
                {(() => {
                  const IconComponent = ICONS[control];
                  return <IconComponent size={18} />;
                })()}
                {reason ? (
                  <span id={`screenshot-reason-${control}`} className="visually-hidden">
                    {reason}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
