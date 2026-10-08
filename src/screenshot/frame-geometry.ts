// Mapping between the overlay's CSS pixels and the frame's physical pixels.
//
// §4.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md requires
// the selection to be expressed in physical pixels, but pointer events arrive in
// CSS pixels. On a 150% display those differ by 1.5×, so every pointer position
// has to be converted through the rendered box, not assumed to be 1:1.
//
// The overlay window covers exactly one display's physical rectangle, and the
// frame `<img>` fills the window, so the ratio is `frame.width / renderedWidth`.
// Reading it from the rendered box rather than from a scale factor means a
// rounded window size cannot drift from the image.

export type FrameBox = {
  /// The frame's intrinsic size, in physical pixels.
  frameWidth: number;
  frameHeight: number;
  /// The rendered size of the frame element, in CSS pixels.
  renderedWidth: number;
  renderedHeight: number;
  /// The rendered box's origin in the coordinate space the pointer reports.
  offsetX: number;
  offsetY: number;
};

/// The display's physical origin on the virtual desktop, so a selection can be
/// reported in virtual-desktop coordinates rather than per-display ones.
export type DisplayOrigin = { x: number; y: number };

/// Converts a pointer position to a physical pixel inside the frame.
///
/// Returns `null` when the pointer is outside the rendered frame: §5.2 forbids
/// reading a pixel outside the authorised area, so an out-of-bounds pointer has no
/// pixel rather than a clamped one.
export function pointerToFramePixel(
  pointer: { x: number; y: number },
  box: FrameBox
): { x: number; y: number } | null {
  if (box.renderedWidth <= 0 || box.renderedHeight <= 0) return null;

  const localX = pointer.x - box.offsetX;
  const localY = pointer.y - box.offsetY;
  if (localX < 0 || localY < 0 || localX >= box.renderedWidth || localY >= box.renderedHeight) {
    return null;
  }

  // Floor, so a pointer anywhere inside a physical pixel names that pixel. The
  // final `min` guards the bottom-right edge against a rounding overshoot.
  const x = Math.min(
    box.frameWidth - 1,
    Math.floor((localX / box.renderedWidth) * box.frameWidth)
  );
  const y = Math.min(
    box.frameHeight - 1,
    Math.floor((localY / box.renderedHeight) * box.frameHeight)
  );
  return { x, y };
}

/// Converts a physical pixel rectangle back to CSS pixels for rendering.
///
/// Used to draw the selection and the handles over the frame, so it must be the
/// exact inverse scale of `pointerToFramePixel`; otherwise the drawn rectangle
/// would drift from the pixels that will actually be exported.
export function framePixelToCss(
  rect: { x: number; y: number; width: number; height: number },
  box: FrameBox
): { left: number; top: number; width: number; height: number } {
  const scaleX = box.renderedWidth / box.frameWidth;
  const scaleY = box.renderedHeight / box.frameHeight;
  return {
    left: rect.x * scaleX,
    top: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  };
}

/// Moves a frame-local pixel into virtual-desktop coordinates.
export function toVirtualDesktop(
  pixel: { x: number; y: number },
  origin: DisplayOrigin
): { x: number; y: number } {
  return { x: origin.x + pixel.x, y: origin.y + pixel.y };
}

/// Reads the frame box from a rendered image element.
export function frameBoxFromElement(image: HTMLImageElement): FrameBox {
  const rect = image.getBoundingClientRect();
  return {
    frameWidth: image.naturalWidth,
    frameHeight: image.naturalHeight,
    renderedWidth: rect.width,
    renderedHeight: rect.height,
    offsetX: rect.left,
    offsetY: rect.top
  };
}
