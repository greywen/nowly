//! Test with realistic screenshot content patterns

use image::{ImageEncoder, RgbaImage};
use std::io::Cursor;
use std::time::Instant;

fn realistic_screenshot(width: u32, height: u32) -> RgbaImage {
    let mut img = RgbaImage::new(width, height);
    
    // Simulate typical screenshot content:
    // - Large solid color areas (UI backgrounds)
    // - Text regions (small variations)
    // - Some gradients (buttons, shadows)
    
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let region = (y / 100) % 5;
        
        let color = match region {
            // Solid white background (common in apps)
            0 => [255, 255, 255, 255],
            // Light gray (toolbars)
            1 => [240, 240, 240, 255],
            // Text area (slight noise for anti-aliasing)
            2 => {
                let noise = ((x + y) % 5) as u8;
                [250 - noise, 250 - noise, 250 - noise, 255]
            },
            // Button with gradient
            3 => {
                let grad = (x % 200) as u8;
                [70 + grad/10, 130 + grad/10, 230, 255]
            },
            // Image content (more varied)
            4 => {
                let r = ((x * 173) % 256) as u8;
                let g = ((y * 211) % 256) as u8;
                let b = ((x * y) % 256) as u8;
                [r, g, b, 255]
            },
            _ => [0, 0, 0, 255],
        };
        
        *pixel = image::Rgba(color);
    }
    
    img
}

#[test]
fn realistic_compression_benchmark() {
    let (width, height) = (3840, 2160);
    println!("\n=== Realistic 4K Screenshot Content ===\n");
    
    let image = realistic_screenshot(width, height);
    let raw_size = (width * height * 4) as f64 / 1024.0 / 1024.0;
    println!("Raw RGBA: {:.2} MB\n", raw_size);
    
    let strategies = vec![
        ("Current (Default)", None, None),
        ("Fast + Sub", 
            Some(image::codecs::png::CompressionType::Fast),
            Some(image::codecs::png::FilterType::Sub)),
        ("Fast + NoFilter", 
            Some(image::codecs::png::CompressionType::Fast),
            Some(image::codecs::png::FilterType::NoFilter)),
    ];

    for (name, compression, filter) in strategies {
        let start = Instant::now();
        let mut png = Vec::new();
        
        match (compression, filter) {
            (Some(c), Some(f)) => {
                let encoder = image::codecs::png::PngEncoder::new_with_quality(
                    Cursor::new(&mut png),
                    c,
                    f,
                );
                encoder.write_image(
                    image.as_raw(),
                    width,
                    height,
                    image::ExtendedColorType::Rgba8,
                ).unwrap();
            },
            _ => {
                image::codecs::png::PngEncoder::new(Cursor::new(&mut png))
                    .write_image(
                        image.as_raw(),
                        width,
                        height,
                        image::ExtendedColorType::Rgba8,
                    ).unwrap();
            }
        }
        
        let elapsed = start.elapsed();
        let size = png.len() as f64 / 1024.0 / 1024.0;
        let ratio = size / raw_size * 100.0;
        let speedup = if name.starts_with("Current") { 
            1.0 
        } else { 
            6597.0 / elapsed.as_millis() as f64 
        };
        
        println!(
            "{:20} {:>8.2} MB ({:>5.1}%)  {:>6.0} ms  {:>4.0} MB/s  {:>4.1}x faster",
            name,
            size,
            ratio,
            elapsed.as_millis(),
            raw_size / elapsed.as_secs_f64(),
            speedup
        );
    }
    
    println!("\n💡 Recommendation: Fast + Sub gives best speed/size balance");
}
