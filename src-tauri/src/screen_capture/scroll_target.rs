use serde::{Deserialize, Serialize};

/// A selection in signed virtual-desktop physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Region {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The selection relative to the overlay window that shows it, clamped to the
/// window. `None` when it does not overlap the window at all.
pub(crate) fn window_hole(region: Region, window: Region) -> Option<(i32, i32, i32, i32)> {
    let left = (region.x as i64).max(window.x as i64);
    let top = (region.y as i64).max(window.y as i64);
    let right = (region.x as i64 + region.width as i64).min(window.x as i64 + window.width as i64);
    let bottom =
        (region.y as i64 + region.height as i64).min(window.y as i64 + window.height as i64);
    if right <= left || bottom <= top {
        return None;
    }
    Some((
        (left - window.x as i64) as i32,
        (top - window.y as i64) as i32,
        (right - window.x as i64) as i32,
        (bottom - window.y as i64) as i32,
    ))
}

/// Reads the live screen pixels under the selection. Nowly's own overlay is cut
/// open over the selection and excluded from capture, so this is whatever the
/// user is scrolling underneath.
#[cfg(windows)]
pub(crate) fn capture_region(region: Region) -> Result<Vec<u8>, String> {
    use super::backend::{CaptureSource, DisplayInfo};
    let display = DisplayInfo {
        id: 0,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        scale_factor: 1.,
        is_primary: false,
    };
    super::gdi::GdiSource
        .capture_rgba(&display)
        .map_err(|_| "Live capture failed".to_string())
}

#[cfg(not(windows))]
pub(crate) fn capture_region(_: Region) -> Result<Vec<u8>, String> {
    Err("Scroll capture requires Windows.".into())
}

pub(crate) fn validate_black_frame(
    pixels: Vec<u8>,
    read_desktop: impl FnOnce() -> Result<Vec<u8>, String>,
) -> Result<(Vec<u8>, bool), String> {
    let black = !pixels.is_empty() && pixels.len() % 4 == 0
        && pixels.chunks_exact(4).all(|pixel| pixel[..3] == [0, 0, 0]);
    if !black { return Ok((pixels, false)); }
    // Desktop Duplication may mask excluded surfaces as black. Corroborate
    // before committing that frame; true black content is still accepted.
    let desktop = read_desktop()?;
    if desktop.len() != pixels.len() {
        return Err("Live desktop validation returned a different frame size".into());
    }
    let differs = desktop.chunks_exact(4).any(|pixel| pixel[..3] != [0, 0, 0]);
    if differs { Ok((desktop, true)) } else { Ok((pixels, false)) }
}
