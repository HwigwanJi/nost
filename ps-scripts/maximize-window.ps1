. "$PSScriptRoot\_Win32Types.ps1"
. "$PSScriptRoot\_Functions.ps1"
. "$PSScriptRoot\_Position.ps1"
$item = $env:QL_ITEM | ConvertFrom-Json
$monitorIdx = [int]$env:QL_MONITOR
# Get work area from Windows directly — bypasses all DPI translation issues
$nativeWA = Get-NativeWorkArea $monitorIdx
$border = 8
$x = $nativeWA.X - $border
$y = $nativeWA.Y - $border
$w = $nativeWA.W + $border * 2
$h = $nativeWA.H + $border * 2
$hwnd = Find-Hwnd $item
if ($hwnd -and [long]$hwnd -gt 0) {
    Move-WindowToRect $hwnd $x $y $w $h
    Write-Output "OK"
} else {
    Write-Output "NOTFOUND"
}
