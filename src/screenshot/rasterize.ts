// Rasterising the annotation layer for export.
//
// §8.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md requires the
// exported pixels to match the preview. That is why the same SVG the preview draws
// is the thing rasterised here, rather than a second Canvas 2D renderer: a second
// implementation of text layout and stroke geometry would eventually disagree with
// the first, and §5.3 line 394 warns specifically against assuming two renderers
// match.
//
// The result is straight-alpha RGBA at the selection's physical pixel size, which
// is what `renderer.rs` blends over the base image.

/// Builds the SVG markup that gets rasterised.
///
/// Separated from the rasterisation so what ends up in the exported file can be
/// asserted without a real image decoder, which jsdom does not have.
export function exportMarkup(svg: SVGSVGElement, width: number, height: number): string {
  // A clone, so stripping editor-only marks cannot disturb what the user is looking
  // at.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  stripEditorOnlyMarks(clone);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  // The selection-relative positioning belongs to the preview; the export is the
  // selection itself.
  clone.removeAttribute('style');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  return new XMLSerializer().serializeToString(clone);
}

/// Serialises a live SVG element and rasterises it at its own physical size.
///
/// `width` and `height` are the selection's physical pixels, which is also the
/// SVG's viewBox, so the rasterisation is 1:1 and no scaling can shift a stroke.
export async function rasterizeAnnotations(
  svg: SVGSVGElement,
  width: number,
  height: number
): Promise<Uint8Array> {
  if (width <= 0 || height <= 0) {
    throw new Error('the selection has no area to rasterise');
  }

  const markup = exportMarkup(svg, width, height);
  // A data URL rather than a blob URL: a blob URL would taint the canvas in some
  // WebView configurations, and a tainted canvas cannot be read back.
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  const image = await loadImage(source);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('a 2D canvas context is unavailable');

  // The annotation layer is transparent where nothing is drawn, and the blend in
  // Rust relies on that alpha.
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  // A copy, because the underlying buffer belongs to the canvas.
  return new Uint8Array(data);
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('the annotation layer could not be rasterised'));
    image.src = source;
  });
}

/// Removes everything that belongs to editing rather than to the image.
///
/// Both of these are currently styled only by the app stylesheet, which does not
/// apply inside a serialised SVG, so today they would stay out of the export anyway.
/// Relying on that would be a trap: moving the mosaic's stroke to a presentation
/// attribute is a reasonable-looking change that would start baking a dashed outline
/// into every saved file. Removing them structurally makes the guarantee independent
/// of how they happen to be styled.
function stripEditorOnlyMarks(clone: SVGSVGElement): void {
  // The mosaic's real pixels are applied by `mosaic.rs` after this layer is blended,
  // so its placeholder outline must not appear in the export.
  for (const mosaic of Array.from(clone.querySelectorAll('[data-kind="mosaic"]'))) {
    mosaic.remove();
  }
  // The selected object's frame is a standalone element with no image content of
  // its own, so it is removed rather than unstyled: leaving an empty rect behind
  // would rely on a stylesheet that does not apply inside a serialised SVG.
  for (const chrome of Array.from(clone.querySelectorAll('[data-selected-for]'))) {
    chrome.remove();
  }
  // Selection chrome is editor state, not part of the picture.
  for (const selected of Array.from(
    clone.querySelectorAll('.screenshot-annotation--selected')
  )) {
    selected.classList.remove('screenshot-annotation--selected');
  }
}
