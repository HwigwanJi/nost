. "$PSScriptRoot\_Win32Types.ps1"
. "$PSScriptRoot\_Functions.ps1"
. "$PSScriptRoot\_Position.ps1"
# Get work area from Windows directly (monitor index from env, default primary)
$monitorIdx = if ($env:QL_MONITOR) { [int]$env:QL_MONITOR } else { 0 }
$nativeWA = Get-NativeWorkArea $monitorIdx
$screen = [PSCustomObject]@{ X=$nativeWA.X; Y=$nativeWA.Y; Width=$nativeWA.W; Height=$nativeWA.H }

$items = $env:QL_ITEMS | ConvertFrom-Json
$count = $items.Count
if ($count -lt 2) { exit }

$colWidthBase = [math]::Floor($screen.Width / $count)
$usedHwndInts = [System.Collections.Generic.List[long]]::new()
$border = 8

for ($i = 0; $i -lt $count; $i++) {
    $item = $items[$i]
    $hwnd = Find-Hwnd $item

    if ($hwnd -ne $null) {
        $hwndInt = [long]$hwnd
        Write-Output "[$i] FOUND type=$($item.type) value='$($item.value)' hwnd=$hwndInt"
        if ($hwndInt -gt 0 -and -not $usedHwndInts.Contains($hwndInt)) {
            $usedHwndInts.Add($hwndInt)
            $colW = if ($i -eq $count - 1) { $screen.Width - ($colWidthBase * ($count - 1)) } else { $colWidthBase }
            $x = $screen.X + ($i * $colWidthBase) - $border
            $y = $screen.Y - $border
            $w = $colW + ($border * 2)
            $h = $screen.Height + ($border * 2)
            Write-Output "[$i] MOVE x=$x y=$y w=$w h=$h"
            Move-WindowToRect $hwnd $x $y $w $h
        } else {
            Write-Output "[$i] SKIPPED (dup hwnd=$hwndInt)"
        }
    } else {
        Write-Output "[$i] NOT_FOUND type=$($item.type) value='$($item.value)' title='$($item.title)'"
    }
}
Write-Output "SCREEN: origin=$($screen.X),$($screen.Y) size=$($screen.Width)x$($screen.Height) colBase=$colWidthBase"
