//! The mosaic algorithm.
//!
//! §5.3 fixes this bit-for-bit, because a mosaic is the one annotation whose
//! purpose is destroying information: if the preview and the exported file
//! disagree, the user sees something covered that is not.
//!
//! The rules, in order:
//!
//! 1. The base image and the ordinary annotations are composited first, into an
//!    opaque 8-bit sRGB image.
//! 2. The grid is divided from image `(0, 0)` by the chosen block size, not from
//!    the mosaic rectangle's own origin.
//! 3. For the valid pixels of `grid cell ∩ mosaic rect ∩ image`, each channel is
//!    the arithmetic mean rounded to an integer, and that value fills exactly
//!    that intersection.
//! 4. A partial edge block counts only the pixels that exist; it is not
//!    zero-padded.
//! 5. Several mosaics each sample from the *same* pre-mosaic composite and are
//!    painted in creation order, so any one of them can be recomputed
//!    independently.
//!
//! Rule 5 is the one that is easy to get wrong: sampling from the running result
//! would make a later mosaic depend on an earlier one, and the two could no
//! longer be verified separately.
//!
//! This is final occlusion, not a cryptographic guarantee.

const CHANNELS: usize = 4;

/// A mosaic rectangle in output image pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MosaicRegion {
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
    /// 8, 16 or 24 output physical pixels, per §5.2.
    pub block_size: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MosaicError {
    ZeroBlockSize,
    BufferMismatch,
}

/// Applies every mosaic to an RGBA buffer, in creation order.
///
/// `rgba` must already hold the base image with the ordinary annotations
/// composited over it.
pub(crate) fn apply_mosaics(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    regions: &[MosaicRegion],
) -> Result<(), MosaicError> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(CHANNELS))
        .ok_or(MosaicError::BufferMismatch)?;
    if rgba.len() != expected {
        return Err(MosaicError::BufferMismatch);
    }
    if regions.iter().any(|region| region.block_size == 0) {
        return Err(MosaicError::ZeroBlockSize);
    }
    if regions.is_empty() || width == 0 || height == 0 {
        return Ok(());
    }

    // Every region samples from this untouched copy, never from the running
    // result, so each one stays independently reproducible.
    let source = rgba.to_vec();

    for region in regions {
        apply_one(&source, rgba, width, height, *region);
    }
    Ok(())
}

fn apply_one(source: &[u8], target: &mut [u8], width: u32, height: u32, region: MosaicRegion) {
    // `grid cell ∩ mosaic rect ∩ image`, resolved in i64 so a negative or
    // oversized rectangle cannot wrap.
    let left = region.x.max(0);
    let top = region.y.max(0);
    let right = (region.x + i64::from(region.width)).min(i64::from(width));
    let bottom = (region.y + i64::from(region.height)).min(i64::from(height));
    if left >= right || top >= bottom {
        return;
    }

    let block = i64::from(region.block_size);
    // The grid is anchored to the image origin, so the first cell starts at the
    // block boundary at or before the rectangle's edge.
    let first_column = left - left.rem_euclid(block);
    let first_row = top - top.rem_euclid(block);

    let mut cell_top = first_row;
    while cell_top < bottom {
        let mut cell_left = first_column;
        while cell_left < right {
            let from_x = cell_left.max(left);
            let to_x = (cell_left + block).min(right);
            let from_y = cell_top.max(top);
            let to_y = (cell_top + block).min(bottom);

            if from_x < to_x && from_y < to_y {
                let fill = mean(source, width, from_x, to_x, from_y, to_y);
                for y in from_y..to_y {
                    for x in from_x..to_x {
                        let index = pixel_index(width, x, y);
                        target[index..index + CHANNELS].copy_from_slice(&fill);
                    }
                }
            }
            cell_left += block;
        }
        cell_top += block;
    }
}

/// Per-channel arithmetic mean, rounded half up.
///
/// Integer arithmetic on purpose: `(sum + count / 2) / count` is exactly the
/// specified rounding for non-negative values, and avoids any float rounding mode
/// difference between platforms or between Rust and a WebView.
fn mean(
    source: &[u8],
    width: u32,
    from_x: i64,
    to_x: i64,
    from_y: i64,
    to_y: i64,
) -> [u8; CHANNELS] {
    let mut sums = [0u64; CHANNELS];
    let mut count = 0u64;

    for y in from_y..to_y {
        for x in from_x..to_x {
            let index = pixel_index(width, x, y);
            for channel in 0..CHANNELS {
                sums[channel] += u64::from(source[index + channel]);
            }
            count += 1;
        }
    }

    let mut fill = [0u8; CHANNELS];
    for channel in 0..CHANNELS {
        fill[channel] = ((sums[channel] + count / 2) / count) as u8;
    }
    fill
}

fn pixel_index(width: u32, x: i64, y: i64) -> usize {
    ((y as usize) * (width as usize) + (x as usize)) * CHANNELS
}

#[cfg(test)]
mod tests {
    use super::{apply_mosaics, MosaicError, MosaicRegion};

    /// A greyscale image where every pixel's channels equal its listed value, so
    /// expected means can be computed by hand.
    fn image(values: &[u8]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| [*value, *value, *value, 255])
            .collect()
    }

    /// The listed value of each pixel, for comparison against hand arithmetic.
    fn values(rgba: &[u8]) -> Vec<u8> {
        rgba.chunks_exact(4).map(|pixel| pixel[0]).collect()
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
    fn averages_each_block_from_the_image_origin_grid() {
        // 4x2, block 2 -> two cells. Independent truth:
        //   left  cell: 0, 10, 40, 50 -> 100 / 4 = 25
        //   right cell: 20, 30, 60, 70 -> 180 / 4 = 45
        let mut rgba = image(&[0, 10, 20, 30, 40, 50, 60, 70]);

        apply_mosaics(&mut rgba, 4, 2, &[region(0, 0, 4, 2, 2)]).expect("mosaic should apply");

        assert_eq!(values(&rgba), vec![25, 25, 45, 45, 25, 25, 45, 45]);
    }

    #[test]
    fn anchors_the_grid_to_the_image_not_to_the_rectangle() {
        // The rectangle starts at x=1, but the grid still breaks at x=2. So the
        // first intersection is the single column x=1 of the cell 0..2, and the
        // second is x=2..3 of the cell 2..4.
        //   x=1 alone: 10 -> 10 (unchanged)
        //   x=2..3:    20, 30 -> 50 / 2 = 25
        let mut rgba = image(&[0, 10, 20, 30]);

        apply_mosaics(&mut rgba, 4, 1, &[region(1, 0, 3, 1, 2)]).expect("mosaic should apply");

        assert_eq!(values(&rgba), vec![0, 10, 25, 25]);
    }

    #[test]
    fn a_partial_edge_block_counts_only_real_pixels() {
        // 3 wide, block 2: the second cell holds one pixel and must not be
        // zero-padded into 20 / 2 = 10.
        //   cell 0..2: 0, 10 -> 5
        //   cell 2..3: 20 -> 20
        let mut rgba = image(&[0, 10, 20]);

        apply_mosaics(&mut rgba, 3, 1, &[region(0, 0, 3, 1, 2)]).expect("mosaic should apply");

        assert_eq!(values(&rgba), vec![5, 5, 20]);
    }

    #[test]
    fn rounds_a_half_upwards() {
        // 0, 1, 2, 3 -> 6 / 4 = 1.5 -> 2
        let mut rgba = image(&[0, 1, 2, 3]);
        apply_mosaics(&mut rgba, 2, 2, &[region(0, 0, 2, 2, 2)]).expect("mosaic should apply");
        assert_eq!(values(&rgba), vec![2, 2, 2, 2]);

        // 0, 1, 2, 2 -> 5 / 4 = 1.25 -> 1
        let mut rgba = image(&[0, 1, 2, 2]);
        apply_mosaics(&mut rgba, 2, 2, &[region(0, 0, 2, 2, 2)]).expect("mosaic should apply");
        assert_eq!(values(&rgba), vec![1, 1, 1, 1]);
    }

    #[test]
    fn averages_each_channel_independently() {
        let mut rgba = vec![
            0, 10, 20, 255, //
            2, 20, 40, 255, //
        ];

        apply_mosaics(&mut rgba, 2, 1, &[region(0, 0, 2, 1, 2)]).expect("mosaic should apply");

        // R: 2/2 = 1, G: 30/2 = 15, B: 60/2 = 30, A untouched at 255.
        assert_eq!(rgba, vec![1, 15, 30, 255, 1, 15, 30, 255]);
    }

    #[test]
    fn overlapping_mosaics_each_sample_the_same_pre_mosaic_image() {
        // Two 1x1-block mosaics cannot change anything, so use block 2 over a
        // 4x1 image with an overlap at x=2..3.
        //   first  (x 0..3): cell 0..2 -> (0 + 10) / 2 = 5; cell 2..3 -> 20
        //   second (x 2..4): cell 2..4 -> sampled from the ORIGINAL 20, 30 -> 25
        // If the second had sampled the running result it would see 20, 30 too
        // here, so the distinguishing case is below.
        let mut rgba = image(&[0, 10, 20, 30]);

        apply_mosaics(
            &mut rgba,
            4,
            1,
            &[region(0, 0, 3, 1, 2), region(2, 0, 2, 1, 2)],
        )
        .expect("mosaic should apply");

        assert_eq!(values(&rgba), vec![5, 5, 25, 25]);
    }

    #[test]
    fn a_later_mosaic_does_not_see_an_earlier_one_s_output() {
        // The distinguishing case. Both mosaics cover the same cell 0..2:
        //   first,  block 2: (0 + 100) / 2 = 50, so the cell becomes 50, 50
        //   second, block 1: each pixel is its own mean, sampled from the
        //                    ORIGINAL -> 0, 100 again.
        // Sampling the running result would instead give 50, 50.
        let mut rgba = image(&[0, 100]);

        apply_mosaics(
            &mut rgba,
            2,
            1,
            &[region(0, 0, 2, 1, 2), region(0, 0, 2, 1, 1)],
        )
        .expect("mosaic should apply");

        assert_eq!(values(&rgba), vec![0, 100]);
    }

    #[test]
    fn creation_order_decides_an_overlap() {
        // Reversing the order of the previous case leaves the block-2 average,
        // proving later wins on the overlap.
        let mut rgba = image(&[0, 100]);

        apply_mosaics(
            &mut rgba,
            2,
            1,
            &[region(0, 0, 2, 1, 1), region(0, 0, 2, 1, 2)],
        )
        .expect("mosaic should apply");

        assert_eq!(values(&rgba), vec![50, 50]);
    }

    #[test]
    fn clips_a_rectangle_reaching_outside_the_image() {
        // Negative origin and an oversized extent must be clipped, not wrapped.
        let mut rgba = image(&[0, 10, 20, 30]);

        apply_mosaics(&mut rgba, 2, 2, &[region(-4, -4, 100, 100, 2)])
            .expect("mosaic should apply");

        // One cell over the whole image: (0 + 10 + 20 + 30) / 4 = 15.
        assert_eq!(values(&rgba), vec![15, 15, 15, 15]);
    }

    #[test]
    fn leaves_the_image_alone_for_a_rectangle_entirely_outside() {
        let mut rgba = image(&[0, 10, 20, 30]);
        let before = rgba.clone();

        apply_mosaics(&mut rgba, 2, 2, &[region(50, 50, 10, 10, 8)]).expect("mosaic should apply");

        assert_eq!(rgba, before);
    }

    #[test]
    fn leaves_the_image_alone_without_regions() {
        let mut rgba = image(&[0, 10, 20, 30]);
        let before = rgba.clone();

        apply_mosaics(&mut rgba, 2, 2, &[]).expect("no regions should be a no-op");

        assert_eq!(rgba, before);
    }

    #[test]
    fn rejects_a_zero_block_size_before_touching_pixels() {
        let mut rgba = image(&[0, 10, 20, 30]);
        let before = rgba.clone();

        assert_eq!(
            apply_mosaics(&mut rgba, 2, 2, &[region(0, 0, 2, 2, 0)]),
            Err(MosaicError::ZeroBlockSize)
        );
        assert_eq!(rgba, before);
    }

    #[test]
    fn rejects_a_buffer_that_does_not_match_the_dimensions() {
        let mut rgba = image(&[0, 10, 20]);

        assert_eq!(
            apply_mosaics(&mut rgba, 2, 2, &[region(0, 0, 2, 2, 2)]),
            Err(MosaicError::BufferMismatch)
        );
    }

    #[test]
    fn the_documented_block_sizes_all_work() {
        // 8, 16 and 24 from §5.2, on an image large enough for each.
        for block in [8u32, 16, 24] {
            let mut rgba = image(&vec![128; 32 * 32]);

            apply_mosaics(&mut rgba, 32, 32, &[region(0, 0, 32, 32, block)])
                .expect("mosaic should apply");

            // A uniform image stays uniform whatever the block size.
            assert!(values(&rgba).iter().all(|value| *value == 128));
        }
    }
}
