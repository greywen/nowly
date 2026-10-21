use serde::Serialize;

/// Scrolling capture starts the moment it is chosen and has no pause: the user
/// scrolls to add content and stops scrolling to add nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ScrollPhase {
    Capturing,
    /// The confirmed image was handed to the screenshot output; nothing more is added.
    Finished,
    Cancelled,
}

/// Why the last frames added nothing, shown beside the selection. None of these
/// ends the capture: the confirmed image is kept and the next frame is tried.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ScrollHint {
    /// The new view does not overlap the confirmed end, usually from scrolling too far at once.
    LostTrack,
    /// The selection includes rows that do not move, such as a sticky header.
    FixedEdges,
    /// The size limit was reached; finishing keeps everything captured so far.
    Full,
    /// The screen could not be read.
    CaptureFailed,
}

#[derive(Default)]
pub(crate) struct FrameSampler;
impl FrameSampler {
    pub fn sample(&mut self, pixels: Vec<u8>, confirmed: Option<&[u8]>) -> Option<Vec<u8>> {
        if confirmed.is_some_and(|frame| frames_close(frame, &pixels)) {
            return None;
        }
        Some(pixels)
    }
}

/// Accept only tiny, sparse capture noise. Keeping the original pixels means this is
/// used solely for deciding stability; it cannot blur or rewrite the stitched image.
pub(crate) fn frames_close(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() || left.is_empty() {
        return false;
    }
    if left.len() % 4 != 0 {
        return left == right;
    }
    let mut changed_pixels = 0usize;
    for (a, b) in left.chunks_exact(4).zip(right.chunks_exact(4)) {
        if a[3] != b[3] || a[..3].iter().zip(&b[..3]).any(|(x, y)| x.abs_diff(*y) > 3) {
            changed_pixels += 1;
        }
    }
    changed_pixels <= (left.len() / 4).max(1) / 200
}

#[cfg(test)]
mod tests {
    use super::FrameSampler;

    #[test]
    fn tolerates_sparse_capture_noise_but_not_moving_content() {
        let base = vec![100u8; 20 * 20 * 4];
        let mut noisy = base.clone();
        noisy[0] = 102;
        let mut sampler = FrameSampler::default();
        assert!(sampler.sample(base.clone(), None).is_some());
        assert!(sampler.sample(noisy, Some(&base)).is_none());

        let mut moving = base.clone();
        moving[..4 * 20 * 4].fill(0);
        let mut sampler = FrameSampler::default();
        assert!(sampler.sample(base.clone(), None).is_some());
        assert!(sampler.sample(moving, Some(&base)).is_some());
    }
}
