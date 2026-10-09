//! The native frozen desktop, shown the moment capture finishes.
//!
//! A WebView overlay cannot paint until its renderer, document and frame are all
//! ready, so on its own the first visible frame waits on all of that. This layer
//! is one plain Win32 window per display that paints the captured DIB directly:
//! it is visible one composition after `BitBlt` returns. The transparent WebView
//! overlay is stacked immediately above it and carries every interaction, so
//! these windows never take focus, input or a task switch entry.
//!
//! Every native call here belongs to the main thread, which owns the windows and
//! pumps their messages. The bookkeeping is kept separate and pure so ownership
//! rules are testable without a desktop.

use std::sync::Mutex;

#[derive(Debug)]
struct Frozen {
    session_id: u64,
    /// Display id and window handle, as an integer so the record is `Send`.
    windows: Vec<(u32, isize)>,
}

/// Which session's freeze windows exist.
#[derive(Debug, Default)]
pub struct FreezeLayer(Mutex<Option<Frozen>>);

impl FreezeLayer {
    /// Records this session's windows and returns any left from an older one,
    /// which the caller must destroy.
    pub(crate) fn adopt(&self, session_id: u64, windows: Vec<(u32, isize)>) -> Vec<isize> {
        let previous = self
            .0
            .lock()
            .unwrap()
            .replace(Frozen {
                session_id,
                windows,
            });
        previous
            .map(|frozen| frozen.windows.into_iter().map(|(_, hwnd)| hwnd).collect())
            .unwrap_or_default()
    }

    /// Hands over this session's windows for destruction.
    pub(crate) fn take_if_session(&self, session_id: u64) -> Vec<isize> {
        let mut held = self.0.lock().unwrap();
        if held
            .as_ref()
            .is_some_and(|frozen| frozen.session_id == session_id)
        {
            held.take()
                .map(|frozen| frozen.windows.into_iter().map(|(_, hwnd)| hwnd).collect())
                .unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    pub(crate) fn window_for(&self, session_id: u64, display_id: u32) -> Option<isize> {
        let held = self.0.lock().unwrap();
        let frozen = held.as_ref().filter(|frozen| frozen.session_id == session_id)?;
        frozen
            .windows
            .iter()
            .find(|(id, _)| *id == display_id)
            .map(|(_, hwnd)| *hwnd)
    }
}

#[cfg(target_os = "windows")]
pub(crate) mod native {
    use std::sync::Arc;

    use super::super::backend::DisplayInfo;
    use super::super::gdi::DibFrame;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, BitBlt, CreateCompatibleDC, DeleteDC, EndPaint, SelectObject, UpdateWindow,
        HGDIOBJ, PAINTSTRUCT, SRCCOPY,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindowLongPtrW, LoadCursorW,
        RegisterClassExW, SetCursor, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWLP_USERDATA,
        HWND_TOPMOST, IDC_CROSS, MA_NOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SW_SHOWNOACTIVATE, WM_ERASEBKGND, WM_MOUSEACTIVATE, WM_NCDESTROY, WM_PAINT, WM_SETCURSOR,
        WNDCLASSEXW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
    };

    const CLASS_NAME: PCWSTR = w!("NowlyCaptureFreeze");

    fn hwnd(value: isize) -> HWND {
        HWND(value as *mut core::ffi::c_void)
    }

    fn instance() -> Result<HINSTANCE, String> {
        unsafe { GetModuleHandleW(None) }
            .map(|module| HINSTANCE(module.0))
            .map_err(|error| format!("module handle: {error}"))
    }

    fn register_class() -> Result<(), String> {
        static REGISTERED: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
        REGISTERED
            .get_or_init(|| {
                let class = WNDCLASSEXW {
                    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                    lpfnWndProc: Some(window_proc),
                    hInstance: instance()?,
                    hCursor: unsafe { LoadCursorW(None, IDC_CROSS) }.unwrap_or_default(),
                    lpszClassName: CLASS_NAME,
                    ..Default::default()
                };
                if unsafe { RegisterClassExW(&class) } == 0 {
                    return Err(format!(
                        "register freeze class: {}",
                        windows::core::Error::from_win32()
                    ));
                }
                Ok(())
            })
            .clone()
    }

    unsafe extern "system" fn window_proc(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_PAINT => {
                paint(window);
                LRESULT(0)
            }
            // The paint covers every pixel, so erasing first would only flash.
            WM_ERASEBKGND => LRESULT(1),
            // Input belongs to the WebView overlay above; a click that lands here
            // before it is shown must not activate anything.
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            WM_SETCURSOR => {
                if let Ok(cursor) = LoadCursorW(None, IDC_CROSS) {
                    SetCursor(Some(cursor));
                }
                LRESULT(1)
            }
            WM_NCDESTROY => {
                let frame = SetWindowLongPtrW(window, GWLP_USERDATA, 0) as *const DibFrame;
                if !frame.is_null() {
                    // Balances the `into_raw` in `create`.
                    drop(Arc::from_raw(frame));
                }
                DefWindowProcW(window, message, wparam, lparam)
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }

    unsafe fn paint(window: HWND) {
        let mut paint = PAINTSTRUCT::default();
        let target = BeginPaint(window, &mut paint);
        let frame = GetWindowLongPtrW(window, GWLP_USERDATA) as *const DibFrame;
        if !target.is_invalid() && !frame.is_null() {
            let frame = &*frame;
            let memory = CreateCompatibleDC(Some(target));
            if !memory.is_invalid() {
                let previous = SelectObject(memory, HGDIOBJ(frame.bitmap().0));
                let _ = BitBlt(
                    target,
                    0,
                    0,
                    frame.width,
                    frame.height,
                    Some(memory),
                    0,
                    0,
                    SRCCOPY,
                );
                SelectObject(memory, previous);
                let _ = DeleteDC(memory);
            }
        }
        let _ = EndPaint(window, &paint);
    }

    /// A hidden freeze window over exactly this display's physical rectangle.
    ///
    /// The window shares the captured section rather than copying it.
    pub(crate) fn create(display: &DisplayInfo, frame: Arc<DibFrame>) -> Result<isize, String> {
        register_class()?;
        let width = i32::try_from(display.width).map_err(|_| "display too wide".to_owned())?;
        let height = i32::try_from(display.height).map_err(|_| "display too tall".to_owned())?;
        let window = unsafe {
            CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                CLASS_NAME,
                w!("Nowly"),
                WS_POPUP,
                display.x,
                display.y,
                width,
                height,
                None,
                None,
                Some(instance()?),
                None,
            )
        }
        .map_err(|error| format!("freeze window: {error}"))?;
        unsafe {
            SetWindowLongPtrW(window, GWLP_USERDATA, Arc::into_raw(frame) as isize);
        }
        Ok(window.0 as isize)
    }

    /// Shows and paints synchronously, so the frame is ready for the next
    /// composition rather than waiting for a queued `WM_PAINT`.
    pub(crate) fn show(window: isize) {
        unsafe {
            let _ = ShowWindow(hwnd(window), SW_SHOWNOACTIVATE);
            let _ = UpdateWindow(hwnd(window));
        }
    }

    pub(crate) fn destroy(window: isize) {
        unsafe {
            let _ = DestroyWindow(hwnd(window));
        }
    }

    /// Puts an overlay at the top of the topmost band, then its freeze window
    /// directly beneath it, so the interactive layer always covers the frozen one.
    pub(crate) fn stack_under(freeze: Option<isize>, overlay: HWND) {
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
        unsafe {
            let _ = SetWindowPos(overlay, Some(HWND_TOPMOST), 0, 0, 0, 0, flags);
            if let Some(freeze) = freeze {
                let _ = SetWindowPos(hwnd(freeze), Some(overlay), 0, 0, 0, 0, flags);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::FreezeLayer;

    #[test]
    fn only_the_owning_session_can_take_its_windows() {
        let layer = FreezeLayer::default();
        assert!(layer.adopt(3, vec![(0, 10), (1, 11)]).is_empty());
        assert!(layer.take_if_session(2).is_empty());
        assert_eq!(layer.window_for(3, 1), Some(11));
        assert_eq!(layer.window_for(2, 1), None);
        assert_eq!(layer.take_if_session(3), vec![10, 11]);
        assert!(layer.take_if_session(3).is_empty());
        assert_eq!(layer.window_for(3, 0), None);
    }

    #[test]
    fn adopting_returns_a_stale_sessions_windows_for_destruction() {
        let layer = FreezeLayer::default();
        layer.adopt(1, vec![(0, 7)]);
        assert_eq!(layer.adopt(2, vec![(0, 8)]), vec![7]);
        assert_eq!(layer.window_for(2, 0), Some(8));
    }

    /// Creates, paints and destroys a real freeze window. Window creation and a
    /// synchronous paint work even on a locked desktop, unlike screen capture.
    #[cfg(target_os = "windows")]
    #[test]
    fn a_freeze_window_paints_its_frame_and_releases_it_when_destroyed() {
        use super::super::backend::{CaptureSource, DisplayInfo};
        use super::super::gdi::{DibFrame, GdiSource};

        let frame = DibFrame::synthetic(8, 4, [0x10, 0x20, 0x30, 0x00]);
        let rgba = GdiSource.native_rgba(&frame).unwrap();
        assert_eq!(&rgba[..4], &[0x30, 0x20, 0x10, 0xff]);

        let display = DisplayInfo {
            id: 0,
            x: -20_000,
            y: -20_000,
            width: 8,
            height: 4,
            scale_factor: 1.0,
            is_primary: true,
        };
        let window = super::native::create(&display, frame.clone()).expect("freeze window");
        assert_eq!(std::sync::Arc::strong_count(&frame), 2, "the window shares the frame");
        // Shown off-screen: `show` paints synchronously through the window proc.
        super::native::show(window);
        super::native::destroy(window);
        assert_eq!(
            std::sync::Arc::strong_count(&frame),
            1,
            "destroying the window must release the captured pixels"
        );
    }
}
