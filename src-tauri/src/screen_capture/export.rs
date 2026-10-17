//! Orchestrating one export: composite, render, encode, write.
//!
//! This is the seam where the pieces meet, so it holds no algorithm of its own.
//! The order is §8.1's: the base image for the selection, then the rasterised
//! annotation layer, then the mosaics, then the encode, then the write.
//!
//! The annotation overlay arrives as raw bytes rather than JSON. §9 line 393 forbids
//! pushing pixels through a large Base64/JSON `invoke`, so the frontend stages the
//! overlay through a binary request and this module reads it back out by session.

use image::RgbaImage;

use super::composite::SelectionRect;
use super::encode::encode_export;
use super::mosaic::MosaicRegion;
use super::output::{ClipboardSink, ExportError, ExportKind, ExportToken, ExportTransaction};
use super::FrameStore;

/// Holds the rasterised annotation overlay between the staging call and the export.
///
/// Two calls rather than one because the pixels travel as a raw binary body (§9
/// line 393 forbids a large Base64/JSON `invoke`) while the geometry travels as
/// JSON, and one command cannot carry both shapes.
///
/// Keyed by session id, so a stale overlay from an ended session can never be
/// blended into a new one.
#[derive(Debug, Default)]
pub struct OverlayStaging(std::sync::Mutex<Option<StagedOverlay>>);

#[derive(Debug)]
struct StagedOverlay {
    session_id: u64,
    /// The annotation document version the overlay was rasterised from.
    version: u64,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

impl OverlayStaging {
    /// Replaces any previously staged overlay: only the newest export matters.
    pub(crate) fn stage(
        &self,
        session_id: u64,
        version: u64,
        width: u32,
        height: u32,
        rgba: Vec<u8>,
    ) {
        *self.0.lock().unwrap() = Some(StagedOverlay {
            session_id,
            version,
            width,
            height,
            rgba,
        });
    }

    /// Takes the overlay for this session, version and size, if all of them match.
    ///
    /// The version comparison is the point: the staged value was recorded when the
    /// layer was rasterised and the requested one when the export was asked for, so
    /// a document change in between is detected. Comparing two values captured at
    /// the same instant would prove nothing.
    ///
    /// Taking rather than borrowing, so one staged overlay serves exactly one
    /// export and a retry has to stage the current annotations again.
    pub(crate) fn take(
        &self,
        session_id: u64,
        version: u64,
        width: u32,
        height: u32,
    ) -> Option<Vec<u8>> {
        let mut guard = self.0.lock().unwrap();
        let staged = guard.as_ref()?;
        if staged.session_id != session_id
            || staged.version != version
            || staged.width != width
            || staged.height != height
        {
            return None;
        }
        guard.take().map(|staged| staged.rgba)
    }

    /// §8.3: the session's buffers are released when it ends.
    pub(crate) fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }

    pub(crate) fn clear_if_session(&self, session_id: u64) {
        let mut held = self.0.lock().unwrap();
        if held
            .as_ref()
            .is_some_and(|overlay| overlay.session_id == session_id)
        {
            *held = None;
        }
    }
}

/// Everything one export needs, with the geometry already in physical pixels.
pub(crate) struct ExportRequest {
    pub token: ExportToken,
    /// Virtual-desktop physical pixels.
    pub selection: SelectionRect,
    /// The rasterised annotation layer, straight-alpha RGBA at the selection's size.
    /// `None` when there are no annotations, which skips the blend entirely.
    pub overlay: Option<Vec<u8>>,
    /// Selection-local physical pixels.
    pub mosaics: Vec<MosaicRegion>,
}

/// Builds the final image without writing it anywhere.
///
/// Separate from the write so the expensive part stays testable and so a cancel
/// between rendering and writing costs nothing but the buffer.
pub(crate) fn render_request(
    frames: &FrameStore,
    request: &ExportRequest,
) -> Result<RgbaImage, ExportError> {
    let width = request.selection.width;
    let height = request.selection.height;

    // The base image comes from this session's frozen frames only: `with_frames`
    // refuses a superseded session, so a late export cannot read new desktop pixels.
    let base_bytes = frames
        .selection_pixels(request.token.session_id, request.selection)
        .ok_or(ExportError::Superseded)?
        .map_err(ExportError::WriteFailed)?;

    let base = RgbaImage::from_raw(width, height, base_bytes).ok_or_else(|| {
        ExportError::WriteFailed("the composited buffer does not match the selection".into())
    })?;

    let overlay = match &request.overlay {
        Some(bytes) => Some(
            RgbaImage::from_raw(width, height, bytes.clone()).ok_or_else(|| {
                ExportError::WriteFailed(
                    "the annotation overlay does not match the selection".into(),
                )
            })?,
        ),
        None => None,
    };

    super::renderer::render_export(base, overlay.as_ref(), &request.mosaics)
        .map_err(|error| ExportError::WriteFailed(format!("rendering failed: {error:?}")))
}

/// Renders, encodes and copies to the clipboard.
///
/// `current` carries the document version snapshot. Native callers wrap their
/// sink in SessionSink so session ownership is checked again after encoding and
/// before every real clipboard write attempt.
pub(crate) fn copy_to_clipboard(
    frames: &FrameStore,
    sink: &mut dyn ClipboardSink,
    request: &ExportRequest,
    current: ExportToken,
) -> Result<(), ExportError> {
    let mut transaction = ExportTransaction::new(ExportKind::Clipboard, request.token);

    // Rendering and encoding happen in the cancellable phase.
    let image = render_request(frames, request)?;
    let encoded = encode_export(image)?;

    let start = std::time::Instant::now();
    transaction.run_clipboard(sink, &encoded, current, std::thread::sleep, move || {
        start.elapsed()
    })
}

#[cfg(test)]
mod tests {
    use super::{copy_to_clipboard, render_request, ExportRequest};
    use crate::screen_capture::backend::{CapturedDisplay, DisplayInfo};
    use crate::screen_capture::composite::SelectionRect;
    use crate::screen_capture::mosaic::MosaicRegion;
    use crate::screen_capture::output::{ClipboardSink, EncodedImage, ExportError, ExportToken};
    use crate::screen_capture::FrameStore;

    fn token(version: u64) -> ExportToken {
        ExportToken {
            session_id: 1,
            version,
        }
    }

    /// One display whose pixels encode their own position, so a crop or a flip is
    /// visible in the result.
    fn display(width: u32, height: u32) -> CapturedDisplay {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                rgba.extend_from_slice(&[x as u8, y as u8, 0, 255]);
            }
        }
        CapturedDisplay {
            display: DisplayInfo {
                id: 1,
                x: 0,
                y: 0,
                width,
                height,
                scale_factor: 1.0,
                is_primary: true,
            },
            rgba,
        }
    }

    fn store(width: u32, height: u32) -> FrameStore {
        let store = FrameStore::default();
        store.store(1, vec![display(width, height)]);
        store
    }

    fn selection(x: i32, y: i32, width: u32, height: u32) -> SelectionRect {
        SelectionRect {
            x,
            y,
            width,
            height,
        }
    }

    #[derive(Default)]
    struct FakeClipboard {
        images: Vec<(u32, u32)>,
    }

    impl ClipboardSink for FakeClipboard {
        fn write_image(&mut self, image: &EncodedImage) -> Result<(), ExportError> {
            self.images.push((image.width, image.height));
            Ok(())
        }

        fn write_text(&mut self, _text: &str) -> Result<(), ExportError> {
            Ok(())
        }
    }

    #[test]
    fn renders_the_selected_region_from_the_frozen_frames() {
        let frames = store(8, 8);

        let image = render_request(
            &frames,
            &ExportRequest {
                token: token(1),
                selection: selection(2, 3, 4, 2),
                overlay: None,
                mosaics: vec![],
            },
        )
        .expect("rendering should succeed");

        assert_eq!(image.dimensions(), (4, 2));
        // The pixel at selection-local (0,0) is desktop (2,3).
        assert_eq!(image.get_pixel(0, 0).0, [2, 3, 0, 255]);
        assert_eq!(image.get_pixel(3, 1).0, [5, 4, 0, 255]);
    }

    #[test]
    fn renders_adopted_long_image_in_image_coordinates_and_restores_desktop() {
        let frames = store(4, 4);
        frames
            .adopt_long_image(1, 7, 2, 8, [41, 42, 43, 255].repeat(16))
            .unwrap();
        let request = ExportRequest {
            token: token(1),
            selection: selection(0, 0, 2, 8),
            overlay: None,
            mosaics: vec![],
        };
        let image = render_request(&frames, &request).unwrap();
        assert_eq!(image.dimensions(), (2, 8));
        assert!(image.pixels().all(|pixel| pixel.0 == [41, 42, 43, 255]));
        assert!(frames.discard_long_image(1));
        assert!(render_request(&frames, &request).is_err());
    }

    #[test]
    fn long_image_crop_preserves_image_local_row_and_column_order() {
        let frames = store(4, 4);
        let mut rgba = Vec::new();
        for y in 0..8u8 {
            for x in 0..3u8 {
                rgba.extend_from_slice(&[x, y, 9, 255]);
            }
        }
        frames.adopt_long_image(1, 1, 3, 8, rgba).unwrap();
        let image = render_request(
            &frames,
            &ExportRequest {
                token: token(1),
                selection: selection(1, 5, 2, 3),
                overlay: None,
                mosaics: vec![],
            },
        )
        .unwrap();
        assert_eq!(image.dimensions(), (2, 3));
        assert_eq!(image.get_pixel(0, 0).0, [1, 5, 9, 255]);
        assert_eq!(image.get_pixel(1, 2).0, [2, 7, 9, 255]);
    }

    #[test]
    fn long_image_cannot_be_adopted_after_session_retirement() {
        let frames = store(4, 4);
        frames.activate(1);
        frames.retire(1);
        assert!(frames.adopt_long_image(1, 1, 2, 8, vec![0; 64]).is_err());
    }

    #[test]
    fn long_image_output_uses_the_same_annotation_and_mosaic_compositor() {
        let frames = store(4, 4);
        frames
            .adopt_long_image(1, 1, 2, 8, [20, 30, 40, 255].repeat(16))
            .unwrap();
        let mut overlay = vec![0; 64];
        overlay[0..4].copy_from_slice(&[100, 50, 60, 255]);
        let image = render_request(
            &frames,
            &ExportRequest {
                token: token(1),
                selection: selection(0, 0, 2, 8),
                overlay: Some(overlay),
                mosaics: vec![MosaicRegion {
                    x: 0,
                    y: 0,
                    width: 2,
                    height: 1,
                    block_size: 2,
                }],
            },
        )
        .unwrap();
        assert_eq!(image.get_pixel(0, 0).0, [60, 40, 50, 255]);
        assert_eq!(image.get_pixel(1, 0).0, [60, 40, 50, 255]);
        assert_eq!(image.get_pixel(1, 7).0, [20, 30, 40, 255]);
    }

    #[test]
    fn adopted_long_image_rejects_stale_revision_and_invalid_dimensions() {
        let frames = store(4, 4);
        assert!(frames.adopt_long_image(99, 1, 2, 8, vec![0; 64]).is_err());
        assert!(frames.adopt_long_image(1, 1, 2, 8, vec![0; 4]).is_err());
        assert!(frames.adopt_long_image(1, 1, 1, 65_536, vec![]).is_err());
        frames.adopt_long_image(1, 3, 2, 8, vec![0; 64]).unwrap();
        assert!(frames.adopt_long_image(1, 2, 2, 8, vec![1; 64]).is_err());
        assert_eq!(frames.long_image_dimensions(1), Some((3, 2, 8)));
        assert!(frames.long_image_bitmap(1, 2).is_none());
        assert!(frames.long_image_bitmap(99, 3).is_none());
        assert!(frames.long_image_bitmap(1, 3).is_some());
        for crop in [
            selection(-1, 0, 1, 1),
            selection(0, 7, 2, 2),
            selection(0, 0, 0, 1),
        ] {
            let request = ExportRequest {
                token: token(1),
                selection: crop,
                overlay: None,
                mosaics: vec![],
            };
            assert!(render_request(&frames, &request).is_err());
        }
        frames.clear_if_session(1);
        assert!(frames.long_image_dimensions(1).is_none());
        assert!(frames.long_image_bitmap(1, 3).is_none());
    }

    #[test]
    fn blends_the_annotation_overlay() {
        let frames = store(4, 4);
        // Opaque red over the whole 2×2 selection.
        let overlay = [255, 0, 0, 255].repeat(4);

        let image = render_request(
            &frames,
            &ExportRequest {
                token: token(1),
                selection: selection(0, 0, 2, 2),
                overlay: Some(overlay),
                mosaics: vec![],
            },
        )
        .expect("rendering should succeed");

        assert!(image.pixels().all(|pixel| pixel.0 == [255, 0, 0, 255]));
    }

    #[test]
    fn applies_the_mosaic_after_the_overlay() {
        let frames = store(4, 4);

        let image = render_request(
            &frames,
            &ExportRequest {
                token: token(1),
                selection: selection(0, 0, 2, 1),
                overlay: None,
                mosaics: vec![MosaicRegion {
                    x: 0,
                    y: 0,
                    width: 2,
                    height: 1,
                    block_size: 2,
                }],
            },
        )
        .expect("rendering should succeed");

        // The base row is (0,0) and (1,0), so red averages (0 + 1) / 2 = 1 (rounded
        // from 0.5).
        assert_eq!(image.get_pixel(0, 0).0, [1, 0, 0, 255]);
        assert_eq!(image.get_pixel(1, 0).0, [1, 0, 0, 255]);
    }

    #[test]
    fn refuses_to_render_for_a_superseded_session() {
        // A late export must not read a new session's desktop pixels.
        let frames = store(4, 4);

        let result = render_request(
            &frames,
            &ExportRequest {
                token: ExportToken {
                    session_id: 99,
                    version: 1,
                },
                selection: selection(0, 0, 2, 2),
                overlay: None,
                mosaics: vec![],
            },
        );

        assert_eq!(result, Err(ExportError::Superseded));
    }

    #[test]
    fn rejects_an_overlay_of_the_wrong_length() {
        // A short overlay means the frontend and the selection disagree, which would
        // otherwise paint an offset layer into the file.
        let frames = store(4, 4);

        let result = render_request(
            &frames,
            &ExportRequest {
                token: token(1),
                selection: selection(0, 0, 2, 2),
                overlay: Some(vec![0; 4]),
                mosaics: vec![],
            },
        );

        assert!(matches!(result, Err(ExportError::WriteFailed(_))));
    }

    #[test]
    fn copies_the_rendered_image_to_the_clipboard() {
        let frames = store(8, 8);
        let mut clipboard = FakeClipboard::default();

        copy_to_clipboard(
            &frames,
            &mut clipboard,
            &ExportRequest {
                token: token(1),
                selection: selection(1, 1, 4, 3),
                overlay: None,
                mosaics: vec![],
            },
            token(1),
        )
        .expect("the copy should succeed");

        assert_eq!(clipboard.images, vec![(4, 3)]);
    }

    #[test]
    fn does_not_copy_when_the_version_moved_on() {
        // §8.1: the version is checked again immediately before the write, so an
        // annotation committed during encoding aborts the export.
        let frames = store(8, 8);
        let mut clipboard = FakeClipboard::default();

        let result = copy_to_clipboard(
            &frames,
            &mut clipboard,
            &ExportRequest {
                token: token(1),
                selection: selection(0, 0, 4, 4),
                overlay: None,
                mosaics: vec![],
            },
            token(2),
        );

        assert_eq!(result, Err(ExportError::Superseded));
        assert!(clipboard.images.is_empty());
    }
}

#[cfg(test)]
mod staging_tests {
    use super::OverlayStaging;

    #[test]
    fn returns_the_staged_overlay_for_a_matching_request() {
        let staging = OverlayStaging::default();
        staging.stage(1, 3, 4, 2, vec![7; 32]);

        assert_eq!(staging.take(1, 3, 4, 2), Some(vec![7; 32]));
    }

    #[test]
    fn refuses_an_overlay_from_another_session() {
        // A stale overlay must never be blended into a new session's export.
        let staging = OverlayStaging::default();
        staging.stage(1, 3, 4, 2, vec![7; 32]);

        assert_eq!(staging.take(2, 3, 4, 2), None);
    }

    #[test]
    fn refuses_an_overlay_rasterised_from_an_older_document() {
        // The window §8.1 cares about: an annotation committed between rasterising
        // the layer and asking for the export would otherwise be missing from the
        // file while the user believes they copied what they saw.
        let staging = OverlayStaging::default();
        staging.stage(1, 3, 4, 2, vec![7; 32]);

        assert_eq!(staging.take(1, 4, 4, 2), None);
    }

    #[test]
    fn refuses_an_overlay_of_a_different_size() {
        // A size mismatch means the selection changed after staging, so blending it
        // would paint an offset layer into the file.
        let staging = OverlayStaging::default();
        staging.stage(1, 3, 4, 2, vec![7; 32]);

        assert_eq!(staging.take(1, 3, 4, 3), None);
        assert_eq!(staging.take(1, 3, 5, 2), None);
    }

    #[test]
    fn serves_one_export_only() {
        // Taking rather than borrowing, so a retry must stage the current
        // annotations again instead of silently reusing an older layer.
        let staging = OverlayStaging::default();
        staging.stage(1, 1, 2, 1, vec![1; 8]);

        assert!(staging.take(1, 1, 2, 1).is_some());
        assert_eq!(staging.take(1, 1, 2, 1), None);
    }

    #[test]
    fn keeps_only_the_newest_overlay() {
        let staging = OverlayStaging::default();
        staging.stage(1, 1, 2, 1, vec![1; 8]);
        staging.stage(1, 2, 2, 1, vec![2; 8]);

        // The newest one is served.
        assert_eq!(staging.take(1, 2, 2, 1), Some(vec![2; 8]));
    }

    #[test]
    fn the_replaced_overlay_is_gone_not_shadowed() {
        let staging = OverlayStaging::default();
        staging.stage(1, 1, 2, 1, vec![1; 8]);
        staging.stage(1, 2, 2, 1, vec![2; 8]);

        assert_eq!(staging.take(1, 1, 2, 1), None);
    }

    #[test]
    fn clears_on_session_end() {
        // §8.3 requires the session's buffers to be released.
        let staging = OverlayStaging::default();
        staging.stage(1, 1, 2, 1, vec![1; 8]);

        staging.clear();

        assert_eq!(staging.take(1, 1, 2, 1), None);
    }

    #[test]
    fn old_cleanup_does_not_clear_a_new_staged_overlay() {
        let staging = OverlayStaging::default();
        staging.stage(2, 1, 1, 1, vec![0, 0, 0, 255]);
        staging.clear_if_session(1);
        assert_eq!(staging.take(2, 1, 1, 1), Some(vec![0, 0, 0, 255]));
        staging.stage(2, 2, 1, 1, vec![0, 0, 0, 255]);
        staging.clear_if_session(2);
        assert!(staging.take(2, 2, 1, 1).is_none());
    }

    #[test]
    fn has_nothing_before_anything_is_staged() {
        assert_eq!(OverlayStaging::default().take(1, 1, 2, 1), None);
    }
}
