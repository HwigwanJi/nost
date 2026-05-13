#
# create-whale-zip.ps1
#
# Build a Whale Store-friendly zip. Whale's upload validator has a
# known habit of returning a 500 when name/description are stored as
# __MSG_*__ placeholders pointing into _locales/, even though the
# manifest spec officially supports it. Workaround: ship a zip with
# the Korean strings inlined into manifest.json (so the upload
# validator sees a literal name immediately) while keeping _locales/
# around for the actual runtime — Chrome and Whale both read the
# inlined name when the placeholder is absent, and read _locales when
# the placeholder is present, so this version is fully compatible.
#
# Output: release/nost-bridge-whale-{version}.zip
# Source manifest: chrome-extension/manifest.json (untouched)
# Inline override: this script substitutes the __MSG_*__ tokens at
# pack time with the Korean strings from _locales/ko/messages.json.
#
$ErrorActionPreference = 'Stop'

$ext  = $PSScriptRoot
$root = Split-Path $ext -Parent
$out  = Join-Path $root 'release'

if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }

# Read source manifest + Korean messages
$manifestSrc = Get-Content (Join-Path $ext 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$msgsKo      = Get-Content (Join-Path $ext '_locales\ko\messages.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# Inline the placeholders. Keep every other field (homepage_url,
# permissions, host_permissions, background, action, icons, etc.)
# byte-identical — this is purely a name/description swap.
$manifestSrc.name        = $msgsKo.extName.message
$manifestSrc.description = $msgsKo.extDescription.message
$manifestSrc.action.default_title = $msgsKo.actionTitle.message
# default_locale field is no longer meaningful with literal name, but
# leave it for runtime _locales lookup of any future MSG calls.

$version = $manifestSrc.version
$zipName = "nost-bridge-whale-$version.zip"
$zipPath = Join-Path $out $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Stage all the same files create-store-zip.ps1 includes, but with
# the inlined manifest swapped in.
$include = @(
    'background.js',
    'popup.html',
    'popup.js',
    'icons',
    '_locales'
)

$tmp = Join-Path $env:TEMP "nost-bridge-whale-stage-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    foreach ($name in $include) {
        $src = Join-Path $ext $name
        if (-not (Test-Path $src)) { throw "Missing required: $src" }
        Copy-Item -Path $src -Destination (Join-Path $tmp $name) -Recurse
    }
    Remove-Item -Path (Join-Path $tmp 'icons\icon.svg') -ErrorAction SilentlyContinue

    # Write the inlined manifest. ConvertTo-Json escapes Korean by
    # default (\uXXXX), which the store accepts but is ugly; force
    # UTF-8 readable output so reviewers reading the zip see Korean.
    $manifestJson = $manifestSrc | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText(
        (Join-Path $tmp 'manifest.json'),
        $manifestJson,
        (New-Object System.Text.UTF8Encoding $false)  # no BOM — manifest.json must be plain UTF-8
    )

    Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zipPath -CompressionLevel Optimal

    $sizeKb = [math]::Round((Get-Item $zipPath).Length / 1KB, 2)
    Write-Host ""
    Write-Host "  Created: $zipPath" -ForegroundColor Green
    Write-Host "    Version: $version  (name/description inlined for Whale)"
    Write-Host "    Size:    $sizeKb KB"
    Write-Host ""
    Write-Host "  Inlined name:        $($manifestSrc.name)"
    Write-Host "  Inlined description: $($manifestSrc.description)"
    Write-Host ""
    Write-Host "  Upload at: https://store.whale.naver.com" -ForegroundColor Yellow
    Write-Host ""
} finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
}
