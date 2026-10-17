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
    let same = |row: usize| {
        previous[row * stride..(row + 1) * stride] == next[row * stride..(row + 1) * stride]
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
        a[..4 * 4 * 4].fill(9);
        b[..4 * 4 * 4].fill(9);
        assert!(fixed_edges(&a, &b, 4, 20));
    }
    #[test]
    fn unchanged_frame_is_no_new_content_not_fixed_chrome() {
        let a = vec![1; 4 * 20 * 4];
        assert!(!fixed_edges(&a, &a, 4, 20));
    }
}
