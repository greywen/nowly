//! The real Windows clipboard.
//!
//! §8.1 of docs/superpowers/specs/2026-09-25-nowly-screenshot-design.md: write the
//! standard Windows image formats, so WeChat, Paint and Word paste an image; never
//! a path and never Base64 text. Two formats are written together:
//!
//! - `CF_DIB`, which every Windows image consumer understands.
//! - A registered `PNG` format, which modern apps prefer and which keeps the exact
//!   encoded bytes.
//!
//! The sequence matters and is not obvious: `OpenClipboard` can fail because
//! another process holds it, `EmptyClipboard` must come before any
//! `SetClipboardData`, and once `SetClipboardData` succeeds **the system owns the
//! memory**, so it must not be freed here. Freeing it is a use-after-free that
//! shows up as a corrupted paste in another application.
//!
//! §8.1 also forbids blocking the UI forever on a busy clipboard, so opening is
//! bounded by the caller's retry loop in `output.rs`.

use windows::core::PCWSTR;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

use super::dib::rgba_to_dib;
use super::output::{ClipboardSink, EncodedImage, ExportError};

/// `CF_DIB`, from winuser.h. The `windows` crate exposes clipboard formats as
/// plain constants only in some feature sets, so the value is written here with its
/// source named rather than depending on that.
const CF_DIB: u32 = 8;
const CF_UNICODETEXT: u32 = 13;

pub(crate) struct WindowsClipboard<F = fn() -> bool> {
    owner: HWND,
    live: F,
}

#[cfg(test)]
impl WindowsClipboard<fn() -> bool> {
    pub(crate) fn new(owner: HWND) -> Self {
        Self {
            owner,
            live: || true,
        }
    }
}

impl<F: Fn() -> bool> WindowsClipboard<F> {
    pub(crate) fn guarded(owner: HWND, live: F) -> Self {
        Self { owner, live }
    }
}

/// Closes the clipboard however the scope exits, including on an early error.
struct ClipboardGuard;

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        // Nothing useful to do with a failure here: the clipboard is already open
        // and the process is about to continue either way.
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

fn open_clipboard(owner: HWND) -> Result<ClipboardGuard, ExportError> {
    // EmptyClipboard must install a real owner before SetClipboardData.
    if owner.0.is_null() {
        return Err(ExportError::WriteFailed("Missing clipboard owner".into()));
    }
    match unsafe { OpenClipboard(Some(owner)) } {
        Ok(()) => Ok(ClipboardGuard),
        // Another process holds it. The caller retries within its bound.
        Err(_) => Err(ExportError::ClipboardBusy),
    }
}

/// Copies bytes into a moveable global block, as `SetClipboardData` requires.
///
/// Returns the handle **without** freeing it, because ownership transfers to the
/// system on a successful `SetClipboardData`.
fn global_block(bytes: &[u8]) -> Result<HGLOBAL, ExportError> {
    let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }
        .map_err(|error| ExportError::WriteFailed(format!("GlobalAlloc failed: {error}")))?;

    let pointer = unsafe { GlobalLock(handle) };
    if pointer.is_null() {
        unsafe {
            let _ = GlobalFree(Some(handle));
        }
        return Err(ExportError::WriteFailed("GlobalLock returned null".into()));
    }

    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast::<u8>(), bytes.len());
        let _ = GlobalUnlock(handle);
    }

    Ok(handle)
}

/// Hands a block to the clipboard, freeing it only if the call fails.
fn set_format(format: u32, bytes: &[u8]) -> Result<(), ExportError> {
    let handle = global_block(bytes)?;
    // HGLOBAL and HANDLE are both a void pointer; the clipboard API takes the
    // latter while the allocator returns the former.
    match unsafe { SetClipboardData(format, Some(HANDLE(handle.0))) } {
        // The system now owns the block, so it must not be freed here.
        Ok(_) => Ok(()),
        Err(error) => {
            // Ownership did not transfer, so this is ours to release.
            unsafe {
                let _ = GlobalFree(Some(handle));
            }
            Err(ExportError::WriteFailed(format!(
                "SetClipboardData failed: {error}"
            )))
        }
    }
}

fn register_png_format() -> Option<u32> {
    // "PNG" is the conventional name modern applications look for.
    let name: Vec<u16> = "PNG\0".encode_utf16().collect();
    let format = unsafe { RegisterClipboardFormatW(PCWSTR(name.as_ptr())) };
    (format != 0).then_some(format)
}

fn prepare_and_commit<P, G>(
    prepare: impl FnOnce() -> Result<P, ExportError>,
    open: impl FnOnce() -> Result<G, ExportError>,
    live: impl FnOnce() -> bool,
    commit: impl FnOnce(P) -> Result<(), ExportError>,
) -> Result<(), ExportError> {
    let prepared = prepare()?;
    let _guard = open()?;
    // No session lock spans preparation or OS calls. This is the last boundary
    // before the commit closure empties the clipboard.
    if !live() {
        return Err(ExportError::Superseded);
    }
    commit(prepared)
}

impl<F: Fn() -> bool> ClipboardSink for WindowsClipboard<F> {
    fn write_image(&mut self, image: &EncodedImage) -> Result<(), ExportError> {
        prepare_and_commit(
            || {
                rgba_to_dib(&image.rgba, image.width, image.height).map_err(|error| {
                    ExportError::WriteFailed(format!("DIB conversion failed: {error:?}"))
                })
            },
            || open_clipboard(self.owner),
            &self.live,
            |dib| {
                unsafe { EmptyClipboard() }.map_err(|error| {
                    ExportError::WriteFailed(format!("EmptyClipboard failed: {error}"))
                })?;
                set_format(CF_DIB, &dib)?;
                // DIB is required; PNG is an optional enhancement.
                if let Some(png_format) = register_png_format() {
                    let _ = set_format(png_format, &image.png);
                }
                Ok(())
            },
        )
    }

    fn write_text(&mut self, text: &str) -> Result<(), ExportError> {
        prepare_and_commit(
            || {
                Ok(text
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect::<Vec<u16>>())
            },
            || open_clipboard(self.owner),
            &self.live,
            |wide| {
                unsafe { EmptyClipboard() }.map_err(|error| {
                    ExportError::WriteFailed(format!("EmptyClipboard failed: {error}"))
                })?;
                let bytes = unsafe {
                    std::slice::from_raw_parts(
                        wide.as_ptr().cast::<u8>(),
                        std::mem::size_of_val(&wide[..]),
                    )
                };
                set_format(CF_UNICODETEXT, bytes)
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{WindowsClipboard, CF_DIB, CF_UNICODETEXT};
    use crate::screen_capture::output::{ClipboardSink, EncodedImage};

    #[test]
    fn clipboard_stays_open_through_the_final_check_and_commit() {
        use std::cell::RefCell;
        struct Guard<'a>(&'a RefCell<Vec<&'static str>>);
        impl Drop for Guard<'_> {
            fn drop(&mut self) {
                self.0.borrow_mut().push("close");
            }
        }
        let events = RefCell::new(Vec::new());
        let result = super::prepare_and_commit(
            || {
                events.borrow_mut().push("prepare");
                Ok(vec![1, 2, 3])
            },
            || {
                events.borrow_mut().push("open");
                Ok(Guard(&events))
            },
            || {
                events.borrow_mut().push("live");
                true
            },
            |prepared| {
                assert_eq!(prepared, vec![1, 2, 3]);
                events.borrow_mut().push("empty-and-write");
                Ok(())
            },
        );
        assert_eq!(result, Ok(()));
        assert_eq!(
            events.into_inner(),
            ["prepare", "open", "live", "empty-and-write", "close"]
        );
    }

    #[test]
    fn retirement_during_dib_preparation_never_empties_the_clipboard() {
        let state = crate::screen_capture::ActiveCapture::default();
        let (session, _) = state.begin().unwrap();
        let mut emptied = false;
        let result = super::prepare_and_commit(
            || {
                let dib = super::rgba_to_dib(&[255, 0, 0, 255], 1, 1).unwrap();
                state.end_session(session.session_id);
                Ok(dib)
            },
            || Ok(()),
            || state.is_current(session.session_id),
            |_| {
                emptied = true;
                Ok(())
            },
        );
        assert_eq!(result, Err(super::ExportError::Superseded));
        assert!(!emptied);
    }

    #[test]
    fn retirement_during_clipboard_open_never_empties_the_clipboard() {
        let state = crate::screen_capture::ActiveCapture::default();
        let (session, _) = state.begin().unwrap();
        let mut emptied = false;
        let result = super::prepare_and_commit(
            || Ok(()),
            || {
                state.end_session(session.session_id);
                Ok(())
            },
            || state.is_current(session.session_id),
            |_| {
                emptied = true;
                Ok(())
            },
        );
        assert_eq!(result, Err(super::ExportError::Superseded));
        assert!(!emptied);
    }

    #[test]
    fn uses_the_documented_format_numbers() {
        // From winuser.h. A wrong number silently writes a format nothing reads.
        assert_eq!(CF_DIB, 8);
        assert_eq!(CF_UNICODETEXT, 13);
    }

    #[test]
    fn missing_clipboard_owner_is_rejected_without_touching_the_clipboard() {
        assert!(matches!(
            super::open_clipboard(super::HWND::default()),
            Err(super::ExportError::WriteFailed(_))
        ));
    }

    /// Writes a real image to the real clipboard and reads it back.
    ///
    /// The readback is the point: a successful `SetClipboardData` only proves the
    /// call was accepted, not that the DIB is well formed. Reading the bytes back
    /// and checking the header and one pixel proves the format another application
    /// would actually decode.
    ///
    /// `#[ignore]`d because it changes the machine's clipboard, which the test rules
    /// forbid doing implicitly. Run deliberately:
    /// `cargo test --manifest-path src-tauri/Cargo.toml writes_a_real_image -- --ignored`
    #[test]
    #[ignore = "changes the real clipboard"]
    fn writes_a_real_image_to_the_clipboard() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WS_POPUP,
        };
        struct OwnedWindow(super::HWND);
        impl Drop for OwnedWindow {
            fn drop(&mut self) {
                unsafe {
                    let _ = DestroyWindow(self.0);
                }
            }
        }
        let owner = OwnedWindow(
            unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!("Clipboard probe"),
                    WS_POPUP,
                    0,
                    0,
                    1,
                    1,
                    None,
                    None,
                    None,
                    None,
                )
            }
            .expect("create a hidden clipboard owner"),
        );
        let image = EncodedImage {
            // Not a valid PNG, which is fine: this probe checks the DIB path and
            // that an unreadable PNG does not fail the export.
            png: vec![0x89, b'P', b'N', b'G'],
            // Red then green, so a channel swap or a row flip is visible.
            rgba: vec![255, 0, 0, 255, 0, 255, 0, 255],
            width: 2,
            height: 1,
        };

        WindowsClipboard::new(owner.0)
            .write_image(&image)
            .expect("writing a 2x1 image to the clipboard should succeed");

        let dib = read_back_dib(owner.0).expect("the clipboard should hold a CF_DIB");

        // The 40-byte BITMAPINFOHEADER this module writes.
        assert_eq!(
            i32::from_le_bytes([dib[0], dib[1], dib[2], dib[3]]),
            40,
            "biSize"
        );
        assert_eq!(
            i32::from_le_bytes([dib[4], dib[5], dib[6], dib[7]]),
            2,
            "biWidth"
        );
        assert_eq!(
            i32::from_le_bytes([dib[8], dib[9], dib[10], dib[11]]),
            1,
            "biHeight"
        );
        assert_eq!(u16::from_le_bytes([dib[14], dib[15]]), 24, "biBitCount");
        // BGR: the red pixel then the green one.
        assert_eq!(&dib[40..46], &[0, 0, 255, 0, 255, 0], "pixels");
    }

    /// Reads `CF_DIB` straight back out of the clipboard.
    fn read_back_dib(owner: super::HWND) -> Option<Vec<u8>> {
        use windows::Win32::System::DataExchange::GetClipboardData;
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

        let _guard = super::open_clipboard(owner).ok()?;
        let handle = unsafe { GetClipboardData(CF_DIB) }.ok()?;
        let global = super::HGLOBAL(handle.0);

        let size = unsafe { GlobalSize(global) };
        let pointer = unsafe { GlobalLock(global) };
        if pointer.is_null() {
            return None;
        }
        let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), size) }.to_vec();
        unsafe {
            let _ = GlobalUnlock(global);
        }
        Some(bytes)
    }
}
