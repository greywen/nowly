//! PNG compression benchmark: comparing different strategies
//!
//! This test measures encoding time and file size for different PNG compression
//! approaches to understand why saving is slow.

use image::{ImageEncoder, RgbaImage};
use std::io::Cursor;
use std::time::Instant;

fn solid_image(width: u32, height: u32) -> RgbaImage {
    RgbaImage::from_pixel(width, height, image::Rgba([128, 128, 128, 255]))
}

fn complex_image(width: u32, height: u32) -> RgbaImage {
    let mut img = RgbaImage::new(width, height);
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        // Simulate screenshot content with some variation
        let r = ((x * 255) / width) as u8;
        let g = ((y * 255) / height) as u8;
        let b = ((x + y) % 256) as u8;
        *pixel = image::Rgba([r, g, b, 255]);
    }
    img
}

#[test]
fn benchmark_png_strategies() {
    let sizes = vec![
        (1920, 1080, "1080p"),
        (2560, 1440, "1440p"),
        (3840, 2160, "4K"),
    ];

    for (width, height, name) in sizes {
        println!("\n=== {} ({}x{}) ===", name, width, height);
        
        let image = complex_image(width, height);
        let raw_size = (width * height * 4) as f64 / 1024.0 / 1024.0;
        println!("Raw RGBA: {:.2} MB", raw_size);

        // Strategy 1: Current approach (default compression)
        {
            let start = Instant::now();
            let mut png = Vec::new();
            image::codecs::png::PngEncoder::new(Cursor::new(&mut png))
                .write_image(
                    image.as_raw(),
                    width,
                    height,
                    image::ExtendedColorType::Rgba8,
                )
                .unwrap();
            let elapsed = start.elapsed();
            let size = png.len() as f64 / 1024.0 / 1024.0;
            println!(
                "Default PNG:  {:.2} MB, {:?} ({:.0} MB/s)",
                size,
                elapsed,
                raw_size / elapsed.as_secs_f64()
            );
        }

        // Strategy 2: Fast compression (CompressionType::Fast)
        {
            let start = Instant::now();
            let mut png = Vec::new();
            let encoder = image::codecs::png::PngEncoder::new_with_quality(
                Cursor::new(&mut png),
                image::codecs::png::CompressionType::Fast,
                image::codecs::png::FilterType::NoFilter,
            );
            encoder
                .write_image(
                    image.as_raw(),
                    width,
                    height,
                    image::ExtendedColorType::Rgba8,
                )
                .unwrap();
            let elapsed = start.elapsed();
            let size = png.len() as f64 / 1024.0 / 1024.0;
            println!(
                "Fast PNG:     {:.2} MB, {:?} ({:.0} MB/s)",
                size,
                elapsed,
                raw_size / elapsed.as_secs_f64()
            );
        }

        // Strategy 3: RGB instead of RGBA (drop alpha channel)
        {
            let start = Instant::now();
            let mut rgb = Vec::with_capacity((width * height * 3) as usize);
            for pixel in image.pixels() {
                rgb.extend_from_slice(&pixel.0[0..3]);
            }
            let mut png = Vec::new();
            let encoder = image::codecs::png::PngEncoder::new_with_quality(
                Cursor::new(&mut png),
                image::codecs::png::CompressionType::Fast,
                image::codecs::png::FilterType::NoFilter,
            );
            encoder
                .write_image(&rgb, width, height, image::ExtendedColorType::Rgb8)
                .unwrap();
            let elapsed = start.elapsed();
            let size = png.len() as f64 / 1024.0 / 1024.0;
            println!(
                "Fast RGB:     {:.2} MB, {:?} ({:.0} MB/s)",
                size,
                elapsed,
                raw_size / elapsed.as_secs_f64()
            );
        }

        // Strategy 4: Best compression (for comparison)
        {
            let start = Instant::now();
            let mut png = Vec::new();
            let encoder = image::codecs::png::PngEncoder::new_with_quality(
                Cursor::new(&mut png),
                image::codecs::png::CompressionType::Best,
                image::codecs::png::FilterType::Sub,
            );
            encoder
                .write_image(
                    image.as_raw(),
                    width,
                    height,
                    image::ExtendedColorType::Rgba8,
                )
                .unwrap();
            let elapsed = start.elapsed();
            let size = png.len() as f64 / 1024.0 / 1024.0;
            println!(
                "Best PNG:     {:.2} MB, {:?} ({:.0} MB/s)",
                size,
                elapsed,
                raw_size / elapsed.as_secs_f64()
            );
        }
    }
}
