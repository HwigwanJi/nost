#
# create-store-zip.ps1
#
# Build a Chrome Web Store-ready zip for the nost Bridge extension.
# Excludes dev-only files (icon generators, source SVG) so reviewers
# only see what actually ships.
#
# Run from anywhere:
#   pwsh -File "D:\01_개인\06. launcher\chrome-extension\create-store-zip.ps1"
# Or from inside the chrome-extension folder:
#   .\create-store-zip.ps1
#
$ErrorActionPreference = 'Stop'

$ext  = $PSScriptRoot
$root = Split-Path $ext -Parent
$out  = Join-Path $root 'release'

if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }

# Read version from manifest so the zip name matches what we ship.
$manifest = Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json
$version  = $manifest.version
$zipName  = "nost-bridge-store-$version.zip"
$zipPath  = Join-Path $out $zipName

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Allow-list: only these files/folders ship to the store. Anything
# else (icon generators, SVG sources, this script itself, README,
# .git, etc.) is left out — keeps the review surface minimal.
$include = @(
    'manifest.json',
    'background.js',
    'popup.html',
    'popup.js',
    'icons',
    '_locales'
)

$tmp = Join-Path $env:TEMP "nost-bridge-stage-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    foreach ($name in $include) {
        $src = Join-Path $ext $name
        if (-not (Test-Path $src)) {
            throw "Missing required file/folder: $src"
        }
        Copy-Item -Path $src -Destination (Join-Path $tmp $name) -Recurse
    }

    # Strip the source SVG — only the rendered PNGs need to ship.
    Remove-Item -Path (Join-Path $tmp 'icons\icon.svg') -ErrorAction SilentlyContinue

    # Sanity: confirm required PNG icons exist in the staged copy.
    foreach ($s in 16, 48, 128) {
        $p = Join-Path $tmp "icons\icon$s.png"
        if (-not (Test-Path $p)) { throw "Missing icon: $p" }
    }

    # Pack. The store expects manifest.json at the zip root, not nested
    # in a folder — passing $tmp\* (not $tmp) gives us exactly that.
    Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zipPath -CompressionLevel Optimal

    $sizeKb = [math]::Round((Get-Item $zipPath).Length / 1KB, 2)
    Write-Host ""
    Write-Host "  ✓ Created: $zipPath" -ForegroundColor Green
    Write-Host "    Version: $version"
    Write-Host "    Size:    $sizeKb KB"
    Write-Host ""
    Write-Host "  Next: upload this zip at" -ForegroundColor Yellow
    Write-Host "    https://chrome.google.com/webstore/devconsole" -ForegroundColor Yellow
    Write-Host ""
} finally {
    if (Test-Path $tmp) { Remove-Item -Path $tmp -Recurse -Force }
}
