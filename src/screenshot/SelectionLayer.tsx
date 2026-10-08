import { framePixelToCss, type FrameBox } from './frame-geometry';
import type { PixelRect, ResizeHandle } from './screenshot-model';

// The selection's visual layer: the dim outside, the border and the handles.
//
// §4.2 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: the
// unselected area is dimmed, the selection itself is never tinted, and the size
// readout sits outside the selection so it cannot cover the content.
//
// The eight handles appear once the rectangle is committed and disappear once the
// first annotation locks it (§4.2, and §5.1's scroll rule depends on the same
// lock). A handle that cannot be dragged would promise an interaction that no
// longer exists, so they are absent rather than disabled.

/// The eight handles, in the order they are drawn. Also the modifier order used by
/// `resizeSelection`, so a handle's name is its behaviour.
export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'w',
  'e',
  'sw',
  's',
  'se'
];

export type SelectionLayerProps = {
  /// The committed selection, or the rectangle being dragged.
  rect: PixelRect;
  box: FrameBox;
  /// Handles are shown only for a committed, still-adjustable rectangle.
  onResizeStart?: (handle: ResizeHandle, event: React.PointerEvent) => void;
};

export function SelectionLayer({ rect, box, onResizeStart }: SelectionLayerProps) {
  const css = framePixelToCss(rect, box);

  return (
    <div className="screenshot-selection" aria-hidden="true">
      {/* Four dim panels rather than one box-shadow, so the selection itself
          carries no tint at all: any overlay over it would shift the colours the
          magnifier reads. */}
      <div className="screenshot-selection__dim" style={{ inset: `0 0 auto 0`, height: css.top }} />
      <div
        className="screenshot-selection__dim"
        style={{ top: css.top + css.height, right: 0, bottom: 0, left: 0 }}
      />
      <div
        className="screenshot-selection__dim"
        style={{ top: css.top, left: 0, width: css.left, height: css.height }}
      />
      <div
        className="screenshot-selection__dim"
        style={{
          top: css.top,
          left: css.left + css.width,
          right: 0,
          height: css.height
        }}
      />

      <div
        className="screenshot-selection__frame"
        style={{ left: css.left, top: css.top, width: css.width, height: css.height }}
      >
        {/* Children of the frame, so each handle's percentage offsets are relative
            to the rectangle rather than to the whole overlay. They take pointer
            events even though the layer does not: a handle is the one part of this
            layer the user acts on. */}
        {onResizeStart
          ? RESIZE_HANDLES.map((handle) => (
              <div
                key={handle}
                className={`screenshot-selection__handle screenshot-selection__handle--${handle}`}
                data-handle={handle}
                onPointerDown={(event) => {
                  // The surface must not also start a new aiming drag from this
                  // press, or the rectangle would be replaced instead of resized.
                  event.stopPropagation();
                  onResizeStart(handle, event);
                }}
              />
            ))
          : null}
      </div>
    </div>
  );
}

/// The size readout, placed outside the selection so it never covers content.
export function SelectionSize({ rect, box }: { rect: PixelRect; box: FrameBox }) {
  const css = framePixelToCss(rect, box);
  // Above the selection normally, below it when there is no room, so it stays on
  // screen without moving onto the captured pixels.
  const above = css.top >= 28;

  return (
    <div
      className="screenshot-selection__size"
      style={{
        left: css.left,
        top: above ? css.top - 28 : css.top + css.height + 8
      }}
    >
      {/* Physical pixels, because that is what the exported file will contain. */}
      {rect.width} × {rect.height}
    </div>
  );
}
