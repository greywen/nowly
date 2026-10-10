use image::{ImageEncoder, RgbaImage};
use std::io::Cursor;
use std::time::Instant;

fn complex_image(width: u32, height: u32) -> RgbaImage {
    let mut img = RgbaImage::new(width, height);
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let r = ((x * 255) / width) as u8;
        let g = ((y * 255) / height) as u8;
        let b = ((x + y) % 256) as u8;
        *pixel = image::Rgba([r, g, b, 255]);
    }
    img
}

#[test]
fn find_best_tradeoff() {
    let (width, height) = (3840, 2160);
    println!("\n=== Finding best speed/size tradeoff for 4K ===\n");
    
    let image = complex_image(width, height);
    let raw_size = (width * height * 4) as f64 / 1024.0 / 1024.0;
    
    let strategies = vec![
        ("Default (Current)", image::codecs::png::CompressionType::Default, image::codecs::png::FilterType::Sub),
        ("Fast + NoFilter", image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::NoFilter),
        ("Fast + Sub", image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Sub),
        ("Fast + Paeth", image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Paeth),
        ("Fast + Avg", image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Avg),
        ("Best + Sub", image::codecs::png::CompressionType::Best, image::codecs::png::FilterType::Sub),
    ];

    for (name, compression, filter) in strategies {
        let start = Instant::now();
        let mut png = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new_with_quality(
            Cursor::new(&mut png),
            compression,
            filter,
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
        let ratio = size / raw_size * 100.0;
        println!(
            "{:20} {:>8.2} MB ({:>5.1}%)  {:>6.0} ms  {:>4.0} MB/s",
            name,
            size,
            ratio,
            elapsed.as_millis(),
            raw_size / elapsed.as_secs_f64()
        );
    }
}
