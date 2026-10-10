//! Turns per-display frozen frames into one selection image.
//!
//! Specified in `docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md`
//! §4.1, §4.2 and §6.5: selections are half-open integer physical-pixel
//! rectangles in signed virtual-desktop coordinates, displays keep their own
//! physical pixels (no uniform DPI resample), and virtual-desktop gaps are
//! filled white without offering a copyable colour value.
//!
//! Mirrored displays can report overlapping rectangles. The frame listed first
//! owns the pixel, for both compositing and sampling, so the two paths never
//! disagree.

use image::{imageops, ImageBuffer, Rgba, RgbaImage};

use super::backend::{CapturedDisplay, DisplayInfo};
use super::{validate_output_dimensions, CapacityError};

const BYTES_PER_PIXEL: usize = 4;
/// Virtual-desktop gaps are opaque white and carry no copyable colour.
const GAP_FILL: Rgba<u8> = Rgba([255, 255, 255, 255]);

/// Half-open rectangle in signed virtual-desktop physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SelectionRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompositeError {
    NoDisplays,
    OutsideDesktop,
    InvalidFrame,
    Capacity(CapacityError),
    ArithmeticOverflow,
}

impl SelectionRect {
    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }
}

fn display_rect(display: &DisplayInfo) -> SelectionRect {
    SelectionRect {
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
    }
}

pub(crate) fn virtual_desktop_bounds(frames: &[CapturedDisplay]) -> Option<SelectionRect> {
    let mut min_x = i64::MAX;
    let mut min_y = i64::MAX;
    let mut max_x = i64::MIN;
    let mut max_y = i64::MIN;

    for frame in frames {
        let rect = display_rect(&frame.display);
        min_x = min_x.min(i64::from(rect.x));
        min_y = min_y.min(i64::from(rect.y));
        max_x = max_x.max(rect.right());
        max_y = max_y.max(rect.bottom());
    }
    if frames.is_empty() {
        return None;
    }

    Some(SelectionRect {
        x: i32::try_from(min_x).ok()?,
        y: i32::try_from(min_y).ok()?,
        width: u32::try_from(max_x - min_x).ok()?,
        height: u32::try_from(max_y - min_y).ok()?,
    })
}

pub(crate) fn composite_selection(
    frames: &[CapturedDisplay],
    selection: SelectionRect,
) -> Result<Vec<u8>, CompositeError> {
    let bounds = virtual_desktop_bounds(frames).ok_or(CompositeError::NoDisplays)?;

    // Selections stay addressable in signed 32-bit virtual-desktop pixels;
    // checked before the capacity limits so a bogus extent can't be reported as
    // a merely oversized image.
    if i32::try_from(selection.right()).is_err() || i32::try_from(selection.bottom()).is_err() {
        return Err(CompositeError::ArithmeticOverflow);
    }

    // Rejects before allocating, per §6.5.
    validate_output_dimensions(u64::from(selection.width), u64::from(selection.height))
        .map_err(CompositeError::Capacity)?;

    if i64::from(selection.x) < i64::from(bounds.x)
        || i64::from(selection.y) < i64::from(bounds.y)
        || selection.right() > bounds.right()
        || selection.bottom() > bounds.bottom()
    {
        return Err(CompositeError::OutsideDesktop);
    }

    let mut output = RgbaImage::from_pixel(selection.width, selection.height, GAP_FILL);

    // Reverse order lets the first listed display win an overlap, matching
    // `sample_pixel`. `imageops::replace` clips negative and overhanging
    // offsets itself and copies without alpha blending, so a frame reaching
    // past the selection needs no intersection maths here.
    for frame in frames.iter().rev() {
        let view: ImageBuffer<Rgba<u8>, &[u8]> = ImageBuffer::from_raw(
            frame.display.width,
            frame.display.height,
            frame.rgba.as_slice(),
        )
        .ok_or(CompositeError::InvalidFrame)?;
        imageops::replace(
            &mut output,
            &view,
            i64::from(frame.display.x) - i64::from(selection.x),
            i64::from(frame.display.y) - i64::from(selection.y),
        );
    }

    Ok(output.into_raw())
}

/// The sRGB pixel at a virtual-desktop coordinate, or `None` for a gap, which
/// the overlay reports as "no valid pixel" and which must not touch the
/// clipboard.
pub(crate) fn sample_pixel(frames: &[CapturedDisplay], x: i32, y: i32) -> Option<[u8; 3]> {
    let frame = frames.iter().find(|frame| {
        let rect = display_rect(&frame.display);
        i64::from(x) >= i64::from(rect.x)
            && i64::from(x) < rect.right()
            && i64::from(y) >= i64::from(rect.y)
            && i64::from(y) < rect.bottom()
    })?;

    let column = (i64::from(x) - i64::from(frame.display.x)) as usize;
    let row = (i64::from(y) - i64::from(frame.display.y)) as usize;
    let index = (row * frame.display.width as usize + column) * BYTES_PER_PIXEL;
    Some([
        *frame.rgba.get(index)?,
        *frame.rgba.get(index + 1)?,
        *frame.rgba.get(index + 2)?,
    ])
}

/// The exact 7 characters Ctrl+C writes, per §4.1.
pub(crate) fn format_hex(pixel: [u8; 3]) -> String {
    format!("#{:02X}{:02X}{:02X}", pixel[0], pixel[1], pixel[2])
}

#[cfg(test)]
mod tests {
    use super::super::backend::{CapturedDisplay, DisplayInfo};
    use super::super::CapacityError;
    use super::{
        composite_selection, format_hex, sample_pixel, virtual_desktop_bounds, CompositeError,
        SelectionRect,
    };

    /// A frame whose every pixel encodes its own identity as
    /// `[id, column, row, 255]`, so a miscopied row or column is visible.
    fn frame(id: u32, x: i32, y: i32, width: u32, height: u32, scale: f32) -> CapturedDisplay {
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for row in 0..height {
            for column in 0..width {
                rgba.extend_from_slice(&[id as u8, column as u8, row as u8, 255]);
            }
        }
        CapturedDisplay {
            display: DisplayInfo {
                id,
                x,
                y,
                width,
                height,
                scale_factor: scale,
                is_primary: id == 1,
            },
            rgba,
        }
    }

    fn selection(x: i32, y: i32, width: u32, height: u32) -> SelectionRect {
        SelectionRect {
            x,
            y,
            width,
            height,
        }
    }

    fn pixel_at(rgba: &[u8], width: u32, column: u32, row: u32) -> [u8; 4] {
        let index = ((row * width + column) * 4) as usize;
        [
            rgba[index],
            rgba[index + 1],
            rgba[index + 2],
            rgba[index + 3],
        ]
    }

    #[test]
    fn bounds_span_negative_origins() {
        let frames = vec![frame(1, 0, 0, 4, 4, 1.0), frame(2, -4, -2, 4, 6, 2.0)];

        assert_eq!(
            virtual_desktop_bounds(&frames),
            Some(selection(-4, -2, 8, 6))
        );
    }

    #[test]
    fn bounds_are_absent_without_displays() {
        assert_eq!(virtual_desktop_bounds(&[]), None);
    }

    #[test]
    fn crops_a_selection_inside_one_display() {
        let frames = vec![frame(1, 0, 0, 4, 4, 1.0)];

        let rgba =
            composite_selection(&frames, selection(1, 2, 2, 2)).expect("crop should succeed");

        assert_eq!(rgba.len(), 2 * 2 * 4);
        // Source column 1, row 2 lands at output (0, 0).
        assert_eq!(pixel_at(&rgba, 2, 0, 0), [1, 1, 2, 255]);
        assert_eq!(pixel_at(&rgba, 2, 1, 0), [1, 2, 2, 255]);
        assert_eq!(pixel_at(&rgba, 2, 0, 1), [1, 1, 3, 255]);
        assert_eq!(pixel_at(&rgba, 2, 1, 1), [1, 2, 3, 255]);
    }

    #[test]
    fn spans_displays_without_rescaling_the_secondary() {
        // A 2.0-scale display left of a 1.0-scale display: both contribute raw
        // physical pixels, one output column each.
        let frames = vec![frame(1, 0, 0, 2, 2, 1.0), frame(2, -2, 0, 2, 2, 2.0)];

        let rgba =
            composite_selection(&frames, selection(-1, 0, 2, 1)).expect("span should succeed");

        assert_eq!(rgba.len(), 2 * 4);
        // Secondary's last column, then primary's first column, unscaled.
        assert_eq!(pixel_at(&rgba, 2, 0, 0), [2, 1, 0, 255]);
        assert_eq!(pixel_at(&rgba, 2, 1, 0), [1, 0, 0, 255]);
    }

    #[test]
    fn fills_desktop_gaps_with_opaque_white() {
        // Displays at x=0..2 and x=4..6 leave a two-pixel gap at x=2..4.
        let frames = vec![frame(1, 0, 0, 2, 1, 1.0), frame(2, 4, 0, 2, 1, 1.0)];

        let rgba =
            composite_selection(&frames, selection(0, 0, 6, 1)).expect("fill should succeed");

        assert_eq!(pixel_at(&rgba, 6, 1, 0), [1, 1, 0, 255]);
        assert_eq!(pixel_at(&rgba, 6, 2, 0), [255, 255, 255, 255]);
        assert_eq!(pixel_at(&rgba, 6, 3, 0), [255, 255, 255, 255]);
        assert_eq!(pixel_at(&rgba, 6, 4, 0), [2, 0, 0, 255]);
    }

    #[test]
    fn the_first_listed_display_owns_an_overlapping_pixel() {
        let frames = vec![frame(1, 0, 0, 2, 1, 1.0), frame(2, 0, 0, 2, 1, 1.0)];

        let rgba =
            composite_selection(&frames, selection(0, 0, 1, 1)).expect("overlap should succeed");

        assert_eq!(pixel_at(&rgba, 1, 0, 0), [1, 0, 0, 255]);
        assert_eq!(sample_pixel(&frames, 0, 0), Some([1, 0, 0]));
    }

    #[test]
    fn rejects_a_selection_leaving_the_captured_desktop() {
        let frames = vec![frame(1, 0, 0, 4, 4, 1.0)];

        assert_eq!(
            composite_selection(&frames, selection(2, 0, 4, 1)),
            Err(CompositeError::OutsideDesktop)
        );
        assert_eq!(
            composite_selection(&frames, selection(-1, 0, 2, 1)),
            Err(CompositeError::OutsideDesktop)
        );
    }

    #[test]
    fn rejects_compositing_without_displays() {
        assert_eq!(
            composite_selection(&[], selection(0, 0, 1, 1)),
            Err(CompositeError::NoDisplays)
        );
    }

    #[test]
    fn rejects_an_empty_or_oversized_selection() {
        let frames = vec![frame(1, 0, 0, 4, 4, 1.0)];

        assert_eq!(
            composite_selection(&frames, selection(0, 0, 0, 1)),
            Err(CompositeError::Capacity(CapacityError::EmptyImage))
        );
        assert_eq!(
            composite_selection(&frames, selection(0, 0, 70_000, 1)),
            Err(CompositeError::Capacity(CapacityError::DimensionLimit))
        );
    }

    #[test]
    fn rejects_a_selection_whose_extent_overflows() {
        let frames = vec![frame(1, i32::MAX - 1, 0, 2, 2, 1.0)];

        assert_eq!(
            composite_selection(&frames, selection(i32::MAX - 1, 0, u32::MAX, 1)),
            Err(CompositeError::ArithmeticOverflow)
        );
    }

    #[test]
    fn samples_the_owning_display_and_reports_gaps() {
        let frames = vec![frame(1, 0, 0, 2, 2, 1.0), frame(2, 4, 0, 2, 2, 2.0)];

        assert_eq!(sample_pixel(&frames, 1, 1), Some([1, 1, 1]));
        assert_eq!(sample_pixel(&frames, 5, 0), Some([2, 1, 0]));
        // Gap between the displays, and outside the desktop entirely.
        assert_eq!(sample_pixel(&frames, 3, 0), None);
        assert_eq!(sample_pixel(&frames, -1, 0), None);
    }

    #[test]
    fn formats_hex_as_seven_uppercase_characters() {
        let hex = format_hex([0x0a, 0xb2, 0xff]);

        assert_eq!(hex, "#0AB2FF");
        assert_eq!(hex.len(), 7);
    }
}
