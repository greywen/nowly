//! The frozen frames of the active session, and the local channel that carries
//! them to the overlay WebViews.
//!
//! §9 forbids pushing pixels through huge Base64/JSON invokes and forbids
//! re-capturing the screen on every pointer move. Instead each display's frozen
//! frame is served over a local URI scheme as an uncompressed bitmap, so the
//! WebView decodes it natively for the magnifier and colour readout. The desktop
//! the user sees comes from the native freeze layer, so this transfer is off the
//! path to the first visible frame.
//!
//! The URL carries the session id as well as the display id, so a request that
//! belongs to a finished session is rejected rather than answered with a newer
//! session's desktop.

use std::sync::Mutex;

use super::backend::CapturedDisplay;
use super::candidates::{clip_to_display, WindowBounds};

/// What an overlay needs to render its frame. Deliberately carries no pixels.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDescriptor {
    /// Stringified for JavaScript, where a u64 would lose precision.
    pub display_id: u32,
    pub width: u32,
    pub height: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    pub window_candidates: Vec<WindowBounds>,
}

#[derive(Debug)]
struct SessionFrames {
    session_id: u64,
    frames: Vec<CapturedDisplay>,
    candidates: Vec<WindowBounds>,
}

#[derive(Debug, Default)]
pub struct FrameStore(Mutex<Option<SessionFrames>>, std::sync::atomic::AtomicU64);

impl FrameStore {
    pub(crate) fn activate(&self, session_id: u64) {
        self.1
            .store(session_id, std::sync::atomic::Ordering::SeqCst);
    }

    pub(crate) fn retire(&self, session_id: u64) {
        let _ = self.1.compare_exchange(
            session_id,
            0,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        );
    }

    /// The owner check happens after acquiring the frame lock, without holding
    /// ActiveCapture's mutex while a previous frame request finishes copying.
    pub(crate) fn store_if_current(
        &self,
        session_id: u64,
        frames: Vec<CapturedDisplay>,
        candidates: Vec<WindowBounds>,
    ) -> bool {
        let mut held = self.0.lock().unwrap();
        if self.1.load(std::sync::atomic::Ordering::SeqCst) != session_id {
            return false;
        }
        *held = Some(SessionFrames {
            session_id,
            frames,
            candidates,
        });
        true
    }

    #[cfg(test)]
    pub(crate) fn store(&self, session_id: u64, frames: Vec<CapturedDisplay>) {
        *self.0.lock().unwrap() = Some(SessionFrames {
            session_id,
            frames,
            candidates: Vec::new(),
        });
    }

    /// Runs `body` against this session's raw frames, for compositing an export.
    ///
    /// Closure-based rather than returning a clone: the frames are the whole desktop
    /// in physical pixels, and copying them would double the session's peak memory
    /// for no reason.
    pub(crate) fn with_frames<T>(
        &self,
        session_id: u64,
        body: impl FnOnce(&[CapturedDisplay]) -> T,
    ) -> Option<T> {
        let guard = self.0.lock().unwrap();
        let session = guard.as_ref()?;
        if session.session_id != session_id {
            // A superseded session's frames must not serve a new export.
            return None;
        }
        Some(body(&session.frames))
    }

    /// Drops every frame and cached encoding. §8.3 requires the session's base
    /// images to be released when it ends.
    #[cfg(test)]
    pub(crate) fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }

    pub(crate) fn clear_if_session(&self, session_id: u64) {
        let mut held = self.0.lock().unwrap();
        if held
            .as_ref()
            .is_some_and(|frames| frames.session_id == session_id)
        {
            *held = None;
        }
    }

    #[cfg(test)]
    pub(crate) fn session_id(&self) -> Option<u64> {
        self.0.lock().unwrap().as_ref().map(|held| held.session_id)
    }

    #[cfg(test)]
    pub(crate) fn descriptor(&self, display_id: u32) -> Option<FrameDescriptor> {
        self.descriptor_for(self.session_id()?, display_id)
    }

    pub(crate) fn descriptor_for(
        &self,
        session_id: u64,
        display_id: u32,
    ) -> Option<FrameDescriptor> {
        let held = self.0.lock().unwrap();
        let held = held.as_ref()?;
        if held.session_id != session_id {
            return None;
        }
        let frame = held
            .frames
            .iter()
            .find(|frame| frame.display.id == display_id)?;
        Some(FrameDescriptor {
            display_id,
            width: frame.display.width,
            height: frame.display.height,
            origin_x: frame.display.x,
            origin_y: frame.display.y,
            window_candidates: clip_to_display(&held.candidates, &frame.display),
        })
    }

    /// Bitmap bytes for one display of one session.
    ///
    /// Returns `None` for an unknown display or a session that is no longer the
    /// active one, so a late request cannot read a different desktop. Built per
    /// request rather than cached: the response needs its own buffer anyway, and
    /// a cache would hold a second full copy of the desktop for the session.
    pub(crate) fn bitmap(&self, session_id: u64, display_id: u32) -> Option<Vec<u8>> {
        let held = self.0.lock().unwrap();
        let held = held.as_ref()?;
        if held.session_id != session_id {
            return None;
        }
        let frame = held
            .frames
            .iter()
            .find(|frame| frame.display.id == display_id)?;
        encode_bitmap(frame)
    }
}

const FILE_HEADER_LEN: usize = 14;
const V4_HEADER_LEN: usize = 108;

/// A top-down 32-bit `BITMAPV4HEADER` bitmap whose bitfield masks describe the
/// stored RGBA byte order, so the pixels are copied without any per-pixel work.
fn encode_bitmap(frame: &CapturedDisplay) -> Option<Vec<u8>> {
    let width = i32::try_from(frame.display.width).ok()?;
    let height = i32::try_from(frame.display.height).ok()?;
    let image_len = u32::try_from(frame.rgba.len()).ok()?;
    if u64::from(image_len) != u64::from(frame.display.width) * u64::from(frame.display.height) * 4
    {
        return None;
    }
    let offset = (FILE_HEADER_LEN + V4_HEADER_LEN) as u32;
    let file_len = offset.checked_add(image_len)?;

    let mut bytes = Vec::with_capacity(file_len as usize);
    bytes.extend_from_slice(b"BM");
    bytes.extend_from_slice(&file_len.to_le_bytes());
    bytes.extend_from_slice(&[0; 4]);
    bytes.extend_from_slice(&offset.to_le_bytes());

    bytes.extend_from_slice(&(V4_HEADER_LEN as u32).to_le_bytes());
    bytes.extend_from_slice(&width.to_le_bytes());
    // Negative height: row 0 is the top row, matching the stored frame.
    bytes.extend_from_slice(&(-height).to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&32u16.to_le_bytes());
    const BI_BITFIELDS: u32 = 3;
    bytes.extend_from_slice(&BI_BITFIELDS.to_le_bytes());
    bytes.extend_from_slice(&image_len.to_le_bytes());
    // 72 DPI; informational only.
    bytes.extend_from_slice(&2835u32.to_le_bytes());
    bytes.extend_from_slice(&2835u32.to_le_bytes());
    bytes.extend_from_slice(&[0; 8]);
    // Masks over a little-endian pixel whose bytes are R, G, B, A.
    for mask in [0x0000_00FFu32, 0x0000_FF00, 0x00FF_0000, 0xFF00_0000] {
        bytes.extend_from_slice(&mask.to_le_bytes());
    }
    const LCS_SRGB: u32 = 0x7352_4742;
    bytes.extend_from_slice(&LCS_SRGB.to_le_bytes());
    // Endpoints and gamma are ignored for sRGB.
    bytes.extend_from_slice(&[0; 48]);
    debug_assert_eq!(bytes.len(), offset as usize);

    bytes.extend_from_slice(&frame.rgba);
    Some(bytes)
}

/// `/<session id>/<display id>` from the frame URL.
///
/// Strict on purpose: anything else is rejected rather than guessed at, since
/// this path decides which desktop pixels get served.
pub(crate) fn parse_frame_path(path: &str) -> Option<(u64, u32)> {
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let session = parts.next()?.parse().ok()?;
    let display = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((session, display))
}

#[cfg(test)]
mod tests {
    use super::super::backend::{CapturedDisplay, DisplayInfo};
    use super::{parse_frame_path, FrameDescriptor, FrameStore};

    fn frame(id: u32, width: u32, height: u32) -> CapturedDisplay {
        CapturedDisplay {
            display: DisplayInfo {
                id,
                x: 0,
                y: 0,
                width,
                height,
                scale_factor: 1.5,
                is_primary: id == 0,
            },
            // Opaque, like every captured desktop.
            rgba: vec![255; (width * height * 4) as usize],
        }
    }

    #[test]
    fn parses_a_session_and_display_pair() {
        assert_eq!(parse_frame_path("/7/3"), Some((7, 3)));
        assert_eq!(parse_frame_path("7/3"), Some((7, 3)));
    }

    #[test]
    fn rejects_anything_but_exactly_two_numbers() {
        // This path picks which desktop pixels are served, so a malformed or
        // over-long path must not be interpreted loosely.
        assert_eq!(parse_frame_path("/7"), None);
        assert_eq!(parse_frame_path("/7/3/9"), None);
        assert_eq!(parse_frame_path("/7/x"), None);
        assert_eq!(parse_frame_path("/../3"), None);
        assert_eq!(parse_frame_path("/-1/3"), None);
        assert_eq!(parse_frame_path(""), None);
        // Wider than u32: must not wrap into a valid display id.
        assert_eq!(parse_frame_path("/7/4294967296"), None);
    }

    #[test]
    fn serves_a_top_down_rgba_bitmap_for_a_stored_display() {
        let store = FrameStore::default();
        let mut captured = frame(0, 3, 2);
        for (index, byte) in captured.rgba.iter_mut().enumerate() {
            *byte = index as u8;
        }
        store.store(1, vec![captured.clone()]);

        let bitmap = store.bitmap(1, 0).expect("the frame should be served");

        let u32_at = |at: usize| u32::from_le_bytes(bitmap[at..at + 4].try_into().unwrap());
        let i32_at = |at: usize| i32::from_le_bytes(bitmap[at..at + 4].try_into().unwrap());
        assert_eq!(&bitmap[..2], b"BM");
        assert_eq!(u32_at(2) as usize, bitmap.len());
        assert_eq!(u32_at(10), 122, "pixels follow the file and V4 headers");
        assert_eq!(u32_at(14), 108, "BITMAPV4HEADER");
        assert_eq!(i32_at(18), 3);
        assert_eq!(i32_at(22), -2, "negative height means top-down rows");
        assert_eq!(u16::from_le_bytes([bitmap[26], bitmap[27]]), 1);
        assert_eq!(u16::from_le_bytes([bitmap[28], bitmap[29]]), 32);
        assert_eq!(u32_at(30), 3, "BI_BITFIELDS");
        assert_eq!(u32_at(34) as usize, captured.rgba.len());
        assert_eq!(
            [u32_at(54), u32_at(58), u32_at(62), u32_at(66)],
            [0x0000_00FF, 0x0000_FF00, 0x00FF_0000, 0xFF00_0000],
            "masks name R, G, B, A in stored byte order"
        );
        assert_eq!(&bitmap[122..], &captured.rgba[..]);
    }

    /// Writes a known pattern for a real-browser decode check; see the startup
    /// plan document for the check itself.
    #[test]
    #[ignore = "writes a fixture for a manual browser decode check"]
    fn writes_a_browser_decode_fixture() {
        let Ok(path) = std::env::var("NOWLY_BMP_FIXTURE") else {
            return;
        };
        let mut captured = frame(0, 3, 2);
        captured.rgba = vec![
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, //
            1, 2, 3, 255, 250, 128, 7, 255, 79, 201, 218, 255,
        ];
        let store = FrameStore::default();
        store.store(1, vec![captured]);
        std::fs::write(path, store.bitmap(1, 0).unwrap()).unwrap();
    }

    #[test]
    #[ignore = "manual startup performance check; run with --ignored --nocapture"]
    fn full_resolution_bitmap_is_built_within_startup_budget() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 3840, 2160)]);
        let started = std::time::Instant::now();
        let bitmap = store.bitmap(1, 0).unwrap();
        let elapsed = started.elapsed();
        eprintln!("4K frozen frame: {elapsed:?}, {} bytes", bitmap.len());
        assert!(
            elapsed < std::time::Duration::from_millis(100),
            "frame transport took {elapsed:?}"
        );
    }

    #[test]
    fn refuses_a_frame_whose_buffer_does_not_match_its_size() {
        let store = FrameStore::default();
        let mut captured = frame(0, 4, 2);
        captured.rgba.pop();
        store.store(1, vec![captured]);
        assert!(store.bitmap(1, 0).is_none());
    }

    #[test]
    fn refuses_a_request_from_a_finished_session() {
        let store = FrameStore::default();
        store.store(2, vec![frame(0, 4, 2)]);

        // The id of an older session must not be answered with this desktop.
        assert!(store.bitmap(1, 0).is_none());
        assert!(store.bitmap(2, 0).is_some());
    }

    #[test]
    fn refuses_an_unknown_display() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 4, 2)]);

        assert!(store.bitmap(1, 9).is_none());
        assert!(store.descriptor(9).is_none());
    }

    #[test]
    fn describes_a_display_without_carrying_pixels() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 2240, 1400), frame(1, 1920, 1080)]);

        assert_eq!(
            store.descriptor(1),
            Some(FrameDescriptor {
                display_id: 1,
                width: 1920,
                height: 1080,
                origin_x: 0,
                origin_y: 0,
                window_candidates: Vec::new(),
            })
        );
    }

    #[test]
    fn clearing_releases_every_frame() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 4, 2)]);
        store.bitmap(1, 0).expect("frame should be served");

        store.clear();

        // §8.3: the session's base images and caches go when the session does.
        assert_eq!(store.session_id(), None);
        assert!(store.bitmap(1, 0).is_none());
        assert!(store.descriptor(0).is_none());
    }

    #[test]
    fn a_new_session_replaces_the_previous_frames() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 4, 2)]);

        store.store(2, vec![frame(0, 8, 4)]);

        assert_eq!(store.session_id(), Some(2));
        assert!(store.bitmap(1, 0).is_none());
        assert_eq!(store.descriptor(0).map(|frame| frame.width), Some(8));
    }

    #[test]
    fn descriptor_ownership_does_not_read_a_replacement_sessions_geometry() {
        let store = FrameStore::default();
        store.store(2, vec![frame(0, 8, 4)]);
        assert!(store.descriptor_for(1, 0).is_none());
        assert_eq!(store.descriptor_for(2, 0).unwrap().width, 8);
    }

    #[test]
    fn descriptors_include_signed_physical_origins() {
        let store = FrameStore::default();
        let mut captured = frame(1, 1920, 1080);
        captured.display.x = -1920;
        captured.display.y = -200;
        store.store(1, vec![captured]);
        let json = serde_json::to_value(store.descriptor_for(1, 1).unwrap()).unwrap();
        assert_eq!(json["originX"], -1920);
        assert_eq!(json["originY"], -200);
    }

    #[test]
    fn descriptors_return_only_frozen_display_local_candidate_rectangles() {
        let store = FrameStore::default();
        let mut captured = frame(1, 1920, 1080);
        captured.display.x = -1920;
        let candidates = vec![
            super::WindowBounds {
                x: -1900,
                y: 30,
                width: 640,
                height: 480,
            },
            super::WindowBounds {
                x: -1940,
                y: -20,
                width: 60,
                height: 50,
            },
        ];
        store.activate(7);
        assert!(store.store_if_current(7, vec![captured], candidates));
        let json = serde_json::to_value(store.descriptor_for(7, 1).unwrap()).unwrap();
        assert_eq!(json["originX"], -1920);
        assert_eq!(json["originY"], 0);
        assert_eq!(
            json["windowCandidates"],
            serde_json::json!([
                { "x": 20, "y": 30, "width": 640, "height": 480 },
                { "x": 0, "y": 0, "width": 40, "height": 30 },
            ])
        );
    }

    #[test]
    fn stale_cleanup_and_late_frame_commits_leave_a_new_session_intact() {
        let store = FrameStore::default();
        store.activate(1);
        assert!(store.store_if_current(1, vec![frame(0, 2, 2)], Vec::new()));
        store.retire(1);
        store.activate(2);
        assert!(store.store_if_current(2, vec![frame(0, 8, 4)], Vec::new()));
        store.clear_if_session(1);
        store.retire(1);
        assert!(!store.store_if_current(1, vec![frame(0, 2, 2)], Vec::new()));
        assert_eq!(store.descriptor_for(2, 0).unwrap().width, 8);
        store.clear_if_session(2);
        assert!(store.descriptor_for(2, 0).is_none());
    }

    #[test]
    fn retirement_does_not_wait_for_a_busy_frame_request() {
        use std::sync::{mpsc, Arc};
        use std::time::Duration;
        let store = Arc::new(FrameStore::default());
        store.activate(1);
        let held_frames = store.0.lock().unwrap();
        let retiring = store.clone();
        let (sender, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            retiring.retire(1);
            sender.send(()).unwrap();
        });
        let result = receiver.recv_timeout(Duration::from_secs(1));
        drop(held_frames);
        worker.join().unwrap();
        result.expect("retiring the owner must not wait for the frame mutex");
        assert!(!store.store_if_current(1, vec![frame(0, 2, 2)], Vec::new()));
    }
}
