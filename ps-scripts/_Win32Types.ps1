# Shared Win32 P/Invoke declarations for nost PS scripts.
# Dot-source at the top of any script that needs Win32 API calls:
#   . "$PSScriptRoot\_Win32Types.ps1"

if (-not ([System.Management.Automation.PSTypeName]'NostWin32').Type) {
    Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public class NostWin32 {
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndAfter, int X, int Y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public struct RECT { public int Left, Top, Right, Bottom; }
    public struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }
    // Enumerate ALL visible top-level windows whose title contains the needle.
    // Essential for multi-document Office apps (PowerPoint with two .pptx
    // files open) where Process.MainWindowHandle only points at ONE of the
    // app's top-level windows — the others are invisible to Get-Process but
    // still real HWNDs we need to find and move.
    public static List<IntPtr> FindWindowsByTitleContains(string needle) {
        var hits = new List<IntPtr>();
        if (string.IsNullOrEmpty(needle)) return hits;
        EnumWindows((hWnd, lParam) => {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLength(hWnd);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            var title = sb.ToString();
            if (title.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) {
                hits.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return hits;
    }
    public static void SnapLeft(IntPtr hWnd) {
        ShowWindow(hWnd, 9); SetForegroundWindow(hWnd); Thread.Sleep(350);
        keybd_event(0x5B,0,0,UIntPtr.Zero); keybd_event(0x25,0,0,UIntPtr.Zero);
        keybd_event(0x25,0,2,UIntPtr.Zero); keybd_event(0x5B,0,2,UIntPtr.Zero);
        Thread.Sleep(500);
    }
    public static void SnapRight(IntPtr hWnd) {
        ShowWindow(hWnd, 9); SetForegroundWindow(hWnd); Thread.Sleep(350);
        keybd_event(0x5B,0,0,UIntPtr.Zero); keybd_event(0x27,0,0,UIntPtr.Zero);
        keybd_event(0x27,0,2,UIntPtr.Zero); keybd_event(0x5B,0,2,UIntPtr.Zero);
        Thread.Sleep(500);
    }
}
"@
}
