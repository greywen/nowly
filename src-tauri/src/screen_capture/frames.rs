//! The frozen frames of the active session, and the local channel that carries
//! them to the overlay WebViews.
//!
//! §9 forbids pushing pixels through huge Base64/JSON invokes and forbids
//! re-capturing the screen on every pointer move. Instead each display's frozen
//! frame is encoded once, lazily, and served over a local URI scheme so the
//! WebView decodes it natively and caches it.
//!
//! The URL carries the session id as well as the display id, so a request that
//! belongs to a finished session is rejected rather than answered with a newer
//! session's desktop.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
    /// PNG bytes per display, encoded on first request.
    encoded: HashMap<u32, Arc<Vec<u8>>>,
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
    /// ActiveCapture's mutex while a previous PNG encoding finishes.
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
            encoded: HashMap::new(),
        });
        true
    }

    #[cfg(test)]
    pub(crate) fn store(&self, session_id: u64, frames: Vec<CapturedDisplay>) {
        *self.0.lock().unwrap() = Some(SessionFrames {
            session_id,
            frames,
            candidates: Vec::new(),
            encoded: HashMap::new(),
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

    /// PNG bytes for one display of one session, encoding on first use.
    ///
    /// Returns `None` for an unknown display or a session that is no longer the
    /// active one, so a late request cannot read a different desktop.
    pub(crate) fn png(&self, session_id: u64, display_id: u32) -> Option<Arc<Vec<u8>>> {
        let mut held = self.0.lock().unwrap();
        let held = held.as_mut()?;
        if held.session_id != session_id {
            return None;
        }
        if let Some(cached) = held.encoded.get(&display_id) {
            return Some(cached.clone());
        }

        let frame = held
            .frames
            .iter()
            .find(|frame| frame.display.id == display_id)?;
        let encoded = Arc::new(encode_png(frame)?);
        held.encoded.insert(display_id, encoded.clone());
        Some(encoded)
    }
}

fn encode_png(frame: &CapturedDisplay) -> Option<Vec<u8>> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;
    
    let image = image::RgbaImage::from_raw(
        frame.display.width,
        frame.display.height,
        frame.rgba.clone(),
    )?;
    let mut bytes = Vec::new();
    
    // Use fast compression for quick decoding: the frame must decode before the
    // startup timeout expires, and a larger file that decodes instantly is better
    // than a smaller file that takes too long.
    let encoder = PngEncoder::new_with_quality(
        std::io::Cursor::new(&mut bytes),
        CompressionType::Fast,
        FilterType::NoFilter,
    );
    encoder
        .write_image(
            image.as_raw(),
            frame.display.width,
            frame.display.height,
            image::ExtendedColorType::Rgba8,
        )
        .ok()?;
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
            // Opaque so the PNG round-trip is checkable.
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
    fn serves_a_png_for_a_stored_display() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 4, 2)]);

        let png = store.png(1, 0).expect("the frame should be served");

        // PNG signature, so this really is an encoded image rather than raw bytes.
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn encodes_once_and_reuses_the_result() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 4, 2)]);

        let first = store.png(1, 0).expect("first request should encode");
        let second = store.png(1, 0).expect("second request should be cached");

        // Same allocation, so a pointer move cannot re-encode the frame.
        assert!(std::sync::Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn refuses_a_request_from_a_finished_session() {
        let store = FrameStore::default();
        store.store(2, vec![frame(0, 4, 2)]);

        // The id of an older session must not be answered with this desktop.
        assert!(store.png(1, 0).is_none());
        assert!(store.png(2, 0).is_some());
    }

    #[test]
    fn refuses_an_unknown_display() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 4, 2)]);

        assert!(store.png(1, 9).is_none());
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
        store.png(1, 0).expect("frame should encode");

        store.clear();

        // §8.3: the session's base images and caches go when the session does.
        assert_eq!(store.session_id(), None);
        assert!(store.png(1, 0).is_none());
        assert!(store.descriptor(0).is_none());
    }

    #[test]
    fn a_new_session_replaces_the_previous_frames() {
        let store = FrameStore::default();
        store.store(1, vec![frame(0, 4, 2)]);

        store.store(2, vec![frame(0, 8, 4)]);

        assert_eq!(store.session_id(), Some(2));
        assert!(store.png(1, 0).is_none());
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
    fn retirement_does_not_wait_for_a_busy_frame_encoder() {
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
        result.expect("retiring the owner must not wait for the PNG encoding mutex");
        assert!(!store.store_if_current(1, vec![frame(0, 2, 2)], Vec::new()));
    }
}
