param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [ValidateSet('read', 'monitor', 'drag')][string]$Action = 'read',
    [long]$Handle = 0,
    [int]$X = 0,
    [int]$Y = 0,
    [int]$Dx = 80,
    [int]$Dy = 40
)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PinNative {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    public class Snapshot { public long hwnd; public string title; public bool visible; public RECT rect; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    public static Snapshot[] Read(uint target) {
        var rows = new List<Snapshot>();
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid == target) {
                var title = new StringBuilder(256); GetWindowText(h, title, 256);
                RECT rect; GetWindowRect(h, out rect);
                rows.Add(new Snapshot { hwnd = h.ToInt64(), title = title.ToString(), visible = IsWindowVisible(h), rect = rect });
            }
            return true;
        }, IntPtr.Zero);
        return rows.ToArray();
    }
}
'@

[void][PinNative]::SetProcessDPIAware()
if ($Action -eq 'monitor') {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $previous = ''
    Write-Output 'READY'
    while ($watch.ElapsedMilliseconds -lt 4000) {
        $windows = [PinNative]::Read($ProcessId)
        $current = ConvertTo-Json -InputObject $windows -Depth 4 -Compress
        if ($current -ne $previous) {
            @{ elapsed = $watch.ElapsedMilliseconds; windows = $windows } | ConvertTo-Json -Depth 5 -Compress
            $previous = $current
        }
        Start-Sleep -Milliseconds 5
    }
} elseif ($Action -eq 'drag') {
    $pidOfWindow = 0
    [void][PinNative]::GetWindowThreadProcessId([IntPtr]$Handle, [ref]$pidOfWindow)
    if ($pidOfWindow -ne $ProcessId) { throw 'The target window does not belong to the probe.' }
    $point = New-Object PinNative+POINT
    $point.X = $X; $point.Y = $Y
    $root = [PinNative]::GetAncestor([PinNative]::WindowFromPoint($point), 2)
    if ($root.ToInt64() -ne $Handle) {
        $rootRect = New-Object PinNative+RECT
        [void][PinNative]::GetWindowRect($root, [ref]$rootRect)
        $targetRect = New-Object PinNative+RECT
        [void][PinNative]::GetWindowRect([IntPtr]$Handle, [ref]$targetRect)
        $rootPid = 0
        [void][PinNative]::GetWindowThreadProcessId($root,[ref]$rootPid)
        throw ('The drag point is covered: point={0},{1} rootPid={2} rootRect={3} targetRect={4}' -f $X,$Y,$rootPid,($rootRect | ConvertTo-Json -Compress),($targetRect | ConvertTo-Json -Compress))
    }
    $cursor = New-Object PinNative+POINT
    [void][PinNative]::GetCursorPos([ref]$cursor)
    try {
        [void][PinNative]::SetCursorPos($X, $Y)
        [PinNative]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 150
        for ($i = 1; $i -le 20; $i++) {
            [void][PinNative]::SetCursorPos($X + [int]($Dx * $i / 20), $Y + [int]($Dy * $i / 20))
            Start-Sleep -Milliseconds 15
        }
    } finally {
        [PinNative]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
        [void][PinNative]::SetCursorPos($cursor.X, $cursor.Y)
    }
} else {
    ConvertTo-Json -InputObject ([PinNative]::Read($ProcessId)) -Depth 4 -Compress
}
