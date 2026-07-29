#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl MonitorRect {
    pub fn width(self) -> i32 {
        self.right - self.left
    }

    pub fn height(self) -> i32 {
        self.bottom - self.top
    }
}

const WS_POPUP_STYLE: u32 = 0x80000000;
const WS_CHILD_STYLE: u32 = 0x40000000;
const WS_CAPTION_STYLE: u32 = 0x00C00000;
const WS_THICKFRAME_STYLE: u32 = 0x00040000;
const WS_BORDER_STYLE: u32 = 0x00800000;
const WS_DLGFRAME_STYLE: u32 = 0x00400000;
const WS_SYSMENU_STYLE: u32 = 0x00080000;
const WS_MINIMIZEBOX_STYLE: u32 = 0x00020000;
const WS_MAXIMIZEBOX_STYLE: u32 = 0x00010000;
const WS_EX_DLGMODALFRAME_STYLE: u32 = 0x00000001;
const WS_EX_WINDOWEDGE_STYLE: u32 = 0x00000100;
const WS_EX_CLIENTEDGE_STYLE: u32 = 0x00000200;
const WS_EX_STATICEDGE_STYLE: u32 = 0x00020000;

fn borderless_child_style(style: u32) -> u32 {
    (style
        & !(WS_POPUP_STYLE
            | WS_CAPTION_STYLE
            | WS_THICKFRAME_STYLE
            | WS_BORDER_STYLE
            | WS_DLGFRAME_STYLE
            | WS_SYSMENU_STYLE
            | WS_MINIMIZEBOX_STYLE
            | WS_MAXIMIZEBOX_STYLE))
        | WS_CHILD_STYLE
}

fn native_foreground_style(style: u32) -> u32 {
    (style & !(WS_CHILD_STYLE | WS_POPUP_STYLE))
        | WS_CAPTION_STYLE
        | WS_THICKFRAME_STYLE
        | WS_SYSMENU_STYLE
        | WS_MINIMIZEBOX_STYLE
        | WS_MAXIMIZEBOX_STYLE
}

fn borderless_extended_style(style: u32) -> u32 {
    style
        & !(WS_EX_DLGMODALFRAME_STYLE
            | WS_EX_WINDOWEDGE_STYLE
            | WS_EX_CLIENTEDGE_STYLE
            | WS_EX_STATICEDGE_STYLE)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TaskbarState {
    rect: MonitorRect,
    auto_hide: bool,
    visible: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskbarEdge {
    Top,
    Bottom,
    Left,
    Right,
}

fn valid_rect(rect: MonitorRect) -> bool {
    rect.right > rect.left && rect.bottom > rect.top
}

fn intersect_rect(first: MonitorRect, second: MonitorRect) -> Option<MonitorRect> {
    let intersection = MonitorRect {
        left: first.left.max(second.left),
        top: first.top.max(second.top),
        right: first.right.min(second.right),
        bottom: first.bottom.min(second.bottom),
    };
    valid_rect(intersection).then_some(intersection)
}

fn taskbar_edge(monitor: MonitorRect, intersection: MonitorRect) -> Option<TaskbarEdge> {
    let horizontal = intersection.width() >= intersection.height();
    let mut edges = Vec::with_capacity(2);

    if horizontal {
        if intersection.top == monitor.top {
            edges.push(TaskbarEdge::Top);
        }
        if intersection.bottom == monitor.bottom {
            edges.push(TaskbarEdge::Bottom);
        }
    } else {
        if intersection.left == monitor.left {
            edges.push(TaskbarEdge::Left);
        }
        if intersection.right == monitor.right {
            edges.push(TaskbarEdge::Right);
        }
    }

    (edges.len() == 1).then(|| edges[0])
}

#[derive(Debug, Default)]
struct ListenerLifecycle {
    generation: u64,
    active: bool,
}

impl ListenerLifecycle {
    fn activate(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.active = true;
        self.generation
    }

    fn deactivate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.active = false;
    }

    fn is_current(&self, generation: u64) -> bool {
        self.active && self.generation == generation
    }
}

fn accepts_taskbar_event(tracked_hwnd: isize, event_hwnd: isize, object_id: i32) -> bool {
    tracked_hwnd != 0 && tracked_hwnd == event_hwnd && object_id == 0
}

fn corrected_outer_rect(
    desired_client: MonitorRect,
    current_outer: MonitorRect,
    current_client: MonitorRect,
) -> MonitorRect {
    MonitorRect {
        left: current_outer.left + desired_client.left - current_client.left,
        top: current_outer.top + desired_client.top - current_client.top,
        right: current_outer.right + desired_client.right - current_client.right,
        bottom: current_outer.bottom + desired_client.bottom - current_client.bottom,
    }
}

fn wallpaper_rect(
    monitor: MonitorRect,
    work: MonitorRect,
    taskbar: Option<TaskbarState>,
) -> MonitorRect {
    let fallback = if valid_rect(work) { work } else { monitor };
    let Some(taskbar) = taskbar else {
        return fallback;
    };

    if taskbar.auto_hide && !taskbar.visible {
        return monitor;
    }

    let Some(intersection) = intersect_rect(monitor, taskbar.rect) else {
        return fallback;
    };
    let Some(edge) = taskbar_edge(monitor, intersection) else {
        return fallback;
    };

    let thickness = match edge {
        TaskbarEdge::Top | TaskbarEdge::Bottom => intersection.height(),
        TaskbarEdge::Left | TaskbarEdge::Right => intersection.width(),
    };
    if taskbar.auto_hide && thickness <= 2 {
        return monitor;
    }

    let target = match edge {
        TaskbarEdge::Top => MonitorRect {
            top: intersection.bottom,
            ..monitor
        },
        TaskbarEdge::Bottom => MonitorRect {
            bottom: intersection.top,
            ..monitor
        },
        TaskbarEdge::Left => MonitorRect {
            left: intersection.right,
            ..monitor
        },
        TaskbarEdge::Right => MonitorRect {
            right: intersection.left,
            ..monitor
        },
    };

    if valid_rect(target) {
        target
    } else {
        fallback
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{
        accepts_taskbar_event, borderless_child_style, borderless_extended_style,
        corrected_outer_rect, native_foreground_style, wallpaper_rect, ListenerLifecycle,
        MonitorRect, TaskbarState, WS_EX_WINDOWEDGE_STYLE,
    };
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{Runtime, Window};
    use windows::core::{w, BOOL};
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MapWindowPoints, MonitorFromWindow, HMONITOR, MONITORINFO,
        MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE, ABS_AUTOHIDE, APPBARDATA};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetClientRect,
        GetWindowLongPtrW, GetWindowRect, IsWindowVisible, SendMessageTimeoutW,
        SetForegroundWindow, SetLayeredWindowAttributes, SetParent, SetWindowLongPtrW,
        SetWindowPos, ShowWindow, EVENT_OBJECT_HIDE, EVENT_OBJECT_LOCATIONCHANGE,
        EVENT_OBJECT_SHOW, GWL_EXSTYLE, GWL_STYLE, HWND_BOTTOM, LWA_ALPHA,
        SEND_MESSAGE_TIMEOUT_FLAGS, SMTO_NORMAL, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, WINEVENT_OUTOFCONTEXT, WS_EX_LAYERED,
        WS_EX_NOREDIRECTIONBITMAP,
    };

    const CREATE_WORKERW_MESSAGE: u32 = 0x052C;
    const TASKBAR_DEBOUNCE_MS: u64 = 150;

    #[derive(Debug, Clone, Copy)]
    struct MonitorBounds {
        handle: HMONITOR,
        monitor: MonitorRect,
        work: MonitorRect,
    }

    #[derive(Debug, Default)]
    struct WallpaperListener {
        lifecycle: ListenerLifecycle,
        debounce_token: u64,
        wallpaper_hwnd: isize,
        parent_hwnd: isize,
        taskbar_hwnd: isize,
        hooks: Vec<isize>,
        last_rect: Option<MonitorRect>,
    }

    static LISTENER: OnceLock<Mutex<WallpaperListener>> = OnceLock::new();
    static WINDOW_OPERATION: OnceLock<Mutex<()>> = OnceLock::new();

    fn listener() -> &'static Mutex<WallpaperListener> {
        LISTENER.get_or_init(|| Mutex::new(WallpaperListener::default()))
    }

    fn window_operation() -> &'static Mutex<()> {
        WINDOW_OPERATION.get_or_init(|| Mutex::new(()))
    }

    #[derive(Debug, Clone, Copy)]
    struct DesktopLayer {
        progman: HWND,
        workerw: Option<HWND>,
        shell_def_view: Option<HWND>,
        raised_desktop: bool,
    }

    fn hwnd_is_null(hwnd: HWND) -> bool {
        hwnd.0.is_null()
    }

    fn fmt_hwnd(hwnd: Option<HWND>) -> String {
        match hwnd {
            Some(value) => format!("{:?}", value),
            None => "None".to_string(),
        }
    }

    pub fn hwnd_for_window<R: Runtime>(window: &Window<R>) -> Result<HWND, String> {
        window
            .hwnd()
            .map_err(|error| format!("failed to get window handle: {error}"))
    }

    fn monitor_bounds_for_hwnd(hwnd: HWND) -> Result<MonitorBounds, String> {
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if monitor.is_invalid() {
                return Err("failed to resolve monitor for window".to_string());
            }

            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return Err("failed to read monitor info".to_string());
            }

            Ok(MonitorBounds {
                handle: monitor,
                monitor: MonitorRect {
                    left: info.rcMonitor.left,
                    top: info.rcMonitor.top,
                    right: info.rcMonitor.right,
                    bottom: info.rcMonitor.bottom,
                },
                work: MonitorRect {
                    left: info.rcWork.left,
                    top: info.rcWork.top,
                    right: info.rcWork.right,
                    bottom: info.rcWork.bottom,
                },
            })
        }
    }

    #[derive(Debug)]
    struct TaskbarEnumState {
        monitor: HMONITOR,
        taskbar: HWND,
    }

    unsafe extern "system" fn enum_windows_find_taskbar(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = lparam.0 as *mut TaskbarEnumState;
        if state.is_null() {
            return BOOL(0);
        }

        let mut class_name = [0u16; 64];
        let length = unsafe { GetClassNameW(hwnd, &mut class_name) };
        if length == 0 {
            return BOOL(1);
        }
        let class_name = String::from_utf16_lossy(&class_name[..length as usize]);
        if class_name != "Shell_TrayWnd" && class_name != "Shell_SecondaryTrayWnd" {
            return BOOL(1);
        }

        let candidate_monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        if candidate_monitor == unsafe { (*state).monitor } {
            unsafe { (*state).taskbar = hwnd };
            return BOOL(0);
        }
        BOOL(1)
    }

    fn is_taskbar_window(hwnd: HWND) -> bool {
        let mut class_name = [0u16; 64];
        let length = unsafe { GetClassNameW(hwnd, &mut class_name) };
        if length == 0 {
            return false;
        }
        matches!(
            String::from_utf16_lossy(&class_name[..length as usize]).as_str(),
            "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        )
    }

    fn taskbar_for_monitor(monitor: HMONITOR) -> Option<HWND> {
        let mut state = TaskbarEnumState {
            monitor,
            taskbar: HWND::default(),
        };
        unsafe {
            let _ = EnumWindows(
                Some(enum_windows_find_taskbar),
                LPARAM((&mut state as *mut TaskbarEnumState) as isize),
            );
        }
        (!hwnd_is_null(state.taskbar)).then_some(state.taskbar)
    }

    fn taskbar_state(hwnd: HWND) -> Result<TaskbarState, String> {
        unsafe {
            let mut rect = RECT::default();
            GetWindowRect(hwnd, &mut rect)
                .map_err(|error| format!("failed to read taskbar rectangle: {error}"))?;
            let mut appbar = APPBARDATA {
                cbSize: std::mem::size_of::<APPBARDATA>() as u32,
                hWnd: hwnd,
                ..Default::default()
            };
            let appbar_state = SHAppBarMessage(ABM_GETSTATE, &mut appbar);

            Ok(TaskbarState {
                rect: MonitorRect {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                },
                auto_hide: (appbar_state as u32 & ABS_AUTOHIDE) != 0,
                visible: IsWindowVisible(hwnd).as_bool(),
            })
        }
    }

    fn current_wallpaper_rect(
        hwnd: HWND,
    ) -> Result<
        (
            MonitorBounds,
            Option<HWND>,
            Option<TaskbarState>,
            MonitorRect,
        ),
        String,
    > {
        let bounds = monitor_bounds_for_hwnd(hwnd)?;
        let taskbar = taskbar_for_monitor(bounds.handle);
        let state = taskbar.and_then(|taskbar| match taskbar_state(taskbar) {
            Ok(state) => Some(state),
            Err(error) => {
                eprintln!("taskbar state unavailable; falling back to work area: {error}");
                None
            }
        });
        let target = wallpaper_rect(bounds.monitor, bounds.work, state);
        Ok((bounds, taskbar, state, target))
    }

    fn initialize_desktop_layer() -> Result<DesktopLayer, String> {
        unsafe {
            let progman = FindWindowW(w!("Progman"), None)
                .map_err(|error| format!("Progman not found: {error}"))?;
            if hwnd_is_null(progman) {
                return Err("Progman returned null HWND".to_string());
            }

            let progman_ex_style = GetWindowLongPtrW(progman, GWL_EXSTYLE) as u32;
            let raised_desktop = (progman_ex_style & WS_EX_NOREDIRECTIONBITMAP.0) != 0;

            let mut send_result = 0usize;
            let _ = SendMessageTimeoutW(
                progman,
                CREATE_WORKERW_MESSAGE,
                WPARAM(0xD),
                LPARAM(0x1),
                SEND_MESSAGE_TIMEOUT_FLAGS(SMTO_NORMAL.0),
                1000,
                Some(&mut send_result),
            );

            let mut state = DesktopEnumState {
                def_view_host: HWND::default(),
                workerw: HWND::default(),
                shell_def_view: HWND::default(),
            };
            let state_ptr = &mut state as *mut DesktopEnumState;
            EnumWindows(Some(enum_windows_find_desktop), LPARAM(state_ptr as isize))
                .map_err(|error| format!("failed to enumerate desktop windows: {error}"))?;

            if raised_desktop {
                if let Ok(child_workerw) = FindWindowExW(Some(progman), None, w!("WorkerW"), None) {
                    if !hwnd_is_null(child_workerw) {
                        state.workerw = child_workerw;
                    }
                }
            }

            Ok(DesktopLayer {
                progman,
                workerw: (!hwnd_is_null(state.workerw)).then_some(state.workerw),
                shell_def_view: (!hwnd_is_null(state.shell_def_view))
                    .then_some(state.shell_def_view),
                raised_desktop,
            })
        }
    }

    #[derive(Debug, Clone, Copy)]
    struct DesktopEnumState {
        def_view_host: HWND,
        workerw: HWND,
        shell_def_view: HWND,
    }

    unsafe extern "system" fn enum_windows_find_desktop(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let shell_view = unsafe { FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None) };
        if let Ok(shell_view) = shell_view {
            if !hwnd_is_null(shell_view) {
                let state = lparam.0 as *mut DesktopEnumState;
                if !state.is_null() {
                    unsafe {
                        (*state).def_view_host = hwnd;
                        (*state).shell_def_view = shell_view;
                    }

                    let workerw = unsafe { FindWindowExW(None, Some(hwnd), w!("WorkerW"), None) };
                    if let Ok(workerw) = workerw {
                        if !hwnd_is_null(workerw) {
                            unsafe { (*state).workerw = workerw };
                        }
                    }
                }
            }
        }
        BOOL(1)
    }

    fn hwnd_from_isize(value: isize) -> HWND {
        HWND(value as *mut std::ffi::c_void)
    }

    fn position_wallpaper(
        hwnd: HWND,
        parent: HWND,
        rect: MonitorRect,
    ) -> Result<MonitorRect, String> {
        let mut points = [
            POINT {
                x: rect.left,
                y: rect.top,
            },
            POINT {
                x: rect.right,
                y: rect.bottom,
            },
        ];
        unsafe {
            let _ = MapWindowPoints(None, Some(parent), &mut points);
            let desired_client = MonitorRect {
                left: points[0].x,
                top: points[0].y,
                right: points[1].x,
                bottom: points[1].y,
            };
            SetWindowPos(
                hwnd,
                Some(HWND_BOTTOM),
                desired_client.left,
                desired_client.top,
                desired_client.width(),
                desired_client.height(),
                SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
            .map_err(|error| format!("failed to position wallpaper child window: {error}"))?;

            let mut outer = RECT::default();
            let mut client = RECT::default();
            GetWindowRect(hwnd, &mut outer)
                .map_err(|error| format!("failed to read wallpaper outer rectangle: {error}"))?;
            GetClientRect(hwnd, &mut client)
                .map_err(|error| format!("failed to read wallpaper client rectangle: {error}"))?;
            let mut client_points = [
                POINT {
                    x: client.left,
                    y: client.top,
                },
                POINT {
                    x: client.right,
                    y: client.bottom,
                },
            ];
            let _ = MapWindowPoints(Some(hwnd), Some(parent), &mut client_points);
            let mut outer_points = [
                POINT {
                    x: outer.left,
                    y: outer.top,
                },
                POINT {
                    x: outer.right,
                    y: outer.bottom,
                },
            ];
            let _ = MapWindowPoints(None, Some(parent), &mut outer_points);
            let corrected = corrected_outer_rect(
                desired_client,
                MonitorRect {
                    left: outer_points[0].x,
                    top: outer_points[0].y,
                    right: outer_points[1].x,
                    bottom: outer_points[1].y,
                },
                MonitorRect {
                    left: client_points[0].x,
                    top: client_points[0].y,
                    right: client_points[1].x,
                    bottom: client_points[1].y,
                },
            );
            SetWindowPos(
                hwnd,
                Some(HWND_BOTTOM),
                corrected.left,
                corrected.top,
                corrected.width(),
                corrected.height(),
                SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
            .map_err(|error| format!("failed to align wallpaper client area: {error}"))?;
        }
        Ok(rect)
    }

    fn take_hooks_and_deactivate() -> Vec<isize> {
        let mut state = listener()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.lifecycle.deactivate();
        state.debounce_token = state.debounce_token.wrapping_add(1);
        state.wallpaper_hwnd = 0;
        state.parent_hwnd = 0;
        state.taskbar_hwnd = 0;
        state.last_rect = None;
        std::mem::take(&mut state.hooks)
    }

    fn unhook_all(hooks: Vec<isize>) {
        for hook in hooks {
            unsafe {
                if !UnhookWinEvent(HWINEVENTHOOK(hook as *mut std::ffi::c_void)).as_bool() {
                    eprintln!("failed to unregister taskbar WinEvent hook {hook:#x}");
                }
            }
        }
    }

    fn stop_listener() {
        unhook_all(take_hooks_and_deactivate());
    }

    fn register_hooks() -> Vec<isize> {
        let mut hooks = Vec::new();
        unsafe {
            for (first, last) in [
                (EVENT_OBJECT_SHOW, EVENT_OBJECT_HIDE),
                (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
            ] {
                let hook = SetWinEventHook(
                    first,
                    last,
                    None,
                    Some(taskbar_win_event),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                );
                if hook.is_invalid() {
                    eprintln!(
                        "failed to register taskbar WinEvent hook for {first:#x}..={last:#x}"
                    );
                } else {
                    hooks.push(hook.0 as isize);
                }
            }
        }
        hooks
    }

    fn schedule_recalculation() {
        let (generation, token) = {
            let mut state = listener()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !state.lifecycle.active {
                return;
            }
            state.debounce_token = state.debounce_token.wrapping_add(1);
            (state.lifecycle.generation, state.debounce_token)
        };

        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(TASKBAR_DEBOUNCE_MS));
            if let Err(error) = recalculate_if_current(generation, token) {
                eprintln!("failed to update wallpaper after taskbar change: {error}");
            }
        });
    }

    fn recalculate_if_current(generation: u64, token: u64) -> Result<(), String> {
        let (wallpaper_value, parent_value, last_rect) = {
            let state = listener()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !state.lifecycle.is_current(generation) || state.debounce_token != token {
                return Ok(());
            }
            (state.wallpaper_hwnd, state.parent_hwnd, state.last_rect)
        };
        if wallpaper_value == 0 || parent_value == 0 {
            return Ok(());
        }

        let hwnd = hwnd_from_isize(wallpaper_value);
        let parent = hwnd_from_isize(parent_value);
        let (bounds, taskbar, taskbar_state, target) = current_wallpaper_rect(hwnd)?;
        let _operation = window_operation()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        {
            let state = listener()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !state.lifecycle.is_current(generation) || state.debounce_token != token {
                return Ok(());
            }
        }
        if last_rect != Some(target) {
            position_wallpaper(hwnd, parent, target)?;
        }

        {
            let mut state = listener()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !state.lifecycle.is_current(generation) || state.debounce_token != token {
                return Ok(());
            }
            state.taskbar_hwnd = taskbar.map_or(0, |value| value.0 as isize);
            state.last_rect = Some(target);
        }

        println!(
            "wallpaper bounds monitor={:?} work={:?} taskbar={:?} state={:?} target={:?} fallback={}",
            bounds.monitor,
            bounds.work,
            taskbar,
            taskbar_state,
            target,
            taskbar_state.is_none()
        );
        Ok(())
    }

    unsafe extern "system" fn taskbar_win_event(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        object_id: i32,
        _child_id: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let _ = std::panic::catch_unwind(|| {
            let (active, tracked_taskbar, wallpaper_value) = {
                let state = listener()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                (
                    state.lifecycle.active,
                    state.taskbar_hwnd,
                    state.wallpaper_hwnd,
                )
            };
            if !active || object_id != 0 {
                return;
            }

            let tracked = accepts_taskbar_event(tracked_taskbar, hwnd.0 as isize, object_id);
            let replacement_on_same_monitor = wallpaper_value != 0
                && is_taskbar_window(hwnd)
                && unsafe {
                    MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
                        == MonitorFromWindow(
                            hwnd_from_isize(wallpaper_value),
                            MONITOR_DEFAULTTONEAREST,
                        )
                };
            if tracked || replacement_on_same_monitor {
                schedule_recalculation();
            }
        });
    }

    pub fn notify_window_changed(hwnd: HWND) {
        let matches = {
            let state = listener()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.lifecycle.active && state.wallpaper_hwnd == hwnd.0 as isize
        };
        if matches {
            schedule_recalculation();
        }
    }

    pub fn notify_window_destroyed(hwnd: HWND) {
        let matches = {
            let state = listener()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.wallpaper_hwnd == hwnd.0 as isize
        };
        if matches {
            stop_listener();
        }
    }

    fn ensure_workerw_z_order(layer: DesktopLayer) {
        if !layer.raised_desktop {
            return;
        }
        let Some(workerw) = layer.workerw else {
            return;
        };

        unsafe {
            let mut last_child = HWND::default();
            let last_child_ptr = &mut last_child as *mut HWND;
            let _ = EnumChildWindows(
                Some(layer.progman),
                Some(enum_child_windows_last),
                LPARAM(last_child_ptr as isize),
            );

            if last_child != workerw {
                let _ = SetWindowPos(
                    workerw,
                    Some(HWND_BOTTOM),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }

    unsafe extern "system" fn enum_child_windows_last(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = lparam.0 as *mut HWND;
        if !out.is_null() {
            unsafe { *out = hwnd };
        }
        BOOL(1)
    }

    pub fn enter_wallpaper(hwnd: HWND) -> Result<String, String> {
        stop_listener();
        let _operation = window_operation()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let layer = initialize_desktop_layer()?;
        let (bounds, taskbar, state, rect) = current_wallpaper_rect(hwnd)?;
        let target_parent = if layer.raised_desktop {
            layer.progman
        } else {
            layer.workerw.unwrap_or(layer.progman)
        };

        unsafe {
            SetWindowPos(
                hwnd,
                None,
                rect.left,
                rect.top,
                rect.width(),
                rect.height(),
                SWP_SHOWWINDOW | SWP_NOACTIVATE,
            )
            .map_err(|error| format!("failed to pre-size window: {error}"))?;

            let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            SetWindowLongPtrW(hwnd, GWL_STYLE, borderless_child_style(style) as isize);
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            let ex_style = borderless_extended_style(ex_style);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style as isize);

            if layer.raised_desktop {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex_style | WS_EX_LAYERED.0) as isize);
                SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA)
                    .map_err(|error| format!("failed to set layered attributes: {error}"))?;
            }

            SetParent(hwnd, Some(target_parent))
                .map_err(|error| format!("failed to attach window to desktop parent: {error}"))?;
            position_wallpaper(hwnd, target_parent, rect)?;

            if layer.raised_desktop {
                if let Some(shell_def_view) = layer.shell_def_view {
                    let _ = SetWindowPos(
                        hwnd,
                        Some(shell_def_view),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    );
                }
                ensure_workerw_z_order(layer);
            }
        }

        let hooks = register_hooks();
        {
            let mut listener = listener()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            listener.lifecycle.activate();
            listener.wallpaper_hwnd = hwnd.0 as isize;
            listener.parent_hwnd = target_parent.0 as isize;
            listener.taskbar_hwnd = taskbar.map_or(0, |value| value.0 as isize);
            listener.last_rect = Some(rect);
            listener.hooks = hooks;
        }

        Ok(format!(
            "wallpaper mode ok hwnd={:?} progman={:?} workerw={} shell={} raised={} parent={:?} monitor={:?} work={:?} taskbar={:?} state={:?} rect={}x{}+{},{}",
            hwnd,
            layer.progman,
            fmt_hwnd(layer.workerw),
            fmt_hwnd(layer.shell_def_view),
            layer.raised_desktop,
            target_parent,
            bounds.monitor,
            bounds.work,
            taskbar,
            state,
            rect.width(),
            rect.height(),
            rect.left,
            rect.top
        ))
    }

    pub fn enter_foreground(hwnd: HWND) -> Result<String, String> {
        stop_listener();
        let _operation = window_operation()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        unsafe {
            SetParent(hwnd, None)
                .map_err(|error| format!("failed to detach window from desktop parent: {error}"))?;
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            SetWindowLongPtrW(hwnd, GWL_STYLE, native_foreground_style(style) as isize);
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                (borderless_extended_style(ex_style) | WS_EX_WINDOWEDGE_STYLE) as isize,
            );
            SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
            )
            .map_err(|error| format!("failed to restore foreground window frame: {error}"))?;
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
        Ok(format!("foreground mode ok hwnd={hwnd:?}"))
    }
}

#[cfg(target_os = "windows")]
pub fn enter_foreground_webview<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<String, String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to get webview window handle: {error}"))?;
    let message = platform::enter_foreground(hwnd)?;
    println!("{message}");
    Ok(message)
}

#[cfg(target_os = "windows")]
pub fn notify_window_changed<R: tauri::Runtime>(window: &tauri::Window<R>) {
    if let Ok(hwnd) = window.hwnd() {
        platform::notify_window_changed(hwnd);
    }
}

#[cfg(target_os = "windows")]
pub fn notify_window_destroyed<R: tauri::Runtime>(window: &tauri::Window<R>) {
    if let Ok(hwnd) = window.hwnd() {
        platform::notify_window_destroyed(hwnd);
    }
}

#[tauri::command]
pub fn enter_wallpaper_mode(window: tauri::Window) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = platform::hwnd_for_window(&window)?;
        let message = platform::enter_wallpaper(hwnd)?;
        println!("{message}");
        Ok(message)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("wallpaper mode is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn enter_foreground_mode(window: tauri::Window) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = platform::hwnd_for_window(&window)?;
        let message = platform::enter_foreground(hwnd)?;
        println!("{message}");
        Ok(message)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("foreground mode switching is only supported on Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        borderless_child_style, native_foreground_style, MonitorRect, WS_BORDER_STYLE,
        WS_CAPTION_STYLE, WS_CHILD_STYLE, WS_DLGFRAME_STYLE, WS_EX_CLIENTEDGE_STYLE,
        WS_EX_DLGMODALFRAME_STYLE, WS_EX_STATICEDGE_STYLE, WS_EX_WINDOWEDGE_STYLE,
        WS_MAXIMIZEBOX_STYLE, WS_MINIMIZEBOX_STYLE, WS_POPUP_STYLE, WS_SYSMENU_STYLE,
        WS_THICKFRAME_STYLE,
    };

    #[test]
    fn monitor_rect_reports_width_and_height() {
        let rect = MonitorRect {
            left: 10,
            top: 20,
            right: 1930,
            bottom: 1100,
        };

        assert_eq!(rect.width(), 1920);
        assert_eq!(rect.height(), 1080);
    }

    #[test]
    fn wallpaper_child_style_removes_invisible_resize_frame() {
        let original = WS_POPUP_STYLE
            | WS_CAPTION_STYLE
            | WS_THICKFRAME_STYLE
            | WS_BORDER_STYLE
            | WS_DLGFRAME_STYLE
            | WS_SYSMENU_STYLE
            | WS_MINIMIZEBOX_STYLE
            | WS_MAXIMIZEBOX_STYLE;
        let style = borderless_child_style(original);

        assert_eq!(style & WS_CHILD_STYLE, WS_CHILD_STYLE);
        assert_eq!(style & WS_POPUP_STYLE, 0);
        assert_eq!(style & WS_CAPTION_STYLE, 0);
        assert_eq!(style & WS_THICKFRAME_STYLE, 0);
        assert_eq!(style & WS_BORDER_STYLE, 0);
        assert_eq!(style & WS_DLGFRAME_STYLE, 0);
        assert_eq!(style & WS_SYSMENU_STYLE, 0);
        assert_eq!(style & WS_MINIMIZEBOX_STYLE, 0);
        assert_eq!(style & WS_MAXIMIZEBOX_STYLE, 0);
    }

    #[test]
    fn outer_rect_expands_to_make_client_cover_target() {
        let desired = MonitorRect {
            left: 0,
            top: 0,
            right: 2194,
            bottom: 1186,
        };
        let outer = desired;
        let client = MonitorRect {
            left: 7,
            top: 1,
            right: 2187,
            bottom: 1179,
        };

        assert_eq!(
            super::corrected_outer_rect(desired, outer, client),
            MonitorRect {
                left: -7,
                top: -1,
                right: 2201,
                bottom: 1193
            }
        );
    }

    #[test]
    fn wallpaper_extended_style_removes_non_client_edges() {
        let original = WS_EX_DLGMODALFRAME_STYLE
            | WS_EX_WINDOWEDGE_STYLE
            | WS_EX_CLIENTEDGE_STYLE
            | WS_EX_STATICEDGE_STYLE
            | 0x00080000;

        let style = super::borderless_extended_style(original);

        assert_eq!(style & WS_EX_DLGMODALFRAME_STYLE, 0);
        assert_eq!(style & WS_EX_WINDOWEDGE_STYLE, 0);
        assert_eq!(style & WS_EX_CLIENTEDGE_STYLE, 0);
        assert_eq!(style & WS_EX_STATICEDGE_STYLE, 0);
        assert_eq!(style & 0x00080000, 0x00080000);
    }

    #[test]
    fn foreground_style_restores_native_windows_titlebar() {
        let original = WS_CHILD_STYLE | WS_POPUP_STYLE;
        let style = native_foreground_style(original);

        assert_eq!(style & WS_CHILD_STYLE, 0);
        assert_eq!(style & WS_POPUP_STYLE, 0);
        assert_eq!(style & WS_CAPTION_STYLE, WS_CAPTION_STYLE);
        assert_eq!(style & WS_THICKFRAME_STYLE, WS_THICKFRAME_STYLE);
        assert_eq!(style & WS_SYSMENU_STYLE, WS_SYSMENU_STYLE);
        assert_eq!(style & WS_MINIMIZEBOX_STYLE, WS_MINIMIZEBOX_STYLE);
        assert_eq!(style & WS_MAXIMIZEBOX_STYLE, WS_MAXIMIZEBOX_STYLE);
    }

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> MonitorRect {
        MonitorRect {
            left,
            top,
            right,
            bottom,
        }
    }

    fn taskbar(rect: MonitorRect, auto_hide: bool, visible: bool) -> super::TaskbarState {
        super::TaskbarState {
            rect,
            auto_hide,
            visible,
        }
    }

    #[test]
    fn taskbar_on_each_edge_is_removed_from_monitor() {
        let monitor = rect(0, 0, 1920, 1080);
        let work = rect(0, 0, 1920, 1040);

        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(0, 0, 1920, 40), false, true))
            ),
            rect(0, 40, 1920, 1080)
        );
        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(0, 1040, 1920, 1080), false, true))
            ),
            rect(0, 0, 1920, 1040)
        );
        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(0, 0, 48, 1080), false, true))
            ),
            rect(48, 0, 1920, 1080)
        );
        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(1872, 0, 1920, 1080), false, true))
            ),
            rect(0, 0, 1872, 1080)
        );
    }

    #[test]
    fn taskbar_geometry_supports_negative_monitor_coordinates_and_partial_intersection() {
        let monitor = rect(-1920, -100, 0, 980);
        let work = rect(-1920, -60, 0, 980);
        let bar = rect(-2000, -120, 100, -60);

        assert_eq!(
            super::wallpaper_rect(monitor, work, Some(taskbar(bar, false, true))),
            rect(-1920, -60, 0, 980)
        );
    }

    #[test]
    fn collapsed_auto_hide_strip_does_not_reserve_space() {
        let monitor = rect(0, 0, 1920, 1080);
        let work = rect(0, 0, 1920, 1040);

        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(0, 1079, 1920, 1080), true, true))
            ),
            monitor
        );
        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(0, 1078, 1920, 1080), true, true))
            ),
            monitor
        );
        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(0, 1077, 1920, 1080), true, true))
            ),
            rect(0, 0, 1920, 1077)
        );
        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(0, 1040, 1920, 1080), true, false))
            ),
            monitor
        );
    }

    #[test]
    fn normal_thin_taskbar_is_still_reserved() {
        let monitor = rect(0, 0, 1920, 1080);
        assert_eq!(
            super::wallpaper_rect(
                monitor,
                monitor,
                Some(taskbar(rect(0, 1079, 1920, 1080), false, true))
            ),
            rect(0, 0, 1920, 1079)
        );
    }

    #[test]
    fn invalid_taskbar_falls_back_to_work_then_monitor() {
        let monitor = rect(0, 0, 1920, 1080);
        let work = rect(0, 0, 1920, 1040);

        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(20, 20, 100, 100), false, true))
            ),
            work
        );
        assert_eq!(
            super::wallpaper_rect(
                monitor,
                work,
                Some(taskbar(rect(2000, 0, 2100, 100), false, true))
            ),
            work
        );
        assert_eq!(
            super::wallpaper_rect(monitor, rect(0, 0, 0, 0), None),
            monitor
        );
    }

    #[test]
    fn taskbar_from_another_monitor_is_ignored() {
        let monitor = rect(0, 0, 1920, 1080);
        let work = rect(0, 0, 1920, 1040);
        let other_bar = rect(-1920, 1040, 0, 1080);

        assert_eq!(
            super::wallpaper_rect(monitor, work, Some(taskbar(other_bar, false, true))),
            work
        );
    }

    #[test]
    fn listener_generation_invalidates_old_and_deactivated_work() {
        let mut lifecycle = super::ListenerLifecycle::default();
        let old = lifecycle.activate();
        let current = lifecycle.activate();

        assert!(!lifecycle.is_current(old));
        assert!(lifecycle.is_current(current));
        lifecycle.deactivate();
        assert!(!lifecycle.is_current(current));
    }

    #[test]
    fn taskbar_event_filter_accepts_only_tracked_window_object() {
        assert!(super::accepts_taskbar_event(42, 42, 0));
        assert!(!super::accepts_taskbar_event(42, 7, 0));
        assert!(!super::accepts_taskbar_event(42, 42, 1));
        assert!(!super::accepts_taskbar_event(0, 0, 0));
    }
}
