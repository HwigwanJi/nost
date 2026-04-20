# Centralized window positioning for nost.
# PS queries monitor work areas via .NET Screen class (no DPI translation needed).

function Get-NativeWorkArea {
    param([int]$MonitorIndex = 0)

    # PREFER Electron-provided env vars when present.
    #
    # Electron enumerates monitors in its own order, which matches what the
    # user sees in nost settings. PS's System.Windows.Forms.Screen enumerates
    # independently — and on setups with mixed DPI or rearranged displays,
    # the two orders can DIFFER. If PS looks up monitor N via its own list,
    # "monitor 2" in the UI can land on a completely different physical
    # monitor than the user expects.
    #
    # Using Electron's coordinates is therefore the canonical source of
    # truth. QL_SCREEN_W is always emitted by run-tile-ps / tile-windows
    # handlers in main.js.
    if ($env:QL_SCREEN_W -and $env:QL_SCREEN_H) {
        return @{
            X = [int]$env:QL_SCREEN_X
            Y = [int]$env:QL_SCREEN_Y
            W = [int]$env:QL_SCREEN_W
            H = [int]$env:QL_SCREEN_H
        }
    }

    # Fallback: PS's own enumeration (legacy callers that don't set QL_SCREEN_*).
    try {
        [void][System.Windows.Forms.Screen]
    } catch {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    }
    $screens = [System.Windows.Forms.Screen]::AllScreens

    if ($MonitorIndex -ge 1 -and $MonitorIndex -le $screens.Count) {
        $s = $screens[$MonitorIndex - 1]
        return @{ X = $s.WorkingArea.X; Y = $s.WorkingArea.Y; W = $s.WorkingArea.Width; H = $s.WorkingArea.Height }
    }

    # Last resort: primary
    $p = [System.Windows.Forms.Screen]::PrimaryScreen
    return @{ X = $p.WorkingArea.X; Y = $p.WorkingArea.Y; W = $p.WorkingArea.Width; H = $p.WorkingArea.Height }
}

function Move-WindowToRect {
    param(
        [IntPtr]$Hwnd,
        [int]$X, [int]$Y, [int]$W, [int]$H,
        [switch]$NoRestore
    )
    # Side-effect only — no return value. Previously returned $true which
    # leaked into the script's stdout as "True" noise lines.
    if ([long]$Hwnd -le 0) { return }
    if (-not $NoRestore) {
        [NostWin32]::ShowWindow($Hwnd, 9) | Out-Null
        Start-Sleep -Milliseconds 150
    }
    [NostWin32]::MoveWindow($Hwnd, $X, $Y, $W, $H, $true) | Out-Null
    Start-Sleep -Milliseconds 50
    [NostWin32]::SetWindowPos($Hwnd, [IntPtr]::Zero, $X, $Y, $W, $H, 0x0064) | Out-Null
    [NostWin32]::SetForegroundWindow($Hwnd) | Out-Null
}

function Get-WindowRectSafe {
    param([IntPtr]$Hwnd)
    $rect = New-Object NostWin32+RECT
    [NostWin32]::GetWindowRect($Hwnd, [ref]$rect) | Out-Null
    return $rect
}
