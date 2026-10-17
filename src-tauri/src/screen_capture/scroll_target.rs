use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub(crate) struct Region {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
pub(crate) fn intersects(a: Region, b: Region) -> bool {
    (a.x as i64) < b.x as i64 + b.width as i64
        && (b.x as i64) < a.x as i64 + a.width as i64
        && (a.y as i64) < b.y as i64 + b.height as i64
        && (b.y as i64) < a.y as i64 + a.height as i64
}
pub(crate) fn control_placement(
    region: Region,
    monitor: Region,
    width: u32,
    height: u32,
) -> Option<Region> {
    let gap = 8i64;
    let candidates = [
        (region.x as i64 - width as i64 - gap, region.y as i64),
        (region.x as i64 + region.width as i64 + gap, region.y as i64),
        (region.x as i64, region.y as i64 - height as i64 - gap),
        (
            region.x as i64,
            region.y as i64 + region.height as i64 + gap,
        ),
    ];
    for (x, y) in candidates {
        if width > monitor.width || height > monitor.height {
            return None;
        }
        let x = x.clamp(
            monitor.x as i64,
            monitor.x as i64 + monitor.width as i64 - width as i64,
        );
        let y = y.clamp(
            monitor.y as i64,
            monitor.y as i64 + monitor.height as i64 - height as i64,
        );
        let candidate = Region {
            x: i32::try_from(x).ok()?,
            y: i32::try_from(y).ok()?,
            width,
            height,
        };
        if !intersects(region, candidate) {
            return Some(candidate);
        }
    }
    None
}
#[derive(Debug, Clone)]
pub(crate) struct Target {
    root: isize,
    child: isize,
    pid: u32,
    process_started: u64,
    bounds: (i32, i32, i32, i32),
    pub region: Region,
    pub point: (i32, i32),
}
#[cfg(windows)]
impl Target {
    pub fn bind(region: Region, point: (i32, i32)) -> Result<Self, String> {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::*;
        let child = unsafe {
            WindowFromPoint(POINT {
                x: point.0,
                y: point.1,
            })
        };
        let root = unsafe { GetAncestor(child, GA_ROOT) };
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(root, Some(&mut pid));
        }
        if pid == std::process::id() || root.0.is_null() {
            eprintln!("scroll target binding rejected: root={:?}, child={:?}, owner_pid={pid}, self_pid={}, foreground={:?}, root_visible={}",root.0,child.0,std::process::id(),unsafe{GetForegroundWindow()}.0,unsafe{IsWindowVisible(root)}.as_bool());
            return Err("No external scroll target at this point.".into());
        }
        let mut bounds = windows::Win32::Foundation::RECT::default();
        unsafe { GetWindowRect(root, &mut bounds) }.map_err(|_| "Target geometry unavailable")?;
        let target = Self {
            root: root.0 as isize,
            child: child.0 as isize,
            pid,
            process_started: process_started(pid)?,
            bounds: (bounds.left, bounds.top, bounds.right, bounds.bottom),
            region,
            point,
        };
        target.validate()?;
        Ok(target)
    }
    pub fn validate(&self) -> Result<(), String> {
        use windows::Win32::Foundation::{HWND, POINT, RECT};
        use windows::Win32::UI::WindowsAndMessaging::*;
        let root = HWND(self.root as *mut _);
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(root, Some(&mut pid));
        }
        let mut rect = RECT::default();
        unsafe { GetWindowRect(root, &mut rect) }.map_err(|_| "Target no longer exists")?;
        if pid != self.pid
            || process_started(pid)? != self.process_started
            || !unsafe { IsWindow(Some(root)) }.as_bool()
            || unsafe { GetForegroundWindow() } != root
            || (rect.left, rect.top, rect.right, rect.bottom) != self.bounds
        {
            return Err("Target focus or geometry changed; capture stopped.".into());
        }
        // Walk every visible top-level window above the target in Z order.
        // Even a nonactivating popup wholly inside the selection contaminates
        // screen pixels; point/corner sampling alone cannot prove visibility.
        let mut above = unsafe { GetTopWindow(None) }.map_err(|_| "Window order unavailable")?;
        let mut found = false;
        for _ in 0..4096 {
            if above == root {
                found = true;
                break;
            }
            if unsafe { IsWindowVisible(above) }.as_bool() && !unsafe { IsIconic(above) }.as_bool()
            {
                let mut bounds = RECT::default();
                unsafe { GetWindowRect(above, &mut bounds) }
                    .map_err(|_| "Occlusion geometry unavailable")?;
                if bounds.right > bounds.left
                    && bounds.bottom > bounds.top
                    && intersects(
                        self.region,
                        Region {
                            x: bounds.left,
                            y: bounds.top,
                            width: (bounds.right - bounds.left) as u32,
                            height: (bounds.bottom - bounds.top) as u32,
                        },
                    )
                {
                    return Err("Target is covered by another window; capture stopped.".into());
                }
            }
            match unsafe { GetWindow(above, GW_HWNDNEXT) } {
                Ok(next) => above = next,
                Err(_) => break,
            }
        }
        if !found {
            return Err("Target visibility could not be verified".into());
        }
        let r = self.region;
        for (x, y) in [
            (self.point.0, self.point.1),
            (r.x, r.y),
            (r.x + r.width as i32 - 1, r.y),
            (r.x, r.y + r.height as i32 - 1),
            (r.x + r.width as i32 - 1, r.y + r.height as i32 - 1),
        ] {
            let hit = unsafe { WindowFromPoint(POINT { x, y }) };
            if unsafe { GetAncestor(hit, GA_ROOT) } != root {
                return Err("Target is covered; capture stopped.".into());
            }
        }
        if unsafe {
            WindowFromPoint(POINT {
                x: self.point.0,
                y: self.point.1,
            })
        }
        .0 as isize
            != self.child
        {
            return Err("Scroll point target changed.".into());
        }
        Ok(())
    }
    pub fn capture(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        use super::backend::{CaptureSource, DisplayInfo};
        let r = self.region;
        let display = DisplayInfo {
            id: 0,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            scale_factor: 1.,
            is_primary: false,
        };
        let pixels = super::gdi::GdiSource
            .capture_rgba(&display)
            .map_err(|_| "Live capture failed".to_string())?;
        self.validate()?;
        Ok(pixels)
    }
}
#[cfg(not(windows))]
impl Target {
    pub fn bind(_: Region, _: (i32, i32)) -> Result<Self, String> {
        Err("Scroll capture requires Windows.".into())
    }
    pub fn validate(&self) -> Result<(), String> {
        Err("Unsupported platform".into())
    }
    pub fn capture(&self) -> Result<Vec<u8>, String> {
        Err("Unsupported platform".into())
    }
}

#[cfg(windows)]
fn process_started(pid: u32) -> Result<u64, String> {
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
        .map_err(|_| "Target process identity cannot be verified")?;
    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    let result =
        unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) };
    unsafe {
        let _ = CloseHandle(handle);
    }
    result.map_err(|_| "Target process identity cannot be verified")?;
    Ok(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
}
