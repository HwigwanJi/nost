# Centralized window positioning for nost.
# PS queries monitor work areas via .NET Screen class (no DPI translation needed).

function Get-NativeWorkArea {
    param([int]$MonitorIndex = 0)

    # 2026-04 update — coordinate-system mismatch fix.
    #
    # Old behaviour: trust QL_SCREEN_* env vars from Electron unconditionally.
    # That worked for primary monitor (and for mono-DPI setups) but broke for
    # secondary monitors in cross-DPI setups, because Electron's DIP coords
    # and a DPI-unaware PS process see DIFFERENT positions for non-primary
    # screens (Windows lays out the unaware virtual canvas using physical
    # distances from primary's right edge, leaving a "gap" on secondaries).
    #
    # New behaviour: PS queries its OWN enumeration for the work area
    # (System.Windows.Forms.Screen, which lives in the same unaware coord
    # space MoveWindow uses). We use QL_MONITOR as the index and verify
    # primary flag against QL_MONITOR_PRIMARY — if PS's order differs from
    # Electron's (the original concern that motivated the old fix), fall
    # back to searching by primary flag.

    try {
        [void][System.Windows.Forms.Screen]
    } catch {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    }
    $screens = [System.Windows.Forms.Screen]::AllScreens

    # Prefer the explicit monitor index from Electron when provided.
    $useIndex = $MonitorIndex
    if ($MonitorIndex -lt 1 -and $env:QL_MONITOR) { $useIndex = [int]$env:QL_MONITOR }

    if ($useIndex -ge 1 -and $useIndex -le $screens.Count) {
        $s = $screens[$useIndex - 1]

        # Sanity check: does PS's mon#K agree with Electron's mon#K on
        # primary status? If not, PS's enumeration drifted relative to
        # Electron's — search by primary flag instead.
        if ($env:QL_MONITOR_PRIMARY) {
            $expectedPrimary = [string]$env:QL_MONITOR_PRIMARY -ieq 'True'
            if ($s.Primary -ne $expectedPrimary) {
                Write-Output "[diag] WARN: PS mon#$useIndex primary=$($s.Primary) but Electron expected primary=$expectedPrimary. Resolving by primary flag..."
                $candidates = @($screens | Where-Object { $_.Primary -eq $expectedPrimary })
                if ($candidates.Count -gt 0) {
                    $s = $candidates[0]
                    Write-Output "[diag] resolved by primary flag: $($s.DeviceName) bounds=($($s.Bounds.X),$($s.Bounds.Y),$($s.Bounds.Width)x$($s.Bounds.Height))"
                }
            }
        }

        Write-Output "[diag] picked PS-enum mon#$useIndex name=$($s.DeviceName) primary=$($s.Primary) work=($($s.WorkingArea.X),$($s.WorkingArea.Y),$($s.WorkingArea.Width)x$($s.WorkingArea.Height))"
        if ($env:QL_MONITOR_DIP_X) {
            Write-Output "[diag]   electron-dip-hint=($($env:QL_MONITOR_DIP_X),$($env:QL_MONITOR_DIP_Y),$($env:QL_MONITOR_DIP_W)x$($env:QL_MONITOR_DIP_H)) scale=$($env:QL_MONITOR_SCALE)"
        }
        return @{ X = $s.WorkingArea.X; Y = $s.WorkingArea.Y; W = $s.WorkingArea.Width; H = $s.WorkingArea.Height }
    }

    # Legacy fallback for callers that didn't pass QL_MONITOR.
    if ($env:QL_SCREEN_W -and $env:QL_SCREEN_H) {
        Write-Output "[diag] no QL_MONITOR — falling back to QL_SCREEN_* (DIP, may misplace on cross-DPI secondaries)"
        return @{
            X = [int]$env:QL_SCREEN_X
            Y = [int]$env:QL_SCREEN_Y
            W = [int]$env:QL_SCREEN_W
            H = [int]$env:QL_SCREEN_H
        }
    }

    # Last resort: primary screen
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
