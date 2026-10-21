/// Fixed chrome must not be silently joined into the middle of a long image.
/// With only two frames its identity cannot be proved; reject instead of guessing.
pub(crate) fn fixed_edges(previous: &[u8], next: &[u8], width: u32, height: u32) -> bool {
    let stride = width as usize * 4;
    if stride == 0
        || previous.len() != stride * height as usize
        || next.len() != previous.len()
        || previous == next
    {
        return false;
    }
    let informative = |row: usize| {
        let pixels = &previous[row * stride..(row + 1) * stride];
        let first = pixels[..3].to_vec();
        pixels.chunks_exact(4).any(|pixel| {
            pixel[..3]
                .iter()
                .zip(&first)
                .any(|(a, b)| a.abs_diff(*b) >= 4)
        })
    };
    let same = |row: usize| {
        previous[row * stride..(row + 1) * stride] == next[row * stride..(row + 1) * stride]
            && informative(row)
    };
    let top = (0..height as usize).take_while(|&row| same(row)).count();
    let bottom = (0..height as usize)
        .rev()
        .take_while(|&row| same(row))
        .count();
    top >= 4 || bottom >= 4
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unproven_fixed_header_without_dropping_confirmed_pixels() {
        let mut a = vec![1; 4 * 20 * 4];
        let mut b = vec![2; 4 * 20 * 4];
        for row in 0..4 {
            for column in 0..4 {
                let pixel = (row * 4 + column) * 4;
                a[pixel..pixel + 4].copy_from_slice(&[9, (column * 20) as u8, 30, 255]);
                b[pixel..pixel + 4].copy_from_slice(&[9, (column * 20) as u8, 30, 255]);
            }
        }
        assert!(fixed_edges(&a, &b, 4, 20));
    }
    #[test]
    fn blank_top_and_bottom_margins_are_not_fixed_chrome() {
        let mut previous = vec![255; 32 * 40 * 4];
        let mut next = previous.clone();
        previous[8 * 32 * 4..32 * 32 * 4].fill(40);
        next[8 * 32 * 4..32 * 32 * 4].fill(80);
        assert!(!fixed_edges(&previous, &next, 32, 40));
    }

    #[test]
    fn unchanged_frame_is_no_new_content_not_fixed_chrome() {
        let a = vec![1; 4 * 20 * 4];
        assert!(!fixed_edges(&a, &a, 4, 20));
    }
}
