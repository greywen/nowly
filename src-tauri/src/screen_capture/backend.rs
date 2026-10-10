const BYTES_PER_PIXEL: u64 = 4;
const CAPTURE_PEAK_COPIES: u64 = 4;
const MAX_SESSION_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DisplayInfo {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CapturedDisplay {
    pub display: DisplayInfo,
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaptureBackendError {
    NoDisplays,
    CaptureFailed,
    /// The OS refused to read the screen at all.
    ///
    /// Distinct from `CaptureFailed` because the cause is environmental rather
    /// than a bug: a locked or switched-away desktop, a disconnected remote
    /// session, or a secure desktop (UAC prompt, Ctrl+Alt+Del) owning the input
    /// desktop. Retrying once the desktop is interactive succeeds, so the user is
    /// told that rather than "capture failed".
    AccessDenied,
    InvalidFrame,
    /// The process is not per-monitor DPI aware, so the OS would hand back
    /// virtualized coordinates and a stretched copy instead of physical pixels.
    NotDpiAware,
    ArithmeticOverflow,
    SessionBudgetExceeded,
}

pub(crate) trait CaptureSource {
    type Display;
    type Native;

    fn capture_native(&self, display: &Self::Display) -> Result<Self::Native, CaptureBackendError>;
    fn native_rgba(&self, native: &Self::Native) -> Result<Vec<u8>, CaptureBackendError>;
    fn capture_rgba(&self, display: &Self::Display) -> Result<Vec<u8>, CaptureBackendError> {
        self.native_rgba(&self.capture_native(display)?)
    }

    fn displays(&self) -> Result<Vec<Self::Display>, CaptureBackendError>;
    fn descriptor(&self, display: &Self::Display) -> Result<DisplayInfo, CaptureBackendError>;
}

pub(crate) struct NativeCapture<N> {
    pub display: DisplayInfo,
    pub native: N,
}

pub(crate) fn capture_native<S: CaptureSource>(
    source: &S,
) -> Result<Vec<NativeCapture<S::Native>>, CaptureBackendError> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let displays = source.displays()?;
        if displays.is_empty() {
            return Err(CaptureBackendError::NoDisplays);
        }
        let mut descriptors = Vec::with_capacity(displays.len());
        let mut bytes = 0u64;
        for display in &displays {
            let descriptor = source.descriptor(display)?;
            bytes = bytes.checked_add(rgba_len(&descriptor)?)
                .ok_or(CaptureBackendError::ArithmeticOverflow)?;
            descriptors.push(descriptor);
        }
        if bytes.checked_mul(CAPTURE_PEAK_COPIES)
            .ok_or(CaptureBackendError::ArithmeticOverflow)? > MAX_SESSION_BYTES {
            return Err(CaptureBackendError::SessionBudgetExceeded);
        }
        displays.iter().zip(descriptors).map(|(display, descriptor)| {
            Ok(NativeCapture { display: descriptor, native: source.capture_native(display)? })
        }).collect()
    })).unwrap_or(Err(CaptureBackendError::CaptureFailed))
}

pub(crate) fn to_frames<S: CaptureSource>(
    source: &S,
    captures: &[NativeCapture<S::Native>],
) -> Result<Vec<CapturedDisplay>, CaptureBackendError> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        captures.iter().map(|capture| {
            let rgba = source.native_rgba(&capture.native)?;
            if rgba.len() != rgba_len(&capture.display)? as usize {
                return Err(CaptureBackendError::InvalidFrame);
            }
            Ok(CapturedDisplay { display: capture.display.clone(), rgba })
        }).collect()
    })).unwrap_or(Err(CaptureBackendError::CaptureFailed))
}

pub(crate) fn capture_all<S: CaptureSource>(
    source: &S,
) -> Result<Vec<CapturedDisplay>, CaptureBackendError> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| capture_all_inner(source)))
        .unwrap_or(Err(CaptureBackendError::CaptureFailed))
}

fn capture_all_inner<S: CaptureSource>(
    source: &S,
) -> Result<Vec<CapturedDisplay>, CaptureBackendError> {
    let displays = source.displays()?;
    if displays.is_empty() {
        return Err(CaptureBackendError::NoDisplays);
    }

    let mut descriptors = Vec::with_capacity(displays.len());
    let mut stored_bytes = 0u64;
    for display in &displays {
        let descriptor = source.descriptor(display)?;
        let frame_bytes = rgba_len(&descriptor)?;
        stored_bytes = stored_bytes
            .checked_add(frame_bytes)
            .ok_or(CaptureBackendError::ArithmeticOverflow)?;
        descriptors.push(descriptor);
    }
    let peak_bytes = stored_bytes
        .checked_mul(CAPTURE_PEAK_COPIES)
        .ok_or(CaptureBackendError::ArithmeticOverflow)?;
    if peak_bytes > MAX_SESSION_BYTES {
        return Err(CaptureBackendError::SessionBudgetExceeded);
    }

    let mut frames = Vec::with_capacity(displays.len());
    for (display, descriptor) in displays.iter().zip(descriptors) {
        let expected_len = rgba_len(&descriptor)? as usize;
        let rgba = source.capture_rgba(display)?;
        if rgba.len() != expected_len {
            return Err(CaptureBackendError::InvalidFrame);
        }
        frames.push(CapturedDisplay {
            display: descriptor,
            rgba,
        });
    }
    Ok(frames)
}

fn rgba_len(display: &DisplayInfo) -> Result<u64, CaptureBackendError> {
    if display.width == 0 || display.height == 0 {
        return Err(CaptureBackendError::InvalidFrame);
    }
    u64::from(display.width)
        .checked_mul(u64::from(display.height))
        .and_then(|pixels| pixels.checked_mul(BYTES_PER_PIXEL))
        .ok_or(CaptureBackendError::ArithmeticOverflow)
}

#[cfg(test)]
mod tests {
    use super::{capture_all, CaptureBackendError, CaptureSource, DisplayInfo};

    struct FakeSource {
        displays: Vec<DisplayInfo>,
        fail_on: Option<u32>,
    }

    impl CaptureSource for FakeSource {
        type Display = DisplayInfo;
        type Native = Vec<u8>;

        fn capture_native(&self, display: &Self::Display) -> Result<Self::Native, CaptureBackendError> {
            self.capture_rgba(display)
        }

        fn native_rgba(&self, native: &Self::Native) -> Result<Vec<u8>, CaptureBackendError> {
            Ok(native.clone())
        }

        fn displays(&self) -> Result<Vec<Self::Display>, CaptureBackendError> {
            Ok(self.displays.clone())
        }

        fn descriptor(&self, display: &Self::Display) -> Result<DisplayInfo, CaptureBackendError> {
            Ok(display.clone())
        }

        fn capture_rgba(&self, display: &Self::Display) -> Result<Vec<u8>, CaptureBackendError> {
            if self.fail_on == Some(display.id) {
                return Err(CaptureBackendError::CaptureFailed);
            }
            Ok(vec![
                display.id as u8;
                (display.width * display.height * 4) as usize
            ])
        }
    }

    fn display(id: u32, x: i32, width: u32, height: u32) -> DisplayInfo {
        DisplayInfo {
            id,
            x,
            y: -40,
            width,
            height,
            scale_factor: 1.5,
            is_primary: id == 1,
        }
    }

    #[test]
    fn native_capture_converts_to_valid_frames_without_recapturing() {
        let source = FakeSource {
            displays: vec![display(1, 0, 2, 2), display(2, -2, 2, 2)],
            fail_on: None,
        };
        let natives = super::capture_native(&source).unwrap();
        let frames = super::to_frames(&source, &natives).unwrap();
        assert_eq!(frames, capture_all(&source).unwrap());
        let invalid = vec![super::NativeCapture {
            display: display(1, 0, 2, 2),
            native: vec![0; 15],
        }];
        assert_eq!(super::to_frames(&source, &invalid), Err(CaptureBackendError::InvalidFrame));
    }

    #[test]
    fn captures_every_display_with_physical_coordinates() {
        let frames = capture_all(&FakeSource {
            displays: vec![display(1, 0, 2, 2), display(2, -2, 2, 2)],
            fail_on: None,
        })
        .expect("all displays should capture");

        assert_eq!(frames.len(), 2);
        assert_eq!(frames[1].display.x, -2);
        assert_eq!(frames[1].display.y, -40);
        assert_eq!(frames[1].rgba, vec![2; 16]);
    }

    #[test]
    fn returns_no_partial_result_when_one_display_fails() {
        let result = capture_all(&FakeSource {
            displays: vec![display(1, 0, 2, 2), display(2, 2, 2, 2)],
            fail_on: Some(2),
        });

        assert_eq!(result, Err(CaptureBackendError::CaptureFailed));
    }

    #[test]
    fn rejects_invalid_rgba_buffer_length() {
        struct InvalidSource;

        impl CaptureSource for InvalidSource {
            type Display = DisplayInfo;
        type Native = Vec<u8>;

        fn capture_native(&self, display: &Self::Display) -> Result<Self::Native, CaptureBackendError> {
            self.capture_rgba(display)
        }

        fn native_rgba(&self, native: &Self::Native) -> Result<Vec<u8>, CaptureBackendError> {
            Ok(native.clone())
        }

            fn displays(&self) -> Result<Vec<Self::Display>, CaptureBackendError> {
                Ok(vec![display(1, 0, 2, 2)])
            }

            fn descriptor(
                &self,
                display: &Self::Display,
            ) -> Result<DisplayInfo, CaptureBackendError> {
                Ok(display.clone())
            }

            fn capture_rgba(
                &self,
                _display: &Self::Display,
            ) -> Result<Vec<u8>, CaptureBackendError> {
                Ok(vec![0; 15])
            }
        }

        assert_eq!(
            capture_all(&InvalidSource),
            Err(CaptureBackendError::InvalidFrame)
        );
    }

    #[test]
    fn rejects_an_empty_desktop() {
        assert_eq!(
            capture_all(&FakeSource {
                displays: Vec::new(),
                fail_on: None,
            }),
            Err(CaptureBackendError::NoDisplays)
        );
    }

    #[test]
    fn rejects_capture_before_allocating_over_the_session_budget() {
        struct BudgetSource;

        impl CaptureSource for BudgetSource {
            type Display = DisplayInfo;
        type Native = Vec<u8>;

        fn capture_native(&self, display: &Self::Display) -> Result<Self::Native, CaptureBackendError> {
            self.capture_rgba(display)
        }

        fn native_rgba(&self, native: &Self::Native) -> Result<Vec<u8>, CaptureBackendError> {
            Ok(native.clone())
        }

            fn displays(&self) -> Result<Vec<Self::Display>, CaptureBackendError> {
                Ok(vec![display(1, 0, 8_192, 5_120)])
            }

            fn descriptor(
                &self,
                display: &Self::Display,
            ) -> Result<DisplayInfo, CaptureBackendError> {
                Ok(display.clone())
            }

            fn capture_rgba(
                &self,
                _display: &Self::Display,
            ) -> Result<Vec<u8>, CaptureBackendError> {
                panic!("capture must not allocate after the budget check fails")
            }
        }

        assert_eq!(
            capture_all(&BudgetSource),
            Err(CaptureBackendError::SessionBudgetExceeded)
        );
    }

    #[test]
    fn converts_a_synchronous_backend_panic_into_a_capture_error() {
        struct PanickingSource;

        impl CaptureSource for PanickingSource {
            type Display = DisplayInfo;
        type Native = Vec<u8>;

        fn capture_native(&self, display: &Self::Display) -> Result<Self::Native, CaptureBackendError> {
            self.capture_rgba(display)
        }

        fn native_rgba(&self, native: &Self::Native) -> Result<Vec<u8>, CaptureBackendError> {
            Ok(native.clone())
        }

            fn displays(&self) -> Result<Vec<Self::Display>, CaptureBackendError> {
                Ok(vec![display(1, 0, 2, 2)])
            }

            fn descriptor(
                &self,
                display: &Self::Display,
            ) -> Result<DisplayInfo, CaptureBackendError> {
                Ok(display.clone())
            }

            fn capture_rgba(
                &self,
                _display: &Self::Display,
            ) -> Result<Vec<u8>, CaptureBackendError> {
                panic!("simulated WGC initialization panic")
            }
        }

        assert_eq!(
            capture_all(&PanickingSource),
            Err(CaptureBackendError::CaptureFailed)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn the_gdi_source_satisfies_the_capture_contract() {
        fn assert_capture_source<T: CaptureSource>() {}

        // The real desktop probe lives in `gdi.rs`; this only pins the contract.
        assert_capture_source::<super::super::gdi::GdiSource>();
    }
}
