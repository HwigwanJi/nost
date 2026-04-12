. "$PSScriptRoot\_Win32Types.ps1"
. "$PSScriptRoot\_Functions.ps1"
. "$PSScriptRoot\_Position.ps1"
$item = $env:QL_ITEM | ConvertFrom-Json
$zone = $env:QL_ZONE
$monitorIdx = if ($item.monitor) { [int]$item.monitor } else { 0 }
# Get work area from Windows directly
$nativeWA = Get-NativeWorkArea $monitorIdx
$screen = [PSCustomObject]@{ X=$nativeWA.X; Y=$nativeWA.Y; Width=$nativeWA.W; Height=$nativeWA.H }
$hwnd = Find-Hwnd $item

if ($hwnd -and [long]$hwnd -gt 0) {
    $border = 8
    $x = 0; $y = 0; $w = 0; $h = 0
    if ($zone -eq 'left') {
        $x = $screen.X - $border
        $y = $screen.Y - $border
        $w = [math]::Floor($screen.Width / 2) + $border * 2
        $h = $screen.Height + $border * 2
    } elseif ($zone -eq 'right') {
        $x = $screen.X + [math]::Floor($screen.Width / 2) - $border
        $y = $screen.Y - $border
        $w = $screen.Width - [math]::Floor($screen.Width / 2) + $border * 2
        $h = $screen.Height + $border * 2
    } elseif ($zone -eq 'top') {
        $x = $screen.X - $border
        $y = $screen.Y - $border
        $w = $screen.Width + $border * 2
        $h = [math]::Floor($screen.Height / 2) + $border * 2
    }
    Move-WindowToRect $hwnd $x $y $w $h
}
