import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import type { Annotation } from './annotation-document';
import { toVirtualDesktop, type DisplayOrigin } from './frame-geometry';
import type { PixelRect } from './screenshot-model';

/// The same local scheme the base frames use, per §9.
const FRAME_SCHEME = 'nowly-frame';
const PRIMARY_ORIGIN: DisplayOrigin = { x: 0, y: 0 };

// Showing real mosaic pixels in the preview.
//
// §5.3 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md requires the
// preview to match the export per channel. An outline where a mosaic will be is worse
// than nothing: the user reads it as covered and exports an image that still contains
// what they meant to hide.
//
// `mosaic.rs` is the only implementation of the algorithm, so this asks Rust to
// render the selection and displays the result. It runs when the mosaic set changes,
// which is a discrete user action, not per pointer move.

export type MosaicPreview = {
  /// The URL to show, or null when there are no mosaics to render.
  url: string | null;
};

type PreviewPlan = { path: string; width: number; height: number };

/// A stable description of the mosaic set, so the effect runs when the mosaics change
/// and not when an unrelated annotation is added.
///
/// A brush stroke's blocks are what gets rendered, so they are what the key
/// describes. The object's own bounding box is not in the key: two different strokes
/// can share a box while covering different cells.
function mosaicKey(objects: readonly Annotation[], selection: PixelRect | null): string {
  if (!selection) return '';
  const parts = objects
    .filter((object): object is Extract<Annotation, { kind: 'mosaic' }> => object.kind === 'mosaic')
    .map(
      (object) =>
        `${object.blockSize}:${object.blocks
          .map(
            (block) =>
              `${block.x - selection.x},${block.y - selection.y},${block.width},${block.height}`
          )
          .join('_')}`
    )
    .filter((part) => !part.endsWith(':'));
  if (parts.length === 0) return '';
  // The selection is part of the key: moving or resizing it changes which pixels the
  // mosaic covers, so the rendered preview is no longer valid.
  return `${selection.x},${selection.y},${selection.width},${selection.height}|${parts.join(';')}`;
}

export function useMosaicPreview(
  objects: readonly Annotation[],
  selection: PixelRect | null,
  version: number,
  origin: DisplayOrigin = PRIMARY_ORIGIN
): MosaicPreview {
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
  const geometryKey = mosaicKey(objects, selection);
  const key = geometryKey ? `${origin.x},${origin.y}|${geometryKey}` : '';

  useEffect(() => {
    if (!key || !selection) {
      setPreview(null);
      return;
    }
    let active = true;

    // One region per painted cell, matching what `useExport` sends: the preview and
    // the file must be built from identical geometry.
    const mosaics = objects
      .filter(
        (object): object is Extract<Annotation, { kind: 'mosaic' }> => object.kind === 'mosaic'
      )
      .flatMap((object) =>
        object.blocks.map((block) => ({
          x: block.x - selection.x,
          y: block.y - selection.y,
          width: block.width,
          height: block.height,
          blockSize: object.blockSize
        }))
      );

    void invoke<PreviewPlan>('render_mosaic_preview', {
      geometry: {
        ...toVirtualDesktop(selection, origin),
        width: selection.width,
        height: selection.height,
        mosaics,
        version,
        hasOverlay: false
      }
    })
      .then((plan) => {
        if (!active) return;
        setPreview({ key, url: convertFileSrc(plan.path, FRAME_SCHEME) });
      })
      .catch(() => {
        if (!active) return;
        // Falling back to no preview rather than a stale one: showing the previous
        // mosaic state would misrepresent what the export contains.
        setPreview(null);
      });
    return () => { active = false; };
    // `key` already encodes the mosaics and the selection, so it is the dependency
    // that decides when a re-render is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A changed/removed mask must not briefly show the previous crop while its
  // replacement is being rendered, even before the effect cleanup has run.
  return { url: preview?.key === key ? preview.url : null };
}
