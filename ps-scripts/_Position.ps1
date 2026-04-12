# Centralized window positioning for nost.
# PS queries monitor work areas via .NET Screen class (no DPI translation needed).

function Get-NativeWorkArea {
    param([int]$MonitorIndex = 0)

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

    # Fallback: env vars from Electron
    if ($env:QL_SCREEN_W) {
        return @{ X = [int]$env:QL_SCREEN_X; Y = [int]$env:QL_SCREEN_Y; W = [int]$env:QL_SCREEN_W; H = [int]$env:QL_SCREEN_H }
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
    if ([long]$Hwnd -le 0) { return $false }
    if (-not $NoRestore) {
        [NostWin32]::ShowWindow($Hwnd, 9) | Out-Null
        Start-Sleep -Milliseconds 150
    }
    [NostWin32]::MoveWindow($Hwnd, $X, $Y, $W, $H, $true) | Out-Null
    Start-Sleep -Milliseconds 50
    [NostWin32]::SetWindowPos($Hwnd, [IntPtr]::Zero, $X, $Y, $W, $H, 0x0064) | Out-Null
    [NostWin32]::SetForegroundWindow($Hwnd) | Out-Null
    return $true
}

function Get-WindowRectSafe {
    param([IntPtr]$Hwnd)
    $rect = New-Object NostWin32+RECT
    [NostWin32]::GetWindowRect($Hwnd, [ref]$rect) | Out-Null
    return $rect
}
