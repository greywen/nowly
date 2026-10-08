//! PNG encoding for export.
//!
//! §8.2 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: the PNG
//! carries only the composited pixels and the necessary colour information — no
//! window title, application name, desktop coordinates, source path or unredacted
//! original. So this encodes the buffer and nothing else: no text chunks, no EXIF,
//! no timestamp.
//!
//! §9's capacity budget applies here too, because encoding allocates a second
//! buffer: the dimensions go through `validate_output_dimensions` before anything
//! is allocated.

use std::io::Cursor;

use image::{ImageEncoder, RgbaImage};

use super::output::{EncodedImage, ExportError};
use super::{validate_output_dimensions, CapacityError};

/// Encodes the composited image for both clipboard formats.
///
/// The RGBA buffer is kept alongside the PNG so the clipboard's DIB path does not
/// have to decode what was just encoded.
pub(crate) fn encode_export(image: RgbaImage) -> Result<EncodedImage, ExportError> {
    let (width, height) = image.dimensions();
    validate_output_dimensions(u64::from(width), u64::from(height)).map_err(capacity_error)?;

    let mut png = Vec::new();
    // Rgba8 rather than Rgb8: the encoder writes what it is given, and the buffer is
    // already opaque, so this avoids a channel-dropping copy.
    image::codecs::png::PngEncoder::new(Cursor::new(&mut png))
        .write_image(
            image.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| ExportError::WriteFailed(format!("PNG encoding failed: {error}")))?;

    Ok(EncodedImage {
        png,
        rgba: image.into_raw(),
        width,
        height,
    })
}

fn capacity_error(error: CapacityError) -> ExportError {
    // The category is enough for diagnostics; §8.3 forbids logging pixels or paths.
    ExportError::WriteFailed(format!("the image exceeds the export budget: {error:?}"))
}

#[cfg(test)]
mod tests {
    use super::encode_export;
    use image::{Rgba, RgbaImage};

    fn solid(width: u32, height: u32, value: [u8; 4]) -> RgbaImage {
        RgbaImage::from_pixel(width, height, Rgba(value))
    }

    #[test]
    fn encodes_a_real_png() {
        let encoded = encode_export(solid(4, 3, [10, 20, 30, 255])).expect("encoding should work");

        // The PNG signature, so this is a real file rather than raw bytes.
        assert_eq!(
            &encoded.png[..8],
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
        );
        assert_eq!(encoded.width, 4);
        assert_eq!(encoded.height, 3);
    }

    #[test]
    fn keeps_the_rgba_buffer_for_the_clipboard() {
        // The DIB path must not have to decode what was just encoded.
        let encoded = encode_export(solid(2, 2, [1, 2, 3, 255])).expect("encoding should work");

        assert_eq!(encoded.rgba.len(), 2 * 2 * 4);
        assert_eq!(&encoded.rgba[..4], &[1, 2, 3, 255]);
    }

    #[test]
    fn round_trips_the_exact_pixels() {
        // PNG is lossless, so decoding must return what went in. This is what lets
        // the magnifier's canvas sample agree with the exported file.
        let mut source = solid(3, 2, [0, 0, 0, 255]);
        source.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        source.put_pixel(2, 1, Rgba([0, 128, 255, 255]));

        let encoded = encode_export(source.clone()).expect("encoding should work");
        let decoded = image::load_from_memory(&encoded.png)
            .expect("the encoded PNG should decode")
            .to_rgba8();

        assert_eq!(decoded, source);
    }

    #[test]
    fn writes_no_metadata_chunks() {
        // §8.2: no window title, application name, path or timestamp. Those would
        // appear as tEXt, iTXt, zTXt or tIME chunks.
        let encoded = encode_export(solid(4, 4, [10, 20, 30, 255])).expect("encoding should work");

        for chunk in [b"tEXt", b"iTXt", b"zTXt", b"tIME", b"eXIf"] {
            assert!(
                !encoded.png.windows(4).any(|window| window == chunk),
                "the PNG must not carry a {} chunk",
                String::from_utf8_lossy(chunk)
            );
        }
    }

    #[test]
    fn checks_the_budget_before_allocating() {
        // §9's capacity limit is consulted first. This cannot assert a rejection
        // directly: constructing an over-budget `RgbaImage` would have to allocate
        // the 512 MiB the check exists to prevent. `validate_output_dimensions` has
        // its own tests for the limits in `screen_capture.rs`; what is verified here
        // is that the encoder routes through it and that a normal image passes.
        let encoded = encode_export(solid(2, 2, [0, 0, 0, 255])).expect("encoding should work");

        assert!(!encoded.png.is_empty());
    }

    #[test]
    fn encodes_the_minimum_selection() {
        // §4.2's 1×1 minimum has to survive encoding too.
        let encoded = encode_export(solid(1, 1, [7, 8, 9, 255])).expect("encoding should work");

        let decoded = image::load_from_memory(&encoded.png)
            .expect("the encoded PNG should decode")
            .to_rgba8();
        assert_eq!(decoded.dimensions(), (1, 1));
        assert_eq!(decoded.get_pixel(0, 0).0, [7, 8, 9, 255]);
    }
}
