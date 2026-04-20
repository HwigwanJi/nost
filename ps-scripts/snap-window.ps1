. "$PSScriptRoot\_Win32Types.ps1"
. "$PSScriptRoot\_Functions.ps1"
. "$PSScriptRoot\_Position.ps1"
$item = $env:QL_ITEM | ConvertFrom-Json
$zone = $env:QL_ZONE
$monitorIdx = if ($item.monitor) { [int]$item.monitor } else { 0 }
# Get work area from Windows directly
$nativeWA = Get-NativeWorkArea $monitorIdx
$screen = [PSCustomObject]@{ X=$nativeWA.X; Y=$nativeWA.Y; Width=$nativeWA.W; Height=$nativeWA.H }

# Per-edge borders (see main.js monitorEnvFor for rationale).
$borderL = if ($env:QL_BORDER_LEFT)   { [int]$env:QL_BORDER_LEFT }   else { 8 }
$borderR = if ($env:QL_BORDER_RIGHT)  { [int]$env:QL_BORDER_RIGHT }  else { 8 }
$borderT = if ($env:QL_BORDER_TOP)    { [int]$env:QL_BORDER_TOP }    else { 8 }
$borderB = if ($env:QL_BORDER_BOTTOM) { [int]$env:QL_BORDER_BOTTOM } else { 8 }

$hwnd = Find-Hwnd $item

if ($hwnd -and [long]$hwnd -gt 0) {
    $x = 0; $y = 0; $w = 0; $h = 0
    $halfW = [math]::Floor($screen.Width / 2)
    $halfH = [math]::Floor($screen.Height / 2)

    if ($zone -eq 'left') {
        # Left half — right side is a seam, no border there.
        $x = $screen.X - $borderL
        $y = $screen.Y - $borderT
        $w = $halfW + $borderL
        $h = $screen.Height + $borderT + $borderB
    } elseif ($zone -eq 'right') {
        # Right half — left side is a seam, no border there.
        $x = $screen.X + $halfW
        $y = $screen.Y - $borderT
        $w = ($screen.Width - $halfW) + $borderR
        $h = $screen.Height + $borderT + $borderB
    } elseif ($zone -eq 'top') {
        # Top half — bottom side is a seam, no border there.
        $x = $screen.X - $borderL
        $y = $screen.Y - $borderT
        $w = $screen.Width + $borderL + $borderR
        $h = $halfH + $borderT
    }
    Move-WindowToRect $hwnd $x $y $w $h
}
