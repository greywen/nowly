use super::scroll::Capture;
use super::scroll_target::{window_hole, Region};
use super::scroll_worker::{FrameSampler, ScrollHint};

fn scroll_viewport(start: u32) -> Vec<u8> {
    viewport_pixels(start, 32, 128)
}

fn viewport_pixels(start: u32, width: u32, height: u32) -> Vec<u8> {
    (start..start + height)
        .flat_map(|row| {
            (0..width).flat_map(move |column| {
                let value = row
                    .wrapping_mul(747796405)
                    .wrapping_add((column as u32).wrapping_mul(2891336453));
                [value as u8, (value >> 11) as u8, (value >> 19) as u8, 255]
            })
        })
        .collect()
}

/// Repeated frames must not add duplicate content.
fn settle(capture: &mut Capture, start: u32) -> bool {
    let first = capture.offer(scroll_viewport(start));
    first | capture.offer(scroll_viewport(start))
}

#[test]
fn capture_starts_from_the_first_view_and_appends_scrolled_rows() {
    let mut capture = Capture::new(32, 128, 512);
    assert!(capture.offer(scroll_viewport(0)));
    assert!(!capture.offer(scroll_viewport(0)));
    assert_eq!((capture.revision, capture.confirmed_height()), (1, 128));
    assert!(settle(&mut capture, 32));
    assert!(settle(&mut capture, 80));
    assert_eq!((capture.revision, capture.confirmed_height()), (3, 208));
    assert_eq!(capture.hint, None);
}

#[test]
#[ignore = "requires browser PNG frames in NOWLY_SCROLL_BROWSER_FRAMES"]
fn rendered_browser_scroll_frames_preserve_every_pixel() {
    let folder = std::path::PathBuf::from(std::env::var_os("NOWLY_SCROLL_BROWSER_FRAMES")
        .expect("set NOWLY_SCROLL_BROWSER_FRAMES to the captured browser fixture directory"));
    let source = image::open(folder.join("scroll-browser-source.png")).unwrap().to_rgba8();
    let first = image::open(folder.join("scroll-browser-0.png")).unwrap().to_rgba8();
    // Exclude browser scrollbar pixels; the rendered document stays unchanged.
    let width = first.width().min(source.width()) - 32;
    let height = first.height();
    let mut capture = Capture::new(width, height, 10000);
    for index in 0..9 {
        let frame = image::open(folder.join(format!("scroll-browser-{index}.png"))).unwrap().to_rgba8();
        let pixels = image::imageops::crop_imm(&frame, 0, 0, width, height).to_image().into_raw();
        capture.offer(pixels);
        eprintln!("browser frame={index} revision={} height={} hint={:?}",
            capture.revision, capture.confirmed_height(), capture.hint);
    }
    let (_, actual_height, pixels) = capture.snapshot().unwrap();
    // Fixture browser: 1048 CSS pixels high at DPR 1.75. The furthest scroll
    // is 1440 CSS pixels, or 2520 physical pixels in the captured PNG.
    assert_eq!(height, 1834, "capture this fixture at 1048 CSS px and DPR 1.75");
    assert_eq!(actual_height, 4354);
    let expected = image::imageops::crop_imm(&source, 0, 0, width, 4354).to_image().into_raw();
    let differences: Vec<_> = pixels.chunks_exact(4).zip(expected.chunks_exact(4))
        .enumerate().filter(|(_, (actual, expected))| actual != expected)
        .take(12).map(|(index, (actual, expected))|
            (index % width as usize, index / width as usize, actual.to_vec(), expected.to_vec()))
        .collect();
    assert!(differences.is_empty(), "rendered webpage pixel differences: {differences:?}");
}

#[test]
#[ignore = "runs a paced full-size capture pipeline stress test"]
fn full_size_continuous_scroll_pipeline_preserves_every_row() {
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    let width = 430u32;
    let height = 618u32;
    let source = viewport_pixels(0, width, 2538);
    let expected = source.clone();
    let queue = Arc::new(super::scroll_queue::FrameQueue::new(64 * 1024 * 1024));
    let producer_queue = queue.clone();
    let producer = std::thread::spawn(move || {
        let stride = width as usize * 4;
        let started = Instant::now();
        let mut result = Ok(());
        let positions = (480..=1920).step_by(16).chain((0..1920).step_by(16).rev());
        for (index, start) in positions.enumerate() {
            let deadline = started + Duration::from_millis(index as u64 * 16);
            std::thread::sleep(deadline.saturating_duration_since(Instant::now()));
            let frame = source[start * stride..(start + height as usize) * stride].to_vec();
            if producer_queue.push(frame).is_err() {
                result = Err(index);
                break;
            }
        }
        producer_queue.close();
        result
    });
    let mut capture = Capture::new(width, height, 4096);
    let mut timings = Vec::new();
    while let Some(frame) = queue.pop() {
        let started = Instant::now();
        capture.offer(frame);
        timings.push(started.elapsed().as_micros());
    }
    let produced = producer.join().unwrap();
    timings.sort_unstable();
    eprintln!("full-size pipeline: processed={} median={}us p95={}us max={}us producer={produced:?}",
        timings.len(), timings[timings.len() / 2], timings[timings.len() * 95 / 100], timings.last().unwrap());
    assert_eq!(produced, Ok(()), "continuous changing frames must not exhaust the queue");
    let (actual_width, actual_height, pixels) = capture.snapshot().unwrap();
    assert_eq!((actual_width, actual_height), (430, 2538));
    assert!(pixels == expected, "bidirectional output must preserve every source pixel");
}

#[test]
#[ignore = "reads the local desktop; run explicitly for capture timing"]
fn measure_native_scroll_capture_cost() {
    use super::backend::CaptureSource;
    use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let source = super::gdi::GdiSource;
    let display = source.descriptor(&source.displays().unwrap()[0]).unwrap();
    let region = Region { x: display.x, y: display.y, width: 430, height: 618 };
    let mut timings = Vec::new();
    for _ in 0..30 {
        let started = std::time::Instant::now();
        let pixels = super::scroll_target::capture_region(region).unwrap();
        assert_eq!(pixels.len(), 430 * 618 * 4);
        timings.push(started.elapsed().as_micros());
    }
    timings.sort_unstable();
    eprintln!("430x618 capture: median={}us p95={}us", timings[15], timings[28]);
}

#[test]
#[ignore = "reads local desktop frames; run explicitly for DXGI timing"]
fn measure_dxgi_scroll_capture_cost() {
    use super::backend::CaptureSource;
    use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let source = super::gdi::GdiSource;
    let display = source.descriptor(&source.displays().unwrap()[0]).unwrap();
    let region = Region { x: display.x, y: display.y, width: 430, height: 618 };
    let started = std::time::Instant::now();
    let mut source = super::scroll_dxgi::ScrollFrameSource::new(region).unwrap();
    let frame = source.next_frame(1000).unwrap().expect("initial desktop frame");
    assert_eq!(frame.len(), 430 * 618 * 4);
    eprintln!("DXGI initialize and first frame: {:?}", started.elapsed());
    let started = std::time::Instant::now();
    let _ = source.next_frame(16).unwrap();
    eprintln!("DXGI next frame or timeout: {:?}", started.elapsed());
}

#[test]
#[ignore = "opens a local deterministic scroll surface for native capture verification"]
fn native_dxgi_continuous_scroll_has_no_missing_rows() {
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
    use windows::Win32::UI::WindowsAndMessaging::*;
    let ready = Arc::new(AtomicBool::new(false));
    let stop = Arc::new(AtomicBool::new(false));
    let painter_ready = ready.clone();
    let painter_stop = stop.clone();
    let begin = Arc::new(AtomicBool::new(false));
    let painter_begin = begin.clone();
    let painter = std::thread::spawn(move || {
        unsafe {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let window = CreateWindowExW(WS_EX_TOPMOST, w!("STATIC"), w!("Nowly scroll verification"),
                WS_POPUP | WS_VISIBLE, 100, 100, 32, 128, None, None, None, None).unwrap();
            let overlay = CreateWindowExW(WS_EX_TOPMOST | WS_EX_LAYERED, w!("STATIC"), w!("Excluded overlay fixture"),
                WS_POPUP | WS_VISIBLE, 90, 90, 52, 148, None, None, None, None).unwrap();
            SetLayeredWindowAttributes(overlay, windows::Win32::Foundation::COLORREF(0), 255, LWA_ALPHA).unwrap();
            let shape = CreateRectRgn(0, 0, 52, 148);
            let hole = CreateRectRgn(10, 10, 42, 138);
            CombineRgn(Some(shape), Some(shape), Some(hole), RGN_DIFF);
            let _ = DeleteObject(HGDIOBJ(hole.0));
            assert_ne!(SetWindowRgn(overlay, Some(shape), true), 0);
            SetWindowDisplayAffinity(overlay, WDA_NONE).unwrap();
            let dc = GetDC(Some(window));
            let info = BITMAPINFO { bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: 32, biHeight: -128, biPlanes: 1, biBitCount: 32,
                biCompression: BI_RGB.0, ..Default::default()
            }, ..Default::default() };
            let mut start = 96;
            let mut direction = 1i32;
            let mut reached_top = false;
            while !painter_stop.load(Ordering::Acquire) {
                let mut pixels = scroll_viewport(start);
                for pixel in pixels.chunks_exact_mut(4) { pixel.swap(0, 2); }
                SetDIBitsToDevice(dc, 0, 0, 32, 128, 0, 0, 0, 128,
                    pixels.as_ptr().cast(), &info, DIB_RGB_COLORS);
                let _ = GdiFlush();
                windows::Win32::Graphics::Dwm::DwmFlush().unwrap();
                painter_ready.store(true, Ordering::Release);
                let mut message = MSG::default();
                while PeekMessageW(&mut message, Some(window), 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                std::thread::sleep(std::time::Duration::from_millis(16));
                if painter_begin.load(Ordering::Acquire) {
                    if start == 352 && !reached_top { direction = -1; }
                    if start == 0 { direction = 1; reached_top = true; }
                    if !(reached_top && start == 352) {
                        start = (start as i32 + direction * 16) as u32;
                    }
                }
            }
            ReleaseDC(Some(window), dc);
            DestroyWindow(overlay).unwrap();
            DestroyWindow(window).unwrap();
        }
    });
    while !ready.load(Ordering::Acquire) { std::thread::yield_now(); }
    let result = std::panic::catch_unwind(|| {
        let mut source = super::scroll_dxgi::ScrollFrameSource::new(Region { x:100, y:100, width:32, height:128 }).unwrap();
        let mut capture = Capture::new(32,128,1024);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            if let Some(frame) = source.next_frame(16).unwrap() {
                if capture.snapshot().is_none() && !(96..=352).any(|start| scroll_viewport(start)[..128] == frame[..128]) {
                    continue; // Ignore the fixture window's creation frame before its first paint.
                }
                capture.offer(frame);
                begin.store(true, Ordering::Release);
            }
        }
        let (_, height, pixels) = capture.snapshot().expect("native first frame");
        eprintln!("native first pixels {:?}, expected {:?}", &pixels[..16], &scroll_viewport(96)[..16]);
        let first_row = (0..=352).find(|start| scroll_viewport(*start)[..128] == pixels[..128]).expect("initial source row");
        assert_eq!(first_row, 0, "upward scroll must prepend the initial source rows");
        assert_eq!(height, 480 - first_row);
        for (index, row) in pixels.chunks_exact(32 * 4).enumerate() {
            assert!(row == &scroll_viewport(first_row + index as u32)[..32 * 4], "missing or repeated source row at {index}");
        }
        assert_eq!(capture.hint, None);
        eprintln!("native DXGI: source rows {first_row}..480, {height} rows, complete");
    });
    stop.store(true, Ordering::Release);
    painter.join().unwrap();
    if let Err(error) = result { std::panic::resume_unwind(error); }
    let _ = (HWND::default(), LPARAM::default(), WPARAM::default());
}

#[test]
fn black_dxgi_frame_is_checked_against_the_live_desktop_before_confirmation() {
    let black = vec![0, 0, 0, 255].repeat(32 * 128);
    let desktop = scroll_viewport(0);
    let (frame, incompatible) = super::scroll_target::validate_black_frame(black.clone(), || Ok(desktop.clone())).unwrap();
    assert!(incompatible, "a black DXGI surface must not poison the confirmed image");
    assert!(frame == desktop);
    let (frame, incompatible) = super::scroll_target::validate_black_frame(black.clone(), || Ok(black.clone())).unwrap();
    assert!(!incompatible, "a genuinely black desktop remains valid content");
    assert!(frame == black);
    let (frame, incompatible) = super::scroll_target::validate_black_frame(desktop.clone(), || panic!("nonblack frame needs no extra capture")).unwrap();
    assert!(!incompatible);
    assert!(frame == desktop);
}

#[test]
fn continuous_moving_frames_are_captured_without_pausing() {
    let mut capture = Capture::new(32, 128, 1024);
    settle(&mut capture, 0);
    for start in [32, 64, 96, 128, 160, 192] {
        capture.offer(scroll_viewport(start));
    }
    let (_, height, pixels) = capture.snapshot().unwrap();
    assert_eq!(height, 320);
    let expected: Vec<_> = scroll_viewport(0).into_iter()
        .chain(scroll_viewport(128)).chain(scroll_viewport(256).into_iter().take(64 * 32 * 4))
        .collect();
    assert_eq!(pixels, expected);
    assert_eq!(capture.hint, None);
}

#[test]
fn scrolling_above_the_initial_view_prepends_new_rows() {
    let mut capture = Capture::new(32, 128, 1024);
    settle(&mut capture, 96);
    for start in [64, 32, 0] {
        settle(&mut capture, start);
    }
    let (_, height, pixels) = capture.snapshot().unwrap();
    assert_eq!(height, 224);
    let expected: Vec<_> = scroll_viewport(0).into_iter()
        .chain(scroll_viewport(128).into_iter().take(96 * 32 * 4)).collect();
    assert_eq!(pixels, expected);
}

#[test]
fn reversing_direction_extends_both_ends_without_duplicate_rows() {
    let mut capture = Capture::new(32, 128, 1024);
    settle(&mut capture, 96);
    for start in [128, 160, 128, 96, 64, 32, 0, 32, 64, 96, 128, 160, 192] {
        capture.offer(scroll_viewport(start));
    }
    let (_, height, pixels) = capture.snapshot().unwrap();
    assert_eq!(height, 320);
    let expected: Vec<_> = scroll_viewport(0).into_iter()
        .chain(scroll_viewport(128))
        .chain(scroll_viewport(256).into_iter().take(64 * 32 * 4)).collect();
    assert_eq!(pixels, expected);
    assert_eq!(capture.hint, None);
}

#[test]
fn upward_extension_respects_the_combined_image_budget() {
    let mut capture = Capture::new(32, 128, 160);
    settle(&mut capture, 96);
    capture.offer(scroll_viewport(64));
    let before = capture.snapshot().unwrap();
    capture.offer(scroll_viewport(32));
    assert_eq!(capture.snapshot().unwrap(), before);
    assert_eq!(capture.hint, Some(ScrollHint::Full));
}

#[test]
fn first_complete_frame_is_available_without_waiting_for_a_pause() {
    let mut capture = Capture::new(32, 128, 1024);
    capture.offer(scroll_viewport(96));
    let (_, height, pixels) = capture.snapshot().expect("first frame captured");
    assert_eq!(height, 128);
    assert!(pixels == scroll_viewport(96), "first frame pixels preserved");
}

#[test]
fn downscaled_preview_preserves_the_new_top_after_prepend() {
    use super::stitcher::{StitchConfig, Stitcher};
    let mut stitcher = Stitcher::new(StitchConfig::default(), 32, 128, scroll_viewport(64), 1024).unwrap();
    stitcher.offer(32, 128, &scroll_viewport(32));
    let (width, height, pixels) = stitcher.preview(16);
    assert_eq!((width, height), (16, 80));
    assert_eq!(&pixels[..4], &scroll_viewport(32)[..4]);
    assert_eq!(pixels.len(), 16 * 80 * 4);
}

#[test]
fn revisiting_history_with_a_repeated_tail_does_not_append_duplicate_rows() {
    let mut capture = Capture::new(32, 128, 1024);
    capture.offer(scroll_viewport(0));
    let mut next = scroll_viewport(64);
    let repeated = scroll_viewport(0);
    next[104 * 32 * 4..].copy_from_slice(&repeated[..24 * 32 * 4]);
    capture.offer(next);
    let before = capture.snapshot().unwrap();
    assert_eq!(before.1, 192);
    capture.offer(scroll_viewport(0));
    assert!(capture.snapshot().unwrap() == before, "revisiting exact history must not duplicate rows");
}

#[test]
fn scrolling_back_over_captured_rows_keeps_the_image_and_continues_below() {
    let mut capture = Capture::new(32, 128, 512);
    settle(&mut capture, 0);
    settle(&mut capture, 48);
    let before = capture.snapshot().unwrap();
    settle(&mut capture, 16);
    assert_eq!(capture.snapshot().unwrap(), before);
    assert_eq!(capture.hint, None);
    settle(&mut capture, 48);
    assert!(settle(&mut capture, 96));
    assert_eq!(capture.confirmed_height(), 224);
}

#[test]
fn an_unmatched_view_is_skipped_without_ending_the_capture() {
    let mut capture = Capture::new(32, 128, 512);
    settle(&mut capture, 0);
    settle(&mut capture, 32);
    let before = capture.snapshot().unwrap();
    assert!(settle(&mut capture, 400));
    assert_eq!(capture.hint, Some(ScrollHint::LostTrack));
    assert_eq!(capture.snapshot().unwrap(), before);
    // Scrolling back to where the overlap is visible again picks up from there.
    assert!(settle(&mut capture, 64));
    assert_eq!(capture.hint, None);
    assert_eq!(capture.confirmed_height(), 192);
}

#[test]
fn returning_to_the_confirmed_view_clears_the_lost_track_hint() {
    let mut capture = Capture::new(32, 128, 512);
    settle(&mut capture, 0);
    settle(&mut capture, 32);
    settle(&mut capture, 400);
    assert_eq!(capture.hint, Some(ScrollHint::LostTrack));
    // Exactly the last confirmed view: nothing to stitch, but the user did what
    // the hint asked, so it must not keep saying they scrolled too fast.
    assert!(capture.offer(scroll_viewport(32)));
    assert_eq!(capture.hint, None);
    assert_eq!(capture.confirmed_height(), 160);
}

#[test]
fn the_size_limit_keeps_everything_confirmed_so_far() {
    let mut capture = Capture::new(32, 128, 128);
    settle(&mut capture, 0);
    let first = capture.snapshot().unwrap();
    assert!(settle(&mut capture, 32));
    assert_eq!(capture.hint, Some(ScrollHint::Full));
    assert_eq!(capture.snapshot().unwrap(), first);

    let mut no_room = Capture::new(32, 128, 64);
    assert!(settle(&mut no_room, 0));
    assert_eq!(no_room.hint, Some(ScrollHint::Full));
    assert!(no_room.snapshot().is_none());
}

#[test]
fn sampling_accepts_moving_views_and_ignores_the_confirmed_one() {
    let mut sampler = FrameSampler::default();
    for value in 0..40 {
        assert_eq!(sampler.sample(vec![value], None), Some(vec![value]));
    }
    let confirmed = [1];
    for _ in 0..10 {
        assert_eq!(sampler.sample(vec![1], Some(&confirmed)), None);
    }
    assert_eq!(sampler.sample(vec![2], Some(&confirmed)), Some(vec![2]));
    assert_eq!(sampler.sample(vec![3], Some(&confirmed)), Some(vec![3]));
}

#[test]
fn the_overlay_hole_is_the_selection_in_window_coordinates() {
    let window = Region {
        x: -1920,
        y: -200,
        width: 1920,
        height: 1080,
    };
    let selection = Region {
        x: -1500,
        y: 100,
        width: 600,
        height: 400,
    };
    assert_eq!(window_hole(selection, window), Some((420, 300, 1020, 700)));
    let clipped = Region {
        x: -100,
        y: 800,
        width: 400,
        height: 400,
    };
    assert_eq!(window_hole(clipped, window), Some((1820, 1000, 1920, 1080)));
    let elsewhere = Region {
        x: 10,
        y: 10,
        width: 100,
        height: 100,
    };
    assert_eq!(window_hole(elsewhere, window), None);
}

#[test]
fn scrolling_capture_never_injects_input() {
    for source in [include_str!("scroll_target.rs"), include_str!("scroll.rs")] {
        for input in [
            "WM_MOUSEWHEEL",
            "SendInput(",
            "SendMessage",
            "PostMessage",
            "mouse_event(",
            "SetCursorPos(",
        ] {
            assert!(!source.contains(input), "must not inject input: {input}");
        }
    }
}
