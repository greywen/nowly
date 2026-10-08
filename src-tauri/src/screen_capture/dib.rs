//! Building the Windows DIB the clipboard expects.
//!
//! §8.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md requires
//! standard Windows image clipboard formats, verified to paste as an image in
//! WeChat, Paint and Word — not a path and not Base64 text.
//!
//! `CF_DIB` is the format all three read. Its layout has three properties that are
//! each easy to get wrong, so they are tested here rather than discovered by a
//! black paste in Word:
//!
//! 1. Rows are **bottom-up**: the first row in the buffer is the bottom of the
//!    image.
//! 2. Channels are **BGR**, not RGB.
//! 3. Each row is padded to a **4-byte boundary**.
//!
//! 24-bit BGR is used rather than 32-bit BGRA because the export is opaque anyway
//! (`renderer.rs` asserts it) and some consumers treat a 32-bit DIB's alpha as
//! zero, which pastes as a black rectangle.

use std::mem::size_of;

/// `BITMAPINFOHEADER`, built by hand so the exact 40 bytes are visible and
/// testable without depending on struct padding.
const HEADER_SIZE: usize = 40;
const BITS_PER_PIXEL: u16 = 24;
const BYTES_PER_PIXEL: usize = 3;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DibError {
    EmptyImage,
    /// The RGBA buffer does not match the stated dimensions.
    BufferMismatch,
    /// The DIB would exceed what can be addressed.
    TooLarge,
}

/// Bytes per row, padded up to a 4-byte boundary.
pub(crate) fn row_stride(width: u32) -> usize {
    let unpadded = (width as usize) * BYTES_PER_PIXEL;
    // The standard `((w * bpp + 31) / 32) * 4` rounding, written as byte padding.
    (unpadded + 3) & !3
}

/// Packs straight-alpha RGBA into a `CF_DIB` buffer: header followed by pixels.
pub(crate) fn rgba_to_dib(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, DibError> {
    if width == 0 || height == 0 {
        return Err(DibError::EmptyImage);
    }
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or(DibError::TooLarge)?;
    if rgba.len() != expected {
        return Err(DibError::BufferMismatch);
    }

    let stride = row_stride(width);
    let pixel_bytes = stride
        .checked_mul(height as usize)
        .ok_or(DibError::TooLarge)?;
    let total = HEADER_SIZE
        .checked_add(pixel_bytes)
        .ok_or(DibError::TooLarge)?;
    // i32 because the header stores the dimensions signed.
    if pixel_bytes > i32::MAX as usize {
        return Err(DibError::TooLarge);
    }

    let mut dib = vec![0u8; total];
    write_header(&mut dib[..HEADER_SIZE], width, height, pixel_bytes);

    for y in 0..height as usize {
        // Bottom-up: the last source row goes first.
        let source_row = (height as usize - 1 - y) * (width as usize) * 4;
        let target_row = HEADER_SIZE + y * stride;
        for x in 0..width as usize {
            let source = source_row + x * 4;
            let target = target_row + x * BYTES_PER_PIXEL;
            // BGR, not RGB.
            dib[target] = rgba[source + 2];
            dib[target + 1] = rgba[source + 1];
            dib[target + 2] = rgba[source];
        }
        // The padding bytes stay zero, which is what the format expects.
    }

    Ok(dib)
}

fn write_header(header: &mut [u8], width: u32, height: u32, pixel_bytes: usize) {
    debug_assert_eq!(header.len(), HEADER_SIZE);
    debug_assert_eq!(size_of::<u32>(), 4);

    let put_u32 = |header: &mut [u8], offset: usize, value: u32| {
        header[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    };
    let put_i32 = |header: &mut [u8], offset: usize, value: i32| {
        header[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    };
    let put_u16 = |header: &mut [u8], offset: usize, value: u16| {
        header[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    };

    put_u32(header, 0, HEADER_SIZE as u32); // biSize
    put_i32(header, 4, width as i32); // biWidth
                                      // Positive height means bottom-up, which is what the pixel loop writes.
    put_i32(header, 8, height as i32); // biHeight
    put_u16(header, 12, 1); // biPlanes
    put_u16(header, 14, BITS_PER_PIXEL); // biBitCount
    put_u32(header, 16, 0); // biCompression = BI_RGB
    put_u32(header, 20, pixel_bytes as u32); // biSizeImage
    put_i32(header, 24, 0); // biXPelsPerMeter
    put_i32(header, 28, 0); // biYPelsPerMeter
    put_u32(header, 32, 0); // biClrUsed
    put_u32(header, 36, 0); // biClrImportant
}

#[cfg(test)]
mod tests {
    use super::{rgba_to_dib, row_stride, DibError, HEADER_SIZE};

    /// Reads a little-endian i32 out of the header.
    fn header_i32(dib: &[u8], offset: usize) -> i32 {
        i32::from_le_bytes([
            dib[offset],
            dib[offset + 1],
            dib[offset + 2],
            dib[offset + 3],
        ])
    }

    fn header_u16(dib: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes([dib[offset], dib[offset + 1]])
    }

    #[test]
    fn pads_each_row_to_four_bytes() {
        // 1 pixel is 3 bytes, padded to 4; 2 pixels is 6, padded to 8.
        assert_eq!(row_stride(1), 4);
        assert_eq!(row_stride(2), 8);
        assert_eq!(row_stride(3), 12);
        // 4 pixels is 12, already aligned.
        assert_eq!(row_stride(4), 12);
        assert_eq!(row_stride(5), 16);
    }

    #[test]
    fn writes_the_documented_header() {
        let rgba = vec![0u8; 2 * 2 * 4];

        let dib = rgba_to_dib(&rgba, 2, 2).expect("the conversion should succeed");

        assert_eq!(header_i32(&dib, 0), HEADER_SIZE as i32);
        assert_eq!(header_i32(&dib, 4), 2); // width
                                            // Positive, so bottom-up.
        assert_eq!(header_i32(&dib, 8), 2);
        assert_eq!(header_u16(&dib, 12), 1); // planes
        assert_eq!(header_u16(&dib, 14), 24); // bits
        assert_eq!(header_i32(&dib, 16), 0); // BI_RGB
                                             // biSizeImage is the padded size: stride 8 times 2 rows.
        assert_eq!(header_i32(&dib, 20), 16);
    }

    #[test]
    fn stores_the_channels_as_bgr() {
        // One red pixel: R=255, G=0, B=0 becomes B=0, G=0, R=255.
        let rgba = vec![255, 0, 0, 255];

        let dib = rgba_to_dib(&rgba, 1, 1).expect("the conversion should succeed");

        assert_eq!(&dib[HEADER_SIZE..HEADER_SIZE + 3], &[0, 0, 255]);
    }

    #[test]
    fn stores_the_rows_bottom_up() {
        // A 1×2 image: top pixel white, bottom pixel black. The DIB must hold the
        // black one first, or every pasted screenshot is upside down.
        let rgba = vec![
            255, 255, 255, 255, // top
            0, 0, 0, 255, // bottom
        ];

        let dib = rgba_to_dib(&rgba, 1, 2).expect("the conversion should succeed");

        let stride = row_stride(1);
        assert_eq!(&dib[HEADER_SIZE..HEADER_SIZE + 3], &[0, 0, 0]);
        assert_eq!(
            &dib[HEADER_SIZE + stride..HEADER_SIZE + stride + 3],
            &[255, 255, 255]
        );
    }

    #[test]
    fn keeps_the_padding_bytes_zero() {
        // 1 pixel per row leaves one padding byte, which must not carry pixel data.
        let rgba = vec![10, 20, 30, 255, 40, 50, 60, 255];

        let dib = rgba_to_dib(&rgba, 1, 2).expect("the conversion should succeed");

        assert_eq!(dib[HEADER_SIZE + 3], 0);
        assert_eq!(dib[HEADER_SIZE + row_stride(1) + 3], 0);
    }

    #[test]
    fn drops_the_alpha_channel() {
        // The export is opaque, and a 32-bit DIB's alpha is read as zero by some
        // consumers, which pastes as a black rectangle.
        let rgba = vec![10, 20, 30, 0];

        let dib = rgba_to_dib(&rgba, 1, 1).expect("the conversion should succeed");

        // The colour survives; the zero alpha is simply not stored.
        assert_eq!(&dib[HEADER_SIZE..HEADER_SIZE + 3], &[30, 20, 10]);
        assert_eq!(dib.len(), HEADER_SIZE + row_stride(1));
    }

    #[test]
    fn round_trips_a_recognisable_pattern() {
        // Four distinct pixels, so a transposition or a row swap is visible.
        let rgba = vec![
            1, 2, 3, 255, 4, 5, 6, 255, // top row
            7, 8, 9, 255, 10, 11, 12, 255, // bottom row
        ];

        let dib = rgba_to_dib(&rgba, 2, 2).expect("the conversion should succeed");

        let stride = row_stride(2);
        // First stored row is the source's bottom row, in BGR.
        assert_eq!(&dib[HEADER_SIZE..HEADER_SIZE + 6], &[9, 8, 7, 12, 11, 10]);
        assert_eq!(
            &dib[HEADER_SIZE + stride..HEADER_SIZE + stride + 6],
            &[3, 2, 1, 6, 5, 4]
        );
    }

    #[test]
    fn rejects_an_empty_image() {
        assert_eq!(rgba_to_dib(&[], 0, 0), Err(DibError::EmptyImage));
        assert_eq!(rgba_to_dib(&[], 4, 0), Err(DibError::EmptyImage));
        assert_eq!(rgba_to_dib(&[], 0, 4), Err(DibError::EmptyImage));
    }

    #[test]
    fn rejects_a_buffer_that_does_not_match() {
        // One pixel short, which would otherwise read past the end.
        let rgba = vec![0u8; 2 * 2 * 4 - 4];

        assert_eq!(rgba_to_dib(&rgba, 2, 2), Err(DibError::BufferMismatch));
    }

    #[test]
    fn rejects_dimensions_that_would_overflow() {
        assert_eq!(
            rgba_to_dib(&[0, 0, 0, 0], u32::MAX, u32::MAX),
            Err(DibError::TooLarge)
        );
    }

    #[test]
    fn handles_a_single_pixel_export() {
        // §4.2's 1×1 minimum has to survive to the clipboard.
        let dib = rgba_to_dib(&[7, 8, 9, 255], 1, 1).expect("the conversion should succeed");

        assert_eq!(header_i32(&dib, 4), 1);
        assert_eq!(header_i32(&dib, 8), 1);
        assert_eq!(&dib[HEADER_SIZE..HEADER_SIZE + 3], &[9, 8, 7]);
    }
}
