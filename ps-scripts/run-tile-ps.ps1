. "$PSScriptRoot\_Win32Types.ps1"
. "$PSScriptRoot\_Functions.ps1"
. "$PSScriptRoot\_Position.ps1"
# Get work area from Windows directly — no Electron coordinate translation needed.
$targetMonitorIdx = [int]$env:QL_MONITOR
$nativeWA = Get-NativeWorkArea $targetMonitorIdx
$screenWidth = $nativeWA.W
$screenHeight = $nativeWA.H
$screenX = $nativeWA.X
$screenY = $nativeWA.Y
$items = $env:QL_ITEMS | ConvertFrom-Json
$count = @($items).Count
if ($count -lt 1) { exit }
$border = 8
function Get-ColLayout($idx) {
    $colBase = [math]::Floor($screenWidth / $count)
    $colW = if ($idx -eq $count - 1) { $screenWidth - ($colBase * ($count - 1)) } else { $colBase }
    $x = $screenX + ($idx * $colBase) - $border
    $y = $screenY - $border
    $w = $colW + ($border * 2)
    $h = $screenHeight + ($border * 2)
    return @{ x=$x; y=$y; w=$w; h=$h }
}
function Tile-Hwnd($hwnd, $idx) {
    $c = Get-ColLayout $idx
    Move-WindowToRect $hwnd $c.x $c.y $c.w $c.h
}
$hwnds = @{}
$tiledSet = [System.Collections.Generic.HashSet[long]]::new()
for ($j = 0; $j -lt $count; $j++) {
    if (@($items)[$j].isBrowser -eq $true) { $hwnds[$j] = [IntPtr]0; $tiledSet.Add(0) | Out-Null }
}
$deadline = (Get-Date).AddSeconds(30)
do {
    for ($i = 0; $i -lt $count; $i++) {
        if (-not $hwnds.ContainsKey($i)) {
            $curItem = @($items)[$i]
            $h = Find-Hwnd $curItem
            if ($null -ne $h) {
                try { $hwnds[$i] = [IntPtr]([long](@($h)[-1])) } catch {}
            }
        }
        if ($hwnds.ContainsKey($i)) {
            $hwndInt = [long]$hwnds[$i]
            if ($hwndInt -gt 0 -and -not $tiledSet.Contains($hwndInt)) {
                Start-Sleep -Milliseconds 400
                Tile-Hwnd $hwnds[$i] $i
                $tiledSet.Add($hwndInt) | Out-Null
            }
        }
    }
    $allFound = $true
    for ($i = 0; $i -lt $count; $i++) { if (-not $hwnds.ContainsKey($i)) { $allFound = $false; break } }
    if ($allFound) { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
# Settle passes: verify positions, re-tile only if needed
$settleDelays = @(800, 600, 600)
foreach ($delayMs in $settleDelays) {
    Start-Sleep -Milliseconds $delayMs
    $needsRetile = $false
    for ($i = 0; $i -lt $count; $i++) {
        if ($hwnds.ContainsKey($i) -and [long]$hwnds[$i] -gt 0) {
            $rect = Get-WindowRectSafe $hwnds[$i]
            $c = Get-ColLayout $i
            if ([Math]::Abs($rect.Left - $c.x) -gt 4 -or [Math]::Abs($rect.Top - $c.y) -gt 4 -or
                [Math]::Abs(($rect.Right - $rect.Left) - $c.w) -gt 4 -or [Math]::Abs(($rect.Bottom - $rect.Top) - $c.h) -gt 4) {
                Tile-Hwnd $hwnds[$i] $i
                $needsRetile = $true
                Start-Sleep -Milliseconds 80
            }
        }
    }
    if (-not $needsRetile) { break }
}
