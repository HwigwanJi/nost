# ── Keep PS DPI-UNAWARE (do NOT call SetProcessDpiAwarenessContext) ───
#
# This is deliberate. Electron is always DPI-aware and reports coordinates
# in its own DIP space (primary monitor's scale acts as the virtual ruler).
# A DPI-unaware PS process sees the same virtualized DIP space, so the
# coordinates Electron passes via QL_SCREEN_* land correctly when we hand
# them to MoveWindow.
#
# If we switch PS to per-monitor-aware, PS starts using each monitor's
# native physical/DIP space. A secondary monitor that Electron calls
# "x=1536" (because primary is 1536 DIP wide at 125%) is called "x=1920"
# by a per-monitor PS (because primary is 1920 physical wide). That
# mismatch sends every window to the wrong place — typically leaving an
# empty right strip on the target monitor.
#
# See the DpiProbe block below for read-only inspection used by diagnostics.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DpiAware {
    [DllImport("user32.dll")]
    public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    public static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("shcore.dll")]
    public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);
    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
}
"@ -ErrorAction SilentlyContinue

. "$PSScriptRoot\_Win32Types.ps1"
. "$PSScriptRoot\_Functions.ps1"
. "$PSScriptRoot\_Position.ps1"

# ── Diagnostic header ─────────────────────────────────────────────────
try {
    [void][System.Windows.Forms.Screen]
} catch {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
}

try {
    $ctx = [DpiAware]::GetThreadDpiAwarenessContext()
    $awareness = [DpiAware]::GetAwarenessFromDpiAwarenessContext($ctx)
    Write-Output "[diag] ps-dpi-awareness=$awareness (0=unaware, 1=system, 2=per-monitor, 3=per-monitor-v2)"
} catch { Write-Output "[diag] ps-dpi-awareness probe failed: $($_.Exception.Message)" }

# Dump every monitor so we can compare against what Electron sees.
$allScreens = [System.Windows.Forms.Screen]::AllScreens
for ($s = 0; $s -lt $allScreens.Count; $s++) {
    $sc = $allScreens[$s]
    $b = $sc.Bounds; $w = $sc.WorkingArea
    try {
        $pt = New-Object DpiAware+POINT
        $pt.X = $b.X + 1; $pt.Y = $b.Y + 1
        $hmon = [DpiAware]::MonitorFromPoint($pt, 2)  # MONITOR_DEFAULTTONEAREST
        $dpiX = 0; $dpiY = 0
        [DpiAware]::GetDpiForMonitor($hmon, 0, [ref]$dpiX, [ref]$dpiY) | Out-Null
        $scale = [math]::Round($dpiX / 96.0, 2)
    } catch { $dpiX = 0; $scale = 0 }
    Write-Output "[diag] mon#$($s+1) primary=$($sc.Primary) bounds=($($b.X),$($b.Y),$($b.Width)x$($b.Height)) work=($($w.X),$($w.Y),$($w.Width)x$($w.Height)) dpi=$dpiX scale=$scale"
}

# Get work area from Windows directly — no Electron coordinate translation needed.
$targetMonitorIdx = [int]$env:QL_MONITOR
$nativeWA = Get-NativeWorkArea $targetMonitorIdx
$screenWidth = $nativeWA.W
$screenHeight = $nativeWA.H
$screenX = $nativeWA.X
$screenY = $nativeWA.Y
Write-Output "[diag] picked mon#$targetMonitorIdx → work=($screenX,$screenY,${screenWidth}x${screenHeight})"

$items = $env:QL_ITEMS | ConvertFrom-Json
$count = @($items).Count
if ($count -lt 1) { exit }

# Per-edge safe borders — 0 when the edge touches a different-DPI monitor
# (prevents WM_DPICHANGED cross-monitor scaling), 8 otherwise.
$borderL = if ($env:QL_BORDER_LEFT)   { [int]$env:QL_BORDER_LEFT }   else { 8 }
$borderR = if ($env:QL_BORDER_RIGHT)  { [int]$env:QL_BORDER_RIGHT }  else { 8 }
$borderT = if ($env:QL_BORDER_TOP)    { [int]$env:QL_BORDER_TOP }    else { 8 }
$borderB = if ($env:QL_BORDER_BOTTOM) { [int]$env:QL_BORDER_BOTTOM } else { 8 }
Write-Output "[diag] borders L=$borderL R=$borderR T=$borderT B=$borderB"

function Get-ColLayout($idx) {
    $colBase = [math]::Floor($screenWidth / $count)
    $colW = if ($idx -eq $count - 1) { $screenWidth - ($colBase * ($count - 1)) } else { $colBase }
    # Outer (exterior) edges honour the DPI-safe per-side border values.
    # Interior column seams are ALWAYS on the same monitor (same DPI), so
    # we pad them by 8 on each side — adjacent tiles then overlap 16 px
    # and the transparent rounded-corner regions of each window get hidden
    # behind the neighbour rather than showing through as a visible gap.
    $leftPad  = if ($idx -eq 0)          { $borderL } else { 8 }
    $rightPad = if ($idx -eq $count - 1) { $borderR } else { 8 }
    $x = $screenX + ($idx * $colBase) - $leftPad
    $y = $screenY - $borderT
    $w = $colW + $leftPad + $rightPad
    $h = $screenHeight + $borderT + $borderB
    return @{ x=$x; y=$y; w=$w; h=$h }
}
function Tile-Hwnd($hwnd, $idx) {
    $c = Get-ColLayout $idx
    Write-Output "[tile] idx=$idx target=($($c.x),$($c.y),$($c.w)x$($c.h)) hwnd=$([long]$hwnd)"
    Move-WindowToRect $hwnd $c.x $c.y $c.w $c.h

    # Read back actual rect to see if Windows honored our request.
    # Apps like Claude Desktop enforce an internal minHeight that can exceed
    # the available work area on smaller monitors, causing the bottom of the
    # window (chat input, toolbar) to spill off-screen. When that happens we
    # translate the window upward so the bottom edge lands on the work-area
    # floor — better than an invisible chat bar.
    Start-Sleep -Milliseconds 80
    $r = Get-WindowRectSafe $hwnd
    $actualW = $r.Right - $r.Left
    $actualH = $r.Bottom - $r.Top
    $dw = $actualW - $c.w
    $dh = $actualH - $c.h
    Write-Output "[tile] idx=$idx actual=($($r.Left),$($r.Top),${actualW}x${actualH}) Δ=($dw,$dh)"

    # Smart overflow handling.
    #
    # Three cases:
    #   1) Window fits — nothing to do.
    #   2) Window slightly oversized — pull y up by the overflow, top stays
    #      mostly visible. Title bar may clip a few px which is acceptable.
    #   3) Window FUNDAMENTALLY taller than the work area (Claude on a
    #      1080p monitor with minHeight ~1300) — pulling up just trades
    #      bottom-cut for top-cut. Worse: title bar and new-chat button
    #      vanish. Best UX is to keep the window pinned at the work-area
    #      top so the chrome stays visible; accept the bottom-cut as
    #      unavoidable on this monitor.
    $workBottom   = $screenY + $screenHeight
    $actualBottom = $r.Top + $actualH

    if ($dh -gt 4 -and $actualBottom -gt $workBottom) {
        $overflow = $actualBottom - $workBottom

        if ($actualH -gt ($screenHeight + 16)) {
            # Case 3: window is taller than work area+border (16=2*border).
            # Snap to work-area top with the standard -8 border so chrome
            # remains visible. Bottom will overflow but that's unavoidable.
            $cleanY = $screenY - 8
            Write-Output "[tile] idx=$idx window taller than work area (actualH=$actualH > ${screenHeight}+16). Pinning top instead of pulling up. Bottom will clip ${overflow}px."
            [NostWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, $r.Left, $cleanY, $actualW, $actualH, 0x0064) | Out-Null
        } else {
            # Case 2: modest oversize — pull up by overflow but cap so the
            # top doesn't go more than 16px above the work area.
            $minY = $screenY - 16
            $newY = [Math]::Max($minY, $r.Top - $overflow)
            $appliedShift = $r.Top - $newY
            Write-Output "[tile] idx=$idx overflow=${overflow}px → pulling y up by $appliedShift to $newY"
            [NostWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, $r.Left, $newY, $actualW, $actualH, 0x0064) | Out-Null
        }
    }

    try {
        $mon = [DpiAware]::MonitorFromWindow($hwnd, 2)
        $dpiX = 0; $dpiY = 0
        [DpiAware]::GetDpiForMonitor($mon, 0, [ref]$dpiX, [ref]$dpiY) | Out-Null
        Write-Output "[tile] idx=$idx landed-on-monitor-dpi=$dpiX (scale=$([math]::Round($dpiX / 96.0, 2)))"
    } catch {}
}
$hwnds = @{}
$tiledSet = [System.Collections.Generic.HashSet[long]]::new()
for ($j = 0; $j -lt $count; $j++) {
    if (@($items)[$j].isBrowser -eq $true) { $hwnds[$j] = [IntPtr]0; $tiledSet.Add(0) | Out-Null }
}
# 45 s deadline covers slow-to-open apps: PowerPoint / Word show a splash
# window whose MainWindowHandle is 0 for 3-6 s, and cold-start Creative Cloud
# launches can take 10-20 s before their main window is ready for
# positioning. 30 s wasn't enough in practice — bumped to 45 s.
$deadline = (Get-Date).AddSeconds(45)
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
                # 800ms gap between tiles — heavy apps like PowerPoint /
                # Excel are still processing layout from the previous tile
                # (WM_DPICHANGED, ribbon reflow, splash → main transition)
                # at 400ms, and the next MoveWindow call gets ignored. 800ms
                # is the empirical floor where PowerPoint reliably accepts a
                # second placement without dropping it.
                Start-Sleep -Milliseconds 800
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

# Settle passes: verify positions, re-tile stragglers.
#
# More passes (5) with longer gaps (1200, 1000, 1000, 800, 800) because
# heavy Office apps can take 2-4s to fully commit a window rect after
# receiving MoveWindow. Without this, a tile that "landed then bounced
# back" because PowerPoint wasn't ready gets stuck half-placed.
$settleDelays = @(1200, 1000, 1000, 800, 800)
foreach ($delayMs in $settleDelays) {
    Start-Sleep -Milliseconds $delayMs
    $needsRetile = $false
    for ($i = 0; $i -lt $count; $i++) {
        if ($hwnds.ContainsKey($i) -and [long]$hwnds[$i] -gt 0) {
            $rect = Get-WindowRectSafe $hwnds[$i]
            $c = Get-ColLayout $i
            $dx = [Math]::Abs($rect.Left - $c.x)
            $dy = [Math]::Abs($rect.Top  - $c.y)
            $dw = [Math]::Abs(($rect.Right - $rect.Left) - $c.w)
            $dh = [Math]::Abs(($rect.Bottom - $rect.Top) - $c.h)
            if ($dx -gt 4 -or $dy -gt 4 -or $dw -gt 4 -or $dh -gt 4) {
                Write-Output "[settle] idx=$i drift=($dx,$dy,$dw,$dh) re-tiling after ${delayMs}ms"
                Tile-Hwnd $hwnds[$i] $i
                $needsRetile = $true
                Start-Sleep -Milliseconds 120
            }
        }
    }
    if (-not $needsRetile) { break }
}
