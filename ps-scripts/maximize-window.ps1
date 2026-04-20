. "$PSScriptRoot\_Win32Types.ps1"
. "$PSScriptRoot\_Functions.ps1"
. "$PSScriptRoot\_Position.ps1"
$item = $env:QL_ITEM | ConvertFrom-Json
$monitorIdx = [int]$env:QL_MONITOR
# Get-NativeWorkArea prefers QL_SCREEN_* envs (set by main.js monitorEnvFor),
# which come from Electron — the single source of truth for monitor order.
$nativeWA = Get-NativeWorkArea $monitorIdx

# Per-edge borders: 0 on edges that touch a different-DPI neighbour so the
# window doesn't overshoot into that neighbour and trigger WM_DPICHANGED.
$borderL = if ($env:QL_BORDER_LEFT)   { [int]$env:QL_BORDER_LEFT }   else { 8 }
$borderR = if ($env:QL_BORDER_RIGHT)  { [int]$env:QL_BORDER_RIGHT }  else { 8 }
$borderT = if ($env:QL_BORDER_TOP)    { [int]$env:QL_BORDER_TOP }    else { 8 }
$borderB = if ($env:QL_BORDER_BOTTOM) { [int]$env:QL_BORDER_BOTTOM } else { 8 }
$border = 8   # legacy alias used by overflow math below
$x = $nativeWA.X - $borderL
$y = $nativeWA.Y - $borderT
$w = $nativeWA.W + $borderL + $borderR
$h = $nativeWA.H + $borderT + $borderB
$hwnd = Find-Hwnd $item
if ($hwnd -and [long]$hwnd -gt 0) {
    Move-WindowToRect $hwnd $x $y $w $h

    # Smart overflow handling — same policy as run-tile-ps.ps1:
    #  - Modest overshoot: pull up by overflow, capped so top stays near work area
    #  - Window fundamentally taller than work area: pin top so chrome
    #    (title bar, controls) stays visible; accept unavoidable bottom-clip
    Start-Sleep -Milliseconds 80
    $r = New-Object NostWin32+RECT
    [NostWin32]::GetWindowRect($hwnd, [ref]$r) | Out-Null
    $actualH = $r.Bottom - $r.Top
    $actualW = $r.Right - $r.Left
    $workH = $nativeWA.H
    $workBottom = $nativeWA.Y + $nativeWA.H
    $actualBottom = $r.Top + $actualH

    if ($actualH -gt ($h + 4) -and $actualBottom -gt $workBottom) {
        $overflow = $actualBottom - $workBottom
        if ($actualH -gt ($workH + 16)) {
            $cleanY = $nativeWA.Y - $border
            [NostWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, $r.Left, $cleanY, $actualW, $actualH, 0x0064) | Out-Null
        } else {
            $minY = $nativeWA.Y - 16
            $newY = [Math]::Max($minY, $r.Top - $overflow)
            [NostWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, $r.Left, $newY, $actualW, $actualH, 0x0064) | Out-Null
        }
    }
    Write-Output "OK"
} else {
    Write-Output "NOTFOUND"
}
