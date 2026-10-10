// Measuring a text annotation's box.
//
// The box is what hit testing and move clamping work on, so a wrong box means a
// committed text object cannot be grabbed where it visibly is. The old estimate was
// `content.length * fontSize * 0.6`, which is wrong twice over: it bills a CJK glyph
// at 0.6em when it is a full em, and it bills a multi-line string by its total
// length instead of its widest line. "你好世界" came out roughly half its real
// width, so the right half of the text was not part of the object.
//
// The measurement is taken once, when the text is committed, and stored in the
// document. Measuring during render and writing the result back would be a document
// mutation per frame, and each one would be an undo step.

/// The face the annotation renderer draws with, per §5.2: the Nowly body font at
/// weight 500. Measuring with a different face would reintroduce the same class of
/// error the estimate had.
const FONT_WEIGHT = 500;
const LINE_HEIGHT = 1.4;

/// A canvas is reused across calls: creating one per commit is wasteful, and the
/// font string is the only thing that changes.
let measuringContext: CanvasRenderingContext2D | null | undefined;

/// The renderer inherits its family from the document, so the measurement reads it
/// back rather than naming a font.
///
/// It cannot be the literal `inherit`: a canvas font is a CSS `font` shorthand, and
/// `500 24px inherit` is invalid, so the assignment is *silently ignored* and the
/// context keeps its 10px sans-serif default. That measured 你好世界 at 40px instead
/// of 96 — the same under-measurement, just arrived at differently.
function documentFontFamily(): string {
  const family = getComputedStyle(document.body).fontFamily;
  return family && family !== 'inherit' ? family : 'sans-serif';
}

function contextFor(fontSize: number, fontFamily: string): CanvasRenderingContext2D | null {
  if (measuringContext === undefined) {
    // jsdom has no 2D context, and a headless export path may not either, so this
    // is allowed to fail and fall through to the estimate below.
    const context = document.createElement('canvas').getContext('2d') ?? null;
    // `measureText` is feature-detected rather than inferred from the context
    // existing: a stub or a partial polyfill can hand back an object without it,
    // and calling it would throw during a commit — losing the text the user typed
    // rather than merely mis-measuring it.
    measuringContext =
      context && typeof context.measureText === 'function' ? context : null;
  }
  if (!measuringContext) return null;
  measuringContext.font = `${FONT_WEIGHT} ${fontSize}px ${fontFamily}`;
  // A rejected assignment leaves the previous value, which would measure at the
  // wrong size without any error. Checked rather than assumed, because that failure
  // is invisible and produces a box the pointer cannot find the text in.
  if (!measuringContext.font.includes(`${fontSize}px`)) return null;
  return measuringContext;
}

/// Per-character width as a fraction of the font size, for the fallback path.
///
/// Full-width ranges get 1em and everything else 0.55em. This is only reached when
/// no canvas is available; it is deliberately generous for CJK rather than accurate
/// for Latin, because an under-measured box is the failure that loses the object.
function estimateWidth(line: string, fontSize: number): number {
  let width = 0;
  for (const character of line) {
    const code = character.codePointAt(0) ?? 0;
    const fullWidth =
      // CJK ideographs, kana, Hangul, and the full-width forms block.
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += fullWidth ? fontSize : fontSize * 0.55;
  }
  return width;
}

/// The box a text object occupies, in output physical pixels.
///
/// The width is the widest line's, not the whole string's: the renderer lays each
/// line out on its own baseline, so a two-line string is not twice as wide.
export function measureTextBox(
  content: string,
  fontSize: number,
  /// Injected so a test can assert the layout without depending on an installed
  /// font. Defaults to the family the renderer inherits from the document.
  fontFamily = documentFontFamily()
): { width: number; height: number } {
  const lines = content.split('\n');
  const context = contextFor(fontSize, fontFamily);
  const width = lines.reduce((widest, line) => {
    // A stub may still return something without a usable `width`, so the estimate
    // also covers a measurement that comes back as NaN or undefined.
    const measured = context ? context.measureText(line)?.width : undefined;
    return Math.max(
      widest,
      Number.isFinite(measured) ? (measured as number) : estimateWidth(line, fontSize)
    );
  }, 0);

  return {
    width: Math.ceil(width),
    // The first line occupies one font size; every line after it adds its leading.
    height: Math.ceil(fontSize + (lines.length - 1) * fontSize * LINE_HEIGHT)
  };
}

/// Resets the cached context. Only needed by tests that swap the canvas stub.
export function resetTextMeasurement(): void {
  measuringContext = undefined;
}
