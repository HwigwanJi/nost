#
# generate-store-icon.ps1
#
# Render the Chrome Web Store *listing* icon — a 128x128 PNG with the
# nost logo at 96x96 and 16px of transparent padding all around. Per
# Google's guidance the toolbar/installed icon (icons/icon128.png) is
# allowed to bleed to the edges, but the *store listing* image looks
# better with breathing room because it sits on a busy gallery.
#
# Source: assets/icon-512.png (the highest-quality master)
# Output: chrome-extension/store-assets/store-icon-128.png
#
# This file is NOT bundled in the extension zip — the listing icon is
# uploaded separately on the Chrome Web Store dashboard. The packaging
# script (create-store-zip.ps1) only ships icons/* by allow-list.
#
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ext  = $PSScriptRoot
$root = Split-Path $ext -Parent
$src  = Join-Path $root 'assets\icon-512.png'
$out  = Join-Path $ext  'store-assets'
$dst  = Join-Path $out  'store-icon-128.png'

if (-not (Test-Path $src)) { throw "Master icon not found: $src" }
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }

$canvas  = 128
$content = 96
$padding = ($canvas - $content) / 2  # 16

$srcImg = [System.Drawing.Image]::FromFile($src)
$bmp    = $null
$g      = $null
try {
    $bmp = New-Object System.Drawing.Bitmap $canvas, $canvas, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($srcImg, [int]$padding, [int]$padding, [int]$content, [int]$content)
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    if ($g) { $g.Dispose() }
    if ($bmp) { $bmp.Dispose() }
    $srcImg.Dispose()
}

$sizeKb = [math]::Round((Get-Item $dst).Length / 1KB, 2)
Write-Host ""
Write-Host "  ✓ Created: $dst" -ForegroundColor Green
Write-Host "    Canvas:  ${canvas}x${canvas} (transparent padding)"
Write-Host "    Content: ${content}x${content} (logo)"
Write-Host "    Padding: ${padding}px each side"
Write-Host "    Size:    $sizeKb KB"
Write-Host ""
Write-Host "  Upload at:" -ForegroundColor Yellow
Write-Host "    Dashboard > Item > Store Listing > Store Icon" -ForegroundColor Yellow
Write-Host ""
