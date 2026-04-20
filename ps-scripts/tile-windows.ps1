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

# Per-edge safe borders
$borderL = if ($env:QL_BORDER_LEFT)   { [int]$env:QL_BORDER_LEFT }   else { 8 }
$borderR = if ($env:QL_BORDER_RIGHT)  { [int]$env:QL_BORDER_RIGHT }  else { 8 }
$borderT = if ($env:QL_BORDER_TOP)    { [int]$env:QL_BORDER_TOP }    else { 8 }
$borderB = if ($env:QL_BORDER_BOTTOM) { [int]$env:QL_BORDER_BOTTOM } else { 8 }

for ($i = 0; $i -lt $count; $i++) {
    $item = $items[$i]
    $hwnd = Find-Hwnd $item

    if ($hwnd -ne $null) {
        $hwndInt = [long]$hwnd
        Write-Output "[$i] FOUND type=$($item.type) value='$($item.value)' hwnd=$hwndInt"
        if ($hwndInt -gt 0 -and -not $usedHwndInts.Contains($hwndInt)) {
            $usedHwndInts.Add($hwndInt)
            $colW = if ($i -eq $count - 1) { $screen.Width - ($colWidthBase * ($count - 1)) } else { $colWidthBase }
            # Exterior edges honour DPI-safe borders; interior seams always
            # overlap by 16 px (8 each side) so rounded-corner gaps hide.
            $leftPad  = if ($i -eq 0)          { $borderL } else { 8 }
            $rightPad = if ($i -eq $count - 1) { $borderR } else { 8 }
            $x = $screen.X + ($i * $colWidthBase) - $leftPad
            $y = $screen.Y - $borderT
            $w = $colW + $leftPad + $rightPad
            $h = $screen.Height + $borderT + $borderB
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
