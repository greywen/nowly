//! Persistent, worker-thread-local Desktop Duplication capture (no cursor overlay).

use super::scroll_target::Region;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Crop {
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
}

fn output_crop(region: Region, bounds: [i32; 4]) -> Result<Crop, String> {
    let [left, top, right, bottom] = bounds.map(i64::from);
    let x = i64::from(region.x);
    let y = i64::from(region.y);
    let end_x = x + i64::from(region.width);
    let end_y = y + i64::from(region.height);
    if region.width == 0
        || region.height == 0
        || right <= left
        || bottom <= top
        || x < left
        || y < top
        || end_x > right
        || end_y > bottom
    {
        return Err("DXGI scroll region must be nonempty and contained in one output".into());
    }
    Ok(Crop {
        left: u32::try_from(x - left).map_err(|_| "DXGI crop x overflow")?,
        top: u32::try_from(y - top).map_err(|_| "DXGI crop y overflow")?,
        right: u32::try_from(end_x - left).map_err(|_| "DXGI crop right overflow")?,
        bottom: u32::try_from(end_y - top).map_err(|_| "DXGI crop bottom overflow")?,
    })
}

fn mapped_len(pitch: usize, width: u32, height: u32) -> Result<usize, String> {
    if width == 0 || height == 0 {
        return Err("DXGI texture dimensions must be nonzero".into());
    }
    let row = usize::try_from(width)
        .ok()
        .and_then(|w| w.checked_mul(4))
        .ok_or("DXGI row byte count overflow")?;
    if pitch < row {
        return Err("DXGI row pitch is smaller than texture width".into());
    }
    usize::try_from(height - 1)
        .ok()
        .and_then(|h| h.checked_mul(pitch))
        .and_then(|n| n.checked_add(row))
        .filter(|n| *n <= isize::MAX as usize)
        .ok_or_else(|| "DXGI mapped buffer length overflow".into())
}

fn bgra_crop_rgba(
    data: &[u8],
    pitch: usize,
    width: u32,
    height: u32,
    crop: Crop,
) -> Result<Vec<u8>, String> {
    let required = mapped_len(pitch, width, height)?;
    if data.len() < required
        || crop.left >= crop.right
        || crop.top >= crop.bottom
        || crop.right > width
        || crop.bottom > height
    {
        return Err("DXGI invalid crop or truncated pixel buffer".into());
    }
    let row_bytes = usize::try_from(crop.right - crop.left)
        .ok()
        .and_then(|w| w.checked_mul(4))
        .ok_or("DXGI crop row overflow")?;
    let size = usize::try_from(crop.bottom - crop.top)
        .ok()
        .and_then(|h| h.checked_mul(row_bytes))
        .filter(|n| *n <= isize::MAX as usize)
        .ok_or("DXGI RGBA buffer length overflow")?;
    let mut rgba = Vec::new();
    rgba.try_reserve_exact(size)
        .map_err(|e| format!("DXGI RGBA allocation failed: {e}"))?;
    for y in crop.top..crop.bottom {
        // mapped_len and crop bounds prove these offsets fit within data.
        let start = y as usize * pitch + crop.left as usize * 4;
        for pixel in data[start..start + row_bytes].chunks_exact(4) {
            rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
        }
    }
    Ok(rgba)
}

#[cfg(windows)]
pub(crate) use desktop_duplication::ScrollFrameSource;

#[cfg(windows)]
mod desktop_duplication {
    use super::{bgra_crop_rgba, mapped_len, output_crop, Crop, Region};
    use std::{marker::PhantomData, rc::Rc};
    use windows::{
        core::{Error, Interface},
        Win32::{
            Foundation::HMODULE,
            Graphics::{
                Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
                Direct3D11::{
                    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
                    D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    D3D11_CREATE_DEVICE_SINGLETHREADED, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
                    D3D11_REQ_TEXTURE2D_U_OR_V_DIMENSION, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
                    D3D11_USAGE_STAGING,
                },
                Dxgi::{
                    Common::{
                        DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_ROTATION_IDENTITY, DXGI_SAMPLE_DESC,
                    },
                    CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1,
                    IDXGIOutputDuplication, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_DEVICE_REMOVED,
                    DXGI_ERROR_DEVICE_RESET, DXGI_ERROR_NOT_FOUND, DXGI_ERROR_WAIT_TIMEOUT,
                    DXGI_OUTDUPL_FRAME_INFO,
                },
            },
            UI::HiDpi::{
                SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
                DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
            },
        },
    };

    fn dxgi_error(operation: &str, error: Error) -> String {
        let explanation = match error.code() {
            DXGI_ERROR_ACCESS_LOST => "desktop duplication access lost; recreate the source after the desktop/display change",
            DXGI_ERROR_DEVICE_REMOVED | DXGI_ERROR_DEVICE_RESET => "graphics device removed/reset; recreate the source",
            _ => "Desktop Duplication failed (desktop may be locked, secure, or unavailable)",
        };
        format!("DXGI {operation}: {explanation}: {error}")
    }

    struct PhysicalCoordinates(DPI_AWARENESS_CONTEXT);

    impl PhysicalCoordinates {
        fn enter() -> Result<Self, String> {
            let previous =
                unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
            if previous.0.is_null() {
                return Err("DXGI could not enter physical-pixel DPI context".into());
            }
            Ok(Self(previous))
        }
    }

    impl Drop for PhysicalCoordinates {
        fn drop(&mut self) {
            unsafe { SetThreadDpiAwarenessContext(self.0) };
        }
    }

    struct AcquiredFrame<'a> {
        duplication: &'a IDXGIOutputDuplication,
        held: bool,
    }

    impl AcquiredFrame<'_> {
        fn release(mut self) -> Result<(), String> {
            self.held = false;
            unsafe { self.duplication.ReleaseFrame() }.map_err(|e| dxgi_error("ReleaseFrame", e))
        }
    }

    impl Drop for AcquiredFrame<'_> {
        fn drop(&mut self) {
            if self.held {
                // Release exactly once, including cast, validation, Map and allocation errors.
                let _ = unsafe { self.duplication.ReleaseFrame() };
            }
        }
    }

    struct MappedTexture<'a> {
        context: &'a ID3D11DeviceContext,
        texture: &'a ID3D11Texture2D,
    }

    impl Drop for MappedTexture<'_> {
        fn drop(&mut self) {
            unsafe { self.context.Unmap(self.texture, 0) };
        }
    }

    /// Construct and use on the capture worker. Only the selected output's adapter is used.
    pub(crate) struct ScrollFrameSource {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        duplication: IDXGIOutputDuplication,
        staging: ID3D11Texture2D,
        crop: Crop,
        output_width: u32,
        output_height: u32,
        // The device's immediate context uses SINGLETHREADED: prevent cross-thread use.
        _worker_only: PhantomData<Rc<()>>,
    }

    impl ScrollFrameSource {
        pub(crate) fn new(region: Region) -> Result<Self, String> {
            if region.width == 0
                || region.height == 0
                || region.width > D3D11_REQ_TEXTURE2D_U_OR_V_DIMENSION
                || region.height > D3D11_REQ_TEXTURE2D_U_OR_V_DIMENSION
            {
                return Err(
                    "DXGI scroll region dimensions must be 1..=16384 physical pixels".into(),
                );
            }
            // DXGI output bounds can otherwise be DPI-virtualized on an unaware worker.
            let _physical_coordinates = PhysicalCoordinates::enter()?;
            let factory: IDXGIFactory1 =
                unsafe { CreateDXGIFactory1() }.map_err(|e| dxgi_error("CreateDXGIFactory1", e))?;
            let mut adapter_index = 0u32;
            loop {
                let adapter = match unsafe { factory.EnumAdapters1(adapter_index) } {
                    Ok(adapter) => adapter,
                    Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                    Err(e) => return Err(dxgi_error("EnumAdapters1", e)),
                };
                let mut output_index = 0u32;
                loop {
                    let output = match unsafe { adapter.EnumOutputs(output_index) } {
                        Ok(output) => output,
                        Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                        Err(e) => return Err(dxgi_error("EnumOutputs", e)),
                    };
                    let desc = unsafe { output.GetDesc() }.map_err(|e| dxgi_error("GetDesc", e))?;
                    let rect = desc.DesktopCoordinates;
                    if desc.AttachedToDesktop.as_bool() {
                        if let Ok(crop) =
                            output_crop(region, [rect.left, rect.top, rect.right, rect.bottom])
                        {
                            if desc.Rotation != DXGI_MODE_ROTATION_IDENTITY {
                                return Err(
                                    "DXGI scroll capture does not support rotated outputs".into()
                                );
                            }
                            let output: IDXGIOutput1 =
                                output.cast().map_err(|e| dxgi_error("IDXGIOutput1", e))?;
                            let width = u32::try_from(i64::from(rect.right) - i64::from(rect.left))
                                .map_err(|_| "DXGI output width overflow")?;
                            let height =
                                u32::try_from(i64::from(rect.bottom) - i64::from(rect.top))
                                    .map_err(|_| "DXGI output height overflow")?;
                            return Self::create(&adapter, &output, crop, width, height);
                        }
                    }
                    output_index = output_index
                        .checked_add(1)
                        .ok_or("DXGI output index overflow")?;
                }
                adapter_index = adapter_index
                    .checked_add(1)
                    .ok_or("DXGI adapter index overflow")?;
            }
            Err("DXGI scroll region is not contained in a single attached output (cross-monitor capture is unsupported)".into())
        }

        fn create(
            adapter: &IDXGIAdapter1,
            output: &IDXGIOutput1,
            crop: Crop,
            output_width: u32,
            output_height: u32,
        ) -> Result<Self, String> {
            let mut device = None;
            let mut context = None;
            unsafe {
                D3D11CreateDevice(
                    adapter,
                    D3D_DRIVER_TYPE_UNKNOWN,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_SINGLETHREADED,
                    None,
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    Some(&mut context),
                )
            }
            .map_err(|e| dxgi_error("D3D11CreateDevice on output adapter", e))?;
            let device = device.ok_or("DXGI D3D11CreateDevice returned no device")?;
            let context = context.ok_or("DXGI D3D11CreateDevice returned no immediate context")?;
            let duplication = unsafe { output.DuplicateOutput(&device) }
                .map_err(|e| dxgi_error("DuplicateOutput", e))?;
            let desc = unsafe { duplication.GetDesc() };
            if desc.ModeDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM {
                return Err(format!(
                    "DXGI unsupported desktop format {:?}; BGRA8 required",
                    desc.ModeDesc.Format
                ));
            }
            if desc.Rotation != DXGI_MODE_ROTATION_IDENTITY
                || desc.ModeDesc.Width != output_width
                || desc.ModeDesc.Height != output_height
            {
                return Err(
                    "DXGI output geometry changed or is rotated; recreate the source".into(),
                );
            }
            let texture_desc = D3D11_TEXTURE2D_DESC {
                Width: crop.right - crop.left,
                Height: crop.bottom - crop.top,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                ..Default::default()
            };
            let mut staging = None;
            unsafe { device.CreateTexture2D(&texture_desc, None, Some(&mut staging)) }
                .map_err(|e| dxgi_error("CreateTexture2D staging region", e))?;
            Ok(Self {
                device,
                context,
                duplication,
                staging: staging.ok_or("DXGI CreateTexture2D returned no staging texture")?,
                crop,
                output_width,
                output_height,
                _worker_only: PhantomData,
            })
        }

        pub(crate) fn next_frame(&mut self, timeout_ms: u32) -> Result<Option<Vec<u8>>, String> {
            // INFINITE cannot be cancelled by the worker; keep this API bounded.
            if timeout_ms == u32::MAX {
                return Err("DXGI frame timeout must be finite".into());
            }
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource = None;
            match unsafe {
                self.duplication
                    .AcquireNextFrame(timeout_ms, &mut info, &mut resource)
            } {
                Ok(()) => (),
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
                Err(e) => return Err(dxgi_error("AcquireNextFrame", e)),
            }
            let frame = AcquiredFrame {
                duplication: &self.duplication,
                held: true,
            };
            let rgba = (|| {
                let resource =
                    resource.ok_or("DXGI AcquireNextFrame returned no desktop resource")?;
                let texture: ID3D11Texture2D = resource
                    .cast()
                    .map_err(|e| dxgi_error("desktop texture cast", e))?;
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                unsafe { texture.GetDesc(&mut desc) };
                if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM
                    || desc.Width != self.output_width
                    || desc.Height != self.output_height
                    || desc.SampleDesc.Count != 1
                    || desc.SampleDesc.Quality != 0
                    || desc.MipLevels != 1
                    || desc.ArraySize != 1
                {
                    return Err("DXGI acquired texture format/geometry is unsupported or changed; recreate the source".into());
                }
                let source_box = D3D11_BOX {
                    left: self.crop.left,
                    top: self.crop.top,
                    right: self.crop.right,
                    bottom: self.crop.bottom,
                    front: 0,
                    back: 1,
                };
                unsafe {
                    self.context.CopySubresourceRegion(
                        &self.staging,
                        0,
                        0,
                        0,
                        0,
                        &texture,
                        0,
                        Some(&source_box),
                    )
                };
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                unsafe {
                    self.context
                        .Map(&self.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                }
                .map_err(|e| dxgi_error("Map staging region", e))?;
                let _mapping = MappedTexture {
                    context: &self.context,
                    texture: &self.staging,
                };
                unsafe { self.device.GetDeviceRemovedReason() }
                    .map_err(|e| dxgi_error("device status", e))?;
                let width = self.crop.right - self.crop.left;
                let height = self.crop.bottom - self.crop.top;
                let len = mapped_len(mapped.RowPitch as usize, width, height)?;
                if mapped.pData.is_null() {
                    return Err("DXGI Map returned a null pixel buffer".into());
                }
                // The successful Map owns at least height rows of RowPitch bytes.
                // Read only through the last actual pixel, never trailing row padding.
                let pixels = unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>(), len) };
                bgra_crop_rgba(
                    pixels,
                    mapped.RowPitch as usize,
                    width,
                    height,
                    Crop {
                        left: 0,
                        top: 0,
                        right: width,
                        bottom: height,
                    },
                )
            })();
            // Unmap happens inside the closure before releasing the acquired frame.
            let released = frame.release();
            let rgba = rgba?;
            released?;
            Ok(Some(rgba))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_padded_cropped_rows_and_forces_opaque_alpha() {
        let bgra = [
            1, 2, 3, 0, 4, 5, 6, 7, 8, 9, 10, 11, 99, 99, 99, 99, 12, 13, 14, 15, 16, 17, 18, 0,
            19, 20, 21, 22,
        ];
        let crop = Crop {
            left: 1,
            top: 0,
            right: 3,
            bottom: 2,
        };
        assert_eq!(
            bgra_crop_rgba(&bgra, 16, 3, 2, crop).unwrap(),
            [6, 5, 4, 255, 10, 9, 8, 255, 18, 17, 16, 255, 21, 20, 19, 255]
        );
    }

    #[test]
    fn converts_a_nonzero_top_crop() {
        let bgra = [0, 0, 0, 0, 99, 99, 99, 99, 1, 2, 3, 4];
        assert_eq!(
            bgra_crop_rgba(
                &bgra,
                8,
                1,
                2,
                Crop {
                    left: 0,
                    top: 1,
                    right: 1,
                    bottom: 2
                }
            )
            .unwrap(),
            [3, 2, 1, 255]
        );
    }

    #[test]
    fn rejects_invalid_buffers_pitch_and_crops() {
        let full = Crop {
            left: 0,
            top: 0,
            right: 2,
            bottom: 2,
        };
        for (data, pitch, width, height, crop) in [
            (&[0u8; 15][..], 8, 2, 2, full),
            (&[0u8; 16][..], 7, 2, 2, full),
            (&[0u8; 16][..], 8, 0, 2, full),
            (&[0u8; 16][..], 8, 2, 0, full),
            (&[0u8; 16][..], 8, 2, 2, Crop { right: 3, ..full }),
            (&[0u8; 16][..], 8, 2, 2, Crop { bottom: 3, ..full }),
            (&[0u8; 16][..], 8, 2, 2, Crop { left: 2, ..full }),
            (&[0u8; 16][..], 8, 2, 2, Crop { top: 2, ..full }),
            (&[0u8; 16][..], usize::MAX, 2, 2, full),
        ] {
            assert!(bgra_crop_rgba(data, pitch, width, height, crop).is_err());
        }
    }

    #[test]
    fn signed_output_relative_crop_preserves_negative_desktop_coordinates() {
        let region = Region {
            x: -1800,
            y: -200,
            width: 430,
            height: 618,
        };
        assert_eq!(
            output_crop(region, [-1920, -300, 0, 780]).unwrap(),
            Crop {
                left: 120,
                top: 100,
                right: 550,
                bottom: 718
            }
        );
        assert_eq!(
            output_crop(
                Region {
                    x: -1920,
                    y: -300,
                    width: 1920,
                    height: 1080
                },
                [-1920, -300, 0, 780]
            )
            .unwrap(),
            Crop {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080
            }
        );
    }

    #[test]
    fn rejects_empty_cross_output_and_overflowing_regions() {
        for region in [
            Region {
                x: -1921,
                y: 0,
                width: 10,
                height: 10,
            },
            Region {
                x: -10,
                y: 0,
                width: 11,
                height: 10,
            },
            Region {
                x: -100,
                y: -301,
                width: 10,
                height: 10,
            },
            Region {
                x: -100,
                y: 779,
                width: 10,
                height: 2,
            },
            Region {
                x: -100,
                y: 0,
                width: 0,
                height: 10,
            },
            Region {
                x: -100,
                y: 0,
                width: 10,
                height: 0,
            },
            Region {
                x: i32::MAX,
                y: 0,
                width: u32::MAX,
                height: 10,
            },
        ] {
            assert!(output_crop(region, [-1920, -300, 0, 780]).is_err());
        }
        assert!(output_crop(
            Region {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            },
            [1, 0, 0, 1]
        )
        .is_err());
    }
}
