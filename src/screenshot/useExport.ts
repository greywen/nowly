import { invoke } from '@tauri-apps/api/core';
import { useCallback, useRef, useState } from 'react';
import type { Annotation, AnnotationDocument } from './annotation-document';
import { toVirtualDesktop, type DisplayOrigin } from './frame-geometry';
import { rasterizeAnnotations } from './rasterize';
import type { PixelRect } from './screenshot-model';

const PRIMARY_ORIGIN: DisplayOrigin = { x: 0, y: 0 };

// Running an export from the overlay.
//
// §8.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: the version
// is frozen for the duration, the finishing controls are disabled, a static status
// is shown, and a failure keeps the session with every annotation intact.
//
// The two invokes are deliberate. The annotation pixels go over a raw binary body
// because §9 line 393 forbids pushing them through a large Base64/JSON invoke; the
// geometry goes as JSON. Staging first also means the version recorded with the
// pixels and the version asserted at export time come from different moments, which
// is what makes the staleness check real.

export type ExportState =
  | { status: 'idle' }
  | { status: 'copying' }
  | { status: 'saving' }
  /// The message sits next to the control that failed, per §8.1. Never a toast.
  /// `message` is already user-facing text; `fallbackKey` is set instead when the
  /// failure was local and has no localised message of its own.
  | { status: 'failed'; message: string | null; fallbackKey: string | null };

/// Rust rejections arrive as a serialised `CommandError`, whose message is already
/// localised and phrased per §8.3. Anything else is a local failure whose message is
/// developer-facing English, so it must not be shown to the user.
function describeFailure(
  error: unknown,
  fallbackKey: string
): { message: string | null; fallbackKey: string | null } {
  if (
    typeof error === 'object' &&
    error !== null &&
    !(error instanceof Error) &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return { message: (error as { message: string }).message, fallbackKey: null };
  }
  return { message: null, fallbackKey };
}

export type ExportControls = {
  state: ExportState;
  copy: () => Promise<void>;
  save: () => Promise<void>;
  dismissError: () => void;
};

/// Mosaics are exported as geometry, not pixels: `mosaic.rs` is the only
/// implementation, so the preview and the file cannot disagree.
///
/// One brush stroke is many regions: the stroke was already reduced to
/// block-aligned cells when it was committed, and each cell is sent as its own
/// region. The object's own bounding box is never sent, because it covers ground
/// the brush never touched.
function mosaicRegions(objects: readonly Annotation[], selection: PixelRect) {
  return objects
    .filter((object): object is Extract<Annotation, { kind: 'mosaic' }> => object.kind === 'mosaic')
    .flatMap((object) =>
      object.blocks.map((block) => ({
        // Selection-local, which is the coordinate space the renderer works in.
        x: block.x - selection.x,
        y: block.y - selection.y,
        width: block.width,
        height: block.height,
        blockSize: object.blockSize
      }))
    );
}

/// Everything except the mosaics is drawn into the rasterised overlay.
function hasDrawnAnnotations(objects: readonly Annotation[]): boolean {
  return objects.some((object) => object.kind !== 'mosaic');
}

export function useExport(
  doc: AnnotationDocument,
  selection: PixelRect | null,
  /// The live annotation SVG, rasterised as-is so the export matches the preview.
  annotationSvg: () => SVGSVGElement | null,
  origin: DisplayOrigin = PRIMARY_ORIGIN
): ExportControls {
  const [state, setState] = useState<ExportState>({ status: 'idle' });
  const busyRef = useRef(false);

  /// Both exports build the same thing; only the last step differs. Sharing it keeps
  /// the file and the clipboard from drifting apart, which §8.1 requires.
  const run = useCallback(
    async (
      kind: 'copying' | 'saving',
      finish: (geometry: Record<string, unknown>) => Promise<unknown>
    ) => {
      if (!selection || busyRef.current) return;
      // Pointer and keyboard completion may arrive before React renders the
      // disabled controls. Claim the output operation synchronously.
      busyRef.current = true;
      setState({ status: kind });

      // The version this export is for. Every committed transaction lengthens the
      // undo stack, so its depth identifies the document state.
      const version = doc.past.length;
      const mosaics = mosaicRegions(doc.objects, selection);
      const needsOverlay = hasDrawnAnnotations(doc.objects);

      try {
        if (needsOverlay) {
          const svg = annotationSvg();
          if (!svg) throw new Error('the annotation layer is not rendered');
          const rgba = await rasterizeAnnotations(svg, selection.width, selection.height);
          // The raw body carries the pixels; the headers carry the geometry, because a
          // command taking a raw body cannot also take named arguments.
          await invoke('stage_capture_overlay', rgba, {
            headers: {
              'x-overlay-version': String(version),
              'x-overlay-width': String(selection.width),
              'x-overlay-height': String(selection.height)
            }
          });
        }

        await finish({
          ...toVirtualDesktop(selection, origin),
          width: selection.width,
          height: selection.height,
          mosaics,
          version,
          hasOverlay: needsOverlay
        });
        // On success the Rust side closes the session, so this window is going away.
        // A cancelled save dialog returns without closing it, and the state below
        // returns to idle so the controls come back.
        setState({ status: 'idle' });
      } catch (error) {
        setState({
          status: 'failed',
          ...describeFailure(
            error,
            kind === 'copying' ? 'screenshot.export.copyFailed' : 'screenshot.export.saveFailed'
          )
        });
      } finally {
        busyRef.current = false;
      }
    },
    [doc, selection, origin.x, origin.y, annotationSvg]
  );

  const copy = useCallback(
    () =>
      run('copying', (geometry) => invoke('copy_capture_to_clipboard', { geometry })),
    [run]
  );

  const save = useCallback(
    () => run('saving', (geometry) => invoke('save_capture_to_file', { geometry })),
    [run]
  );

  const dismissError = useCallback(() => setState({ status: 'idle' }), []);

  return { state, copy, save, dismissError };
}
