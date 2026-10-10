//! Compositing the final image.
//!
//! §8.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md fixes the
//! order: the base image, then the ordinary annotations, then the mosaics. The
//! output carries no border, control point, toolbar, cursor or preview hint.
//!
//! The division of labour is deliberate, and §5.3 line 394 is the reason: the spec
//! warns that Rust and WebView text rendering must not be assumed identical. It is
//! not achievable — `--font-sans` is a system stack (Inter, Microsoft YaHei, …) and
//! matching a browser's shaping, hinting and antialiasing byte for byte is not
//! realistic. So each algorithm exists exactly once, on the side that can do it
//! correctly:
//!
//! - **Annotation drawing lives in the WebView.** It already renders the shapes and
//!   the text as SVG for the preview. For export it rasterises that same layer into
//!   one premultiplied-free RGBA overlay, so the preview and the file come from one
//!   renderer and no font has to be bundled.
//! - **The mosaic lives here**, in `super::mosaic`, because §5.3 requires
//!   byte-identical per-channel results and an averaging algorithm written twice
//!   would eventually disagree.
//! - **Rust owns the final buffer, the encoding and the writing**, so the
//!   authoritative pixels never depend on the WebView keeping a copy.
//!
//! The mosaic runs last, so it occludes any annotation underneath it, including
//! text. That is the intended behaviour: a mosaic over a label must hide the label.

use image::RgbaImage;

use super::mosaic::{apply_mosaics, MosaicError, MosaicRegion};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RenderError {
    /// The overlay's size does not match the base image.
    OverlayMismatch {
        expected: (u32, u32),
        actual: (u32, u32),
    },
    Mosaic(MosaicError),
}

impl From<MosaicError> for RenderError {
    fn from(error: MosaicError) -> Self {
        RenderError::Mosaic(error)
    }
}

/// Composites one export.
///
/// `base` is the frozen desktop pixels for the selection, already cut out by
/// `super::composite::composite_selection`. `overlay`, when present, is the
/// rasterised annotation layer at exactly the same size. `mosaics` are in
/// selection-local physical pixels.
pub(crate) fn render_export(
    mut base: RgbaImage,
    overlay: Option<&RgbaImage>,
    mosaics: &[MosaicRegion],
) -> Result<RgbaImage, RenderError> {
    if let Some(overlay) = overlay {
        if overlay.dimensions() != base.dimensions() {
            return Err(RenderError::OverlayMismatch {
                expected: base.dimensions(),
                actual: overlay.dimensions(),
            });
        }
        blend_over(&mut base, overlay);
    }

    let (width, height) = base.dimensions();
    apply_mosaics(base.as_mut(), width, height, mosaics)?;

    // The base image is opaque and the blend keeps it so, which matters because a
    // clipboard bitmap with stray transparency pastes as black in some apps.
    debug_assert!(
        base.pixels().all(|pixel| pixel[3] == 255),
        "the export must stay fully opaque"
    );
    Ok(base)
}

/// Straight-alpha source-over, in integer arithmetic.
///
/// `out = src + dst * (1 - srcA)`, per channel, with the same rounding as
/// `mosaic.rs` so the two stages cannot disagree about a half.
fn blend_over(base: &mut RgbaImage, overlay: &RgbaImage) {
    for (target, source) in base.pixels_mut().zip(overlay.pixels()) {
        let alpha = u32::from(source[3]);
        if alpha == 0 {
            // The common case: the annotation layer is mostly empty.
            continue;
        }
        if alpha == 255 {
            *target = *source;
            continue;
        }
        let inverse = 255 - alpha;
        for channel in 0..3 {
            let src = u32::from(source[channel]) * alpha;
            let dst = u32::from(target[channel]) * inverse;
            // +127 rounds half up, matching the mosaic's `(sum + count / 2) / count`.
            target[channel] = ((src + dst + 127) / 255) as u8;
        }
        // The base is opaque, so the result is too.
        target[3] = 255;
    }
}

#[cfg(test)]
mod tests {
    use super::{render_export, RenderError};
    use crate::screen_capture::mosaic::MosaicRegion;
    use image::{Rgba, RgbaImage};

    fn solid(width: u32, height: u32, value: [u8; 4]) -> RgbaImage {
        RgbaImage::from_pixel(width, height, Rgba(value))
    }

    fn transparent(width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 0]))
    }

    fn region(x: i64, y: i64, width: u32, height: u32, block_size: u32) -> MosaicRegion {
        MosaicRegion {
            x,
            y,
            width,
            height,
            block_size,
        }
    }

    #[test]
    fn returns_the_base_unchanged_without_annotations() {
        let base = solid(4, 4, [10, 20, 30, 255]);

        let out = render_export(base.clone(), None, &[]).expect("render should succeed");

        assert_eq!(out, base);
    }

    #[test]
    fn an_empty_overlay_changes_nothing() {
        // The annotation layer is mostly transparent, so this is the common path.
        let base = solid(4, 4, [10, 20, 30, 255]);

        let out = render_export(base.clone(), Some(&transparent(4, 4)), &[])
            .expect("render should succeed");

        assert_eq!(out, base);
    }

    #[test]
    fn an_opaque_annotation_replaces_the_base() {
        let base = solid(2, 2, [10, 20, 30, 255]);
        let overlay = solid(2, 2, [200, 100, 50, 255]);

        let out = render_export(base, Some(&overlay), &[]).expect("render should succeed");

        assert!(out.pixels().all(|pixel| pixel.0 == [200, 100, 50, 255]));
    }

    #[test]
    fn a_half_transparent_annotation_blends() {
        // Independent truth: src 200 at alpha 128 over dst 0 is
        // (200*128 + 0*127 + 127) / 255 = (25600 + 127) / 255 = 100.89 -> 100.
        let base = solid(1, 1, [0, 0, 0, 255]);
        let overlay = solid(1, 1, [200, 200, 200, 128]);

        let out = render_export(base, Some(&overlay), &[]).expect("render should succeed");

        assert_eq!(out.get_pixel(0, 0).0, [100, 100, 100, 255]);
    }

    #[test]
    fn the_result_stays_opaque() {
        // A clipboard bitmap with stray transparency pastes as black in some apps.
        let base = solid(2, 2, [10, 20, 30, 255]);
        let overlay = solid(2, 2, [200, 100, 50, 64]);

        let out = render_export(base, Some(&overlay), &[]).expect("render should succeed");

        assert!(out.pixels().all(|pixel| pixel[3] == 255));
    }

    #[test]
    fn the_mosaic_runs_after_the_annotations() {
        // §8.1's order. The overlay paints 0 and 100 side by side; a block-2 mosaic
        // then averages them to 50. If the mosaic ran first it would average the
        // base instead and the overlay would survive as 0 and 100.
        let base = solid(2, 1, [255, 255, 255, 255]);
        let mut overlay = transparent(2, 1);
        overlay.put_pixel(0, 0, Rgba([0, 0, 0, 255]));
        overlay.put_pixel(1, 0, Rgba([100, 100, 100, 255]));

        let out = render_export(base, Some(&overlay), &[region(0, 0, 2, 1, 2)])
            .expect("render should succeed");

        assert_eq!(out.get_pixel(0, 0).0, [50, 50, 50, 255]);
        assert_eq!(out.get_pixel(1, 0).0, [50, 50, 50, 255]);
    }

    #[test]
    fn a_mosaic_hides_the_text_underneath_it() {
        // The intended behaviour: a mosaic over a label must hide the label, so the
        // uniform result proves the annotation was consumed rather than preserved.
        let base = solid(4, 1, [255, 255, 255, 255]);
        let mut overlay = transparent(4, 1);
        // A "glyph": two dark pixels among light ones.
        overlay.put_pixel(1, 0, Rgba([0, 0, 0, 255]));
        overlay.put_pixel(2, 0, Rgba([0, 0, 0, 255]));

        let out = render_export(base, Some(&overlay), &[region(0, 0, 4, 1, 4)])
            .expect("render should succeed");

        // One block over the whole row: (255 + 0 + 0 + 255) / 4 = 127.5 -> 128.
        assert!(out.pixels().all(|pixel| pixel.0 == [128, 128, 128, 255]));
    }

    #[test]
    fn several_mosaics_keep_their_creation_order() {
        let base = solid(4, 1, [0, 0, 0, 255]);
        let mut overlay = transparent(4, 1);
        for x in 0..4 {
            overlay.put_pixel(x, 0, Rgba([(x as u8) * 40, 0, 0, 255]));
        }

        let out = render_export(
            base,
            Some(&overlay),
            &[region(0, 0, 2, 1, 2), region(2, 0, 2, 1, 2)],
        )
        .expect("render should succeed");

        // (0 + 40) / 2 = 20, then (80 + 120) / 2 = 100.
        assert_eq!(out.get_pixel(0, 0)[0], 20);
        assert_eq!(out.get_pixel(2, 0)[0], 100);
    }

    #[test]
    fn rejects_an_overlay_of_the_wrong_size() {
        // A size mismatch means the annotation coordinates would be wrong, so it
        // must fail rather than silently draw an offset layer.
        let base = solid(4, 4, [0, 0, 0, 255]);

        assert_eq!(
            render_export(base, Some(&transparent(4, 3)), &[]),
            Err(RenderError::OverlayMismatch {
                expected: (4, 4),
                actual: (4, 3)
            })
        );
    }

    #[test]
    fn propagates_a_mosaic_error() {
        let base = solid(4, 4, [0, 0, 0, 255]);

        let result = render_export(base, None, &[region(0, 0, 2, 2, 0)]);

        assert!(matches!(result, Err(RenderError::Mosaic(_))));
    }

    #[test]
    fn handles_a_single_pixel_export() {
        // §4.2's minimum selection is 1×1, so it has to survive the whole pipeline.
        let base = solid(1, 1, [7, 8, 9, 255]);

        let out = render_export(base, Some(&transparent(1, 1)), &[region(0, 0, 1, 1, 8)])
            .expect("render should succeed");

        assert_eq!(out.dimensions(), (1, 1));
        assert_eq!(out.get_pixel(0, 0).0, [7, 8, 9, 255]);
    }
}
