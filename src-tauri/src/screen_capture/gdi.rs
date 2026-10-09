//! GDI capture backend.
//!
//! `xcap`'s GDI path builds a device context per monitor from its device name,
//! which returned `0x80070006` (invalid handle) on the V00 probe machine. This
//! takes the whole virtual screen's DC from `GetDC(None)` instead and blits each
//! display by its signed virtual-desktop rectangle, which is the ordinary way to
//! do this and needs no per-adapter device.
//!
//! GDI cannot read DRM-protected surfaces or some hardware overlays; those are
//! V09's business and must surface as a stated limit, never as a silently black
//! frame reported successful.

use super::backend::{CaptureBackendError, CaptureSource, DisplayInfo};

/// `BitBlt` writes BGRA and leaves the alpha byte undefined, so the channels are
/// swapped and alpha forced opaque. Kept separate from the Win32 calls so the
/// conversion is testable without touching a desktop.
pub(crate) fn bgra_to_rgba(buffer: &mut [u8]) {
    for pixel in buffer.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }
}

// The capture seam for the session. Only tests reach it until
// `start_screen_capture` is wired up, so the unused-import warning in a non-test
// build is expected rather than a sign the re-export is wrong.
#[cfg(target_os = "windows")]
#[allow(unused_imports)]
pub(crate) use windows_impl::{DibFrame, GdiSource};

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{bgra_to_rgba, CaptureBackendError, CaptureSource, DisplayInfo};
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, EnumDisplayMonitors,
        GdiFlush, GetDC, GetMonitorInfoW, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
        BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, HMONITOR, MONITORINFO, SRCCOPY,
    };
    use windows::Win32::UI::HiDpi::{
        AreDpiAwarenessContextsEqual, GetDpiAwarenessContextForProcess, GetDpiForMonitor,
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        MDT_EFFECTIVE_DPI,
    };
    use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;

    /// Refuses to capture unless the process is per-monitor DPI aware.
    ///
    /// Tao calls `become_dpi_aware` in `EventLoop::new`, so the real application
    /// qualifies. A DPI-unaware process is handed virtualized monitor rectangles
    /// and a stretched `BitBlt` copy, which would break §4.1's physical-pixel
    /// contract while still looking like a successful capture, so this fails loudly
    /// instead. V1 is accepted: it also reports true physical coordinates.
    fn require_physical_pixels() -> Result<(), CaptureBackendError> {
        let context = unsafe {
            GetDpiAwarenessContextForProcess(windows::Win32::Foundation::HANDLE::default())
        };
        let per_monitor = [
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE,
        ]
        .into_iter()
        .any(|value| unsafe { AreDpiAwarenessContextsEqual(context, value) }.as_bool());

        if per_monitor {
            Ok(())
        } else {
            Err(CaptureBackendError::NotDpiAware)
        }
    }

    /// Releases the virtual screen DC.
    struct ScreenDc(HDC);

    impl Drop for ScreenDc {
        fn drop(&mut self) {
            unsafe { ReleaseDC(None, self.0) };
        }
    }

    struct MemoryDc(HDC);

    impl Drop for MemoryDc {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteDC(self.0);
            }
        }
    }

    /// One display's pixels, left in the DIB section `BitBlt` wrote them into.
    ///
    /// Shared rather than copied: the freeze layer paints this bitmap on the main
    /// thread while the capture worker reads its bits to build the RGBA frame.
    /// Both only read, and the section is deleted when the last owner drops it.
    pub(crate) struct DibFrame {
        bitmap: HBITMAP,
        bits: *const u8,
        len: usize,
        pub width: i32,
        pub height: i32,
    }

    // SAFETY: the bitmap handle is process-wide and is never selected into a DC
    // outside one main-thread paint call; the bits are only read after GdiFlush.
    unsafe impl Send for DibFrame {}
    unsafe impl Sync for DibFrame {}

    impl DibFrame {
        pub(crate) fn bitmap(&self) -> HBITMAP {
            self.bitmap
        }

        fn bgra(&self) -> &[u8] {
            unsafe { std::slice::from_raw_parts(self.bits, self.len) }
        }

        /// A section filled with one BGRA value, for exercising the native path
        /// without reading the desktop.
        #[cfg(test)]
        pub(crate) fn synthetic(width: i32, height: i32, bgra: [u8; 4]) -> std::sync::Arc<Self> {
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let bitmap =
                unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0) }
                    .expect("a small DIB section");
            let len = (width * height * 4) as usize;
            let pixels = unsafe { std::slice::from_raw_parts_mut(bits as *mut u8, len) };
            for pixel in pixels.chunks_exact_mut(4) {
                pixel.copy_from_slice(&bgra);
            }
            std::sync::Arc::new(Self {
                bitmap,
                bits: bits as *const u8,
                len,
                width,
                height,
            })
        }
    }

    impl Drop for DibFrame {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteObject(HGDIOBJ(self.bitmap.0));
            }
        }
    }

    pub(crate) struct GdiSource;

    /// Collects handles only: this runs across an FFI boundary, so it must not
    /// panic or allocate anything that could unwind.
    unsafe extern "system" fn collect_monitor(
        monitor: HMONITOR,
        _dc: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> windows::core::BOOL {
        let handles = unsafe { &mut *(data.0 as *mut Vec<HMONITOR>) };
        handles.push(monitor);
        true.into()
    }

    fn describe(monitor: HMONITOR, id: u32) -> Result<DisplayInfo, CaptureBackendError> {
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if unsafe { !GetMonitorInfoW(monitor, &mut info).as_bool() } {
            eprintln!("screen capture: GetMonitorInfoW failed for monitor {id}");
            return Err(CaptureBackendError::CaptureFailed);
        }

        let rect = info.rcMonitor;
        let width = rect
            .right
            .checked_sub(rect.left)
            .and_then(|value| u32::try_from(value).ok())
            .ok_or(CaptureBackendError::InvalidFrame)?;
        let height = rect
            .bottom
            .checked_sub(rect.top)
            .and_then(|value| u32::try_from(value).ok())
            .ok_or(CaptureBackendError::InvalidFrame)?;

        // Informational only: capture works in physical pixels. A failed DPI
        // query falls back to 1.0 rather than losing the display.
        let mut dpi_x = 96u32;
        let mut dpi_y = 96u32;
        let scale_factor =
            match unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) } {
                Ok(()) => dpi_x as f32 / 96.0,
                Err(_) => 1.0,
            };

        Ok(DisplayInfo {
            id,
            x: rect.left,
            y: rect.top,
            width,
            height,
            scale_factor,
            is_primary: info.dwFlags & MONITORINFOF_PRIMARY != 0,
        })
    }

    impl CaptureSource for GdiSource {
        type Display = DisplayInfo;
        type Native = std::sync::Arc<DibFrame>;

        fn displays(&self) -> Result<Vec<Self::Display>, CaptureBackendError> {
            require_physical_pixels()?;

            let mut handles: Vec<HMONITOR> = Vec::new();
            let enumerated = unsafe {
                EnumDisplayMonitors(
                    None,
                    None,
                    Some(collect_monitor),
                    LPARAM(&mut handles as *mut Vec<HMONITOR> as isize),
                )
            };
            if !enumerated.as_bool() {
                eprintln!("screen capture: EnumDisplayMonitors failed");
                return Err(CaptureBackendError::CaptureFailed);
            }

            let mut displays = Vec::with_capacity(handles.len());
            for (index, monitor) in handles.into_iter().enumerate() {
                displays.push(describe(monitor, index as u32)?);
            }
            // The primary display goes first so it owns any mirrored overlap,
            // matching `composite::composite_selection`'s precedence rule.
            displays.sort_by_key(|display| !display.is_primary);
            Ok(displays)
        }

        fn descriptor(&self, display: &Self::Display) -> Result<DisplayInfo, CaptureBackendError> {
            Ok(display.clone())
        }

        fn native_rgba(&self, native: &Self::Native) -> Result<Vec<u8>, CaptureBackendError> {
            let mut rgba = native.bgra().to_vec();
            bgra_to_rgba(&mut rgba);
            Ok(rgba)
        }

        fn capture_native(
            &self,
            display: &Self::Display,
        ) -> Result<Self::Native, CaptureBackendError> {
            require_physical_pixels()?;

            let width =
                i32::try_from(display.width).map_err(|_| CaptureBackendError::InvalidFrame)?;
            let height =
                i32::try_from(display.height).map_err(|_| CaptureBackendError::InvalidFrame)?;

            let screen = unsafe { GetDC(Some(HWND::default())) };
            if screen.is_invalid() {
                eprintln!("screen capture: GetDC failed");
                return Err(CaptureBackendError::CaptureFailed);
            }
            let screen = ScreenDc(screen);

            let memory = unsafe { CreateCompatibleDC(Some(screen.0)) };
            if memory.is_invalid() {
                eprintln!("screen capture: CreateCompatibleDC failed");
                return Err(CaptureBackendError::CaptureFailed);
            }
            let memory = MemoryDc(memory);

            // Negative height requests a top-down DIB, so row 0 is the top row
            // and no vertical flip is needed afterwards.
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let bitmap = unsafe {
                CreateDIBSection(Some(memory.0), &info, DIB_RGB_COLORS, &mut bits, None, 0)
            }
            .map_err(|error| {
                eprintln!("screen capture: CreateDIBSection failed: {error:?}");
                CaptureBackendError::CaptureFailed
            })?;
            if bits.is_null() {
                eprintln!("screen capture: CreateDIBSection returned null bits");
                unsafe {
                    let _ = DeleteObject(HGDIOBJ(bitmap.0));
                }
                return Err(CaptureBackendError::CaptureFailed);
            }
            // 32bpp rows are inherently DWORD-aligned, so the stride is exactly
            // `width * 4` and the section is one contiguous buffer.
            let len = (display.width as usize)
                .checked_mul(display.height as usize)
                .and_then(|pixels| pixels.checked_mul(4))
                .ok_or_else(|| {
                    unsafe {
                        let _ = DeleteObject(HGDIOBJ(bitmap.0));
                    }
                    CaptureBackendError::ArithmeticOverflow
                })?;
            let frame = DibFrame {
                bitmap,
                bits: bits as *const u8,
                len,
                width,
                height,
            };

            let previous = unsafe { SelectObject(memory.0, HGDIOBJ(frame.bitmap.0)) };
            if previous.is_invalid() {
                eprintln!("screen capture: SelectObject failed");
                return Err(CaptureBackendError::CaptureFailed);
            }

            // CAPTUREBLT includes layered windows. Any failure returns an error
            // rather than the freshly allocated, still-blank buffer.
            let blitted = unsafe {
                BitBlt(
                    memory.0,
                    0,
                    0,
                    width,
                    height,
                    Some(screen.0),
                    display.x,
                    display.y,
                    SRCCOPY | CAPTUREBLT,
                )
            };
            unsafe { SelectObject(memory.0, previous) };
            blitted.map_err(|error| {
                eprintln!("screen capture: BitBlt failed: {error:?}");
                // E_ACCESSDENIED: the desktop is locked, switched away, owned by a
                // secure desktop, or the remote session is detached. Environmental
                // and retryable, so it must not be reported as a generic failure.
                if error.code() == windows::core::HRESULT::from_win32(5) {
                    CaptureBackendError::AccessDenied
                } else {
                    CaptureBackendError::CaptureFailed
                }
            })?;
            // The section's bits are read directly, so batched GDI work must land.
            let _ = unsafe { GdiFlush() };
            Ok(std::sync::Arc::new(frame))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::bgra_to_rgba;

    #[test]
    fn swaps_channels_and_forces_opaque_alpha() {
        // Two pixels of BGRA with the alpha byte left undefined by BitBlt.
        let mut buffer = vec![0x10, 0x20, 0x30, 0x00, 0xaa, 0xbb, 0xcc, 0x7f];

        bgra_to_rgba(&mut buffer);

        assert_eq!(buffer, vec![0x30, 0x20, 0x10, 0xff, 0xcc, 0xbb, 0xaa, 0xff]);
    }

    #[test]
    fn leaves_a_trailing_partial_pixel_untouched() {
        // Guards the chunk arithmetic: a malformed length must not panic.
        let mut buffer = vec![1, 2, 3, 4, 9, 9];

        bgra_to_rgba(&mut buffer);

        assert_eq!(buffer, vec![3, 2, 1, 255, 9, 9]);
    }

    /// V00's stability probe. `xcap`'s WGC path succeeded once and then returned
    /// `0x80070057` on repeat, so a single success proves nothing: this captures
    /// repeatedly and checks every round. Reports shape and variance only, never
    /// pixel content, and writes no file.
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "captures the real desktop; run explicitly for V00/V01"]
    fn gdi_captures_every_display_repeatedly() {
        use super::super::backend::{capture_all, CaptureSource};
        use super::GdiSource;
        use windows::Win32::UI::HiDpi::{
            SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };

        // The bare test binary carries no DPI manifest, unlike the real app where
        // Tao sets this in `EventLoop::new`. Without it the capture guard rejects
        // the attempt and the probe would measure virtualized pixels anyway.
        let _ =
            unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };

        let expected = GdiSource
            .displays()
            .expect("display enumeration should succeed");
        assert!(!expected.is_empty(), "no displays enumerated");
        eprintln!("displays: {}", expected.len());
        for display in &expected {
            eprintln!(
                "  id={} origin=({}, {}) size={}x{} scale={} primary={}",
                display.id,
                display.x,
                display.y,
                display.width,
                display.height,
                display.scale_factor,
                display.is_primary
            );
        }

        const ROUNDS: usize = 20;
        for round in 1..=ROUNDS {
            let started = std::time::Instant::now();
            let frames = capture_all(&GdiSource)
                .unwrap_or_else(|error| panic!("round {round} failed: {error:?}"));
            let elapsed = started.elapsed();

            assert_eq!(frames.len(), expected.len(), "round {round} lost a display");
            let mut uniform = 0usize;
            for frame in &frames {
                let pixels = frame.display.width as usize * frame.display.height as usize;
                assert_eq!(frame.rgba.len(), pixels * 4, "round {round} wrong length");
                assert!(
                    frame.rgba.chunks_exact(4).all(|pixel| pixel[3] == 255),
                    "round {round} left a transparent pixel"
                );
                // A frame where every pixel is identical suggests a blank
                // capture. Reported, not asserted: legitimately uniform content
                // must still be allowed to succeed, per §8.3.
                let first = &frame.rgba[..4];
                if frame.rgba.chunks_exact(4).all(|pixel| pixel == first) {
                    uniform += 1;
                }
            }
            eprintln!(
                "round {round}: {elapsed:?}, uniform frames: {uniform}/{}",
                frames.len()
            );
        }
    }

    /// The guard must reject a DPI-unaware process. Awareness is process-wide and
    /// cannot be undone, so this only means anything in a fresh process that has
    /// not set it yet; run it alone, or it passes for the wrong reason.
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "needs a fresh DPI-unaware process; run alone"]
    fn refuses_to_capture_without_per_monitor_awareness() {
        use super::super::backend::{CaptureBackendError, CaptureSource};
        use super::GdiSource;

        assert_eq!(
            GdiSource.displays().err(),
            Some(CaptureBackendError::NotDpiAware)
        );
    }

    /// Decides whether the numbers the probe prints are real physical pixels.
    ///
    /// A DPI-unaware process gets virtualized coordinates from `GetMonitorInfoW`
    /// and a stretched `BitBlt` copy, which would silently violate §4.1. The
    /// display mode from `EnumDisplaySettingsW` is not virtualized, so it is the
    /// independent truth to compare against.
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "reads real display metrics; run explicitly for V00/V02"]
    fn reports_whether_the_process_sees_physical_pixels() {
        use windows::core::PCWSTR;
        use windows::Win32::Graphics::Gdi::{
            EnumDisplaySettingsW, GetMonitorInfoW, MonitorFromPoint, DEVMODEW,
            ENUM_CURRENT_SETTINGS, MONITORINFO, MONITORINFOEXW, MONITOR_DEFAULTTOPRIMARY,
        };
        use windows::Win32::UI::HiDpi::{
            AreDpiAwarenessContextsEqual, GetDpiAwarenessContextForProcess,
            SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
            DPI_AWARENESS_CONTEXT_SYSTEM_AWARE, DPI_AWARENESS_CONTEXT_UNAWARE,
        };

        fn describe_awareness() -> &'static str {
            let context = unsafe {
                GetDpiAwarenessContextForProcess(windows::Win32::Foundation::HANDLE::default())
            };
            for (value, name) in [
                (DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, "per-monitor-v2"),
                (DPI_AWARENESS_CONTEXT_SYSTEM_AWARE, "system-aware"),
                (DPI_AWARENESS_CONTEXT_UNAWARE, "unaware"),
            ] {
                if unsafe { AreDpiAwarenessContextsEqual(context, value) }.as_bool() {
                    return name;
                }
            }
            "other"
        }

        /// The primary monitor as this process currently sees it, plus the
        /// non-virtualized display mode for the same device.
        fn measure() -> ((i32, i32), (u32, u32)) {
            let monitor = unsafe {
                MonitorFromPoint(
                    windows::Win32::Foundation::POINT { x: 0, y: 0 },
                    MONITOR_DEFAULTTOPRIMARY,
                )
            };
            let mut extended = MONITORINFOEXW {
                monitorInfo: MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                    ..Default::default()
                },
                ..Default::default()
            };
            assert!(unsafe {
                GetMonitorInfoW(
                    monitor,
                    &mut extended as *mut MONITORINFOEXW as *mut MONITORINFO,
                )
            }
            .as_bool());
            let rect = extended.monitorInfo.rcMonitor;
            let seen = (rect.right - rect.left, rect.bottom - rect.top);

            let mut mode = DEVMODEW {
                dmSize: std::mem::size_of::<DEVMODEW>() as u16,
                ..Default::default()
            };
            assert!(unsafe {
                EnumDisplaySettingsW(
                    PCWSTR(extended.szDevice.as_ptr()),
                    ENUM_CURRENT_SETTINGS,
                    &mut mode,
                )
            }
            .as_bool());
            (seen, (mode.dmPelsWidth, mode.dmPelsHeight))
        }

        let (seen, actual) = measure();
        eprintln!(
            "awareness={} monitor_rect={}x{} display_mode={}x{}",
            describe_awareness(),
            seen.0,
            seen.1,
            actual.0,
            actual.1
        );

        let set =
            unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        eprintln!("set per-monitor-v2: {set:?}");

        let (after, actual_after) = measure();
        eprintln!(
            "awareness={} monitor_rect={}x{} display_mode={}x{}",
            describe_awareness(),
            after.0,
            after.1,
            actual_after.0,
            actual_after.1
        );

        // Not asserted: this test exists to record which mode the binary runs in.
        // The production requirement is enforced by `require_physical_pixels`.
        if (after.0, after.1) != (seen.0, seen.1) {
            eprintln!("VIRTUALIZED: coordinates changed once awareness was set");
        }
    }
}
