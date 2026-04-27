#
# generate-store-graphics.ps1
#
# Generate the Chrome Web Store promotional tile (440x280) and feature
# screenshots (1280x800) for the nost Bridge listing. Two locales:
#   default/  — English text (used as fallback for all locales)
#   ko/       — Korean text (overrides default for Korean users)
#
# These are designed graphics, not literal captures of the running app
# — many top extensions ship designed feature cards instead of raw
# screenshots because they read better at thumbnail size in the gallery.
# Feel free to swap any of them with a real screenshot later; the
# Chrome Web Store dashboard accepts replacement uploads any time.
#
# Output: chrome-extension/store-assets/{promo,screenshots}/{default,ko}/
#
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ext  = $PSScriptRoot
$root = Split-Path $ext -Parent
$logo = Join-Path $root 'assets\icon-512.png'
$out  = Join-Path $ext  'store-assets'

# ── Brand palette (matches the desktop app accent + dark theme) ────
$bgTop      = [System.Drawing.Color]::FromArgb(255, 13, 13, 32)    # #0d0d20
$bgBottom   = [System.Drawing.Color]::FromArgb(255, 22, 16, 58)    # #16103a
$accent     = [System.Drawing.Color]::FromArgb(255, 99, 102, 241)  # #6366f1
$accentSoft = [System.Drawing.Color]::FromArgb(255, 165, 180, 252) # #a5b4fc
$textHi     = [System.Drawing.Color]::FromArgb(255, 240, 240, 255)
$textLo     = [System.Drawing.Color]::FromArgb(255, 160, 168, 200)
$cardBg     = [System.Drawing.Color]::FromArgb(255, 30, 30, 60)
$cardBorder = [System.Drawing.Color]::FromArgb(255, 60, 60, 100)

# ── Helpers ─────────────────────────────────────────────────────────
function New-DarkBackground {
    param([int]$W, [int]$H)
    $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    $rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $bgTop, $bgBottom, ([System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # Subtle accent glow in upper-right
    $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $glowPath.AddEllipse([single]($W * 0.7), [single](-$H * 0.3), [single]($W * 0.6), [single]($H * 0.6))
    $glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $glowPath
    $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(80, 99, 102, 241)
    $glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 99, 102, 241))
    $g.FillPath($glowBrush, $glowPath)
    $glowBrush.Dispose()
    $glowPath.Dispose()

    return @{ Bitmap = $bmp; Graphics = $g }
}

function Save-Png {
    param($Ctx, [string]$Path)
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $Ctx.Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $Ctx.Graphics.Dispose()
    $Ctx.Bitmap.Dispose()
}

function Draw-StringCentered {
    param($G, [string]$Text, $Font, $Color, [single]$CenterX, [single]$Y)
    $brush = New-Object System.Drawing.SolidBrush $Color
    $size = $G.MeasureString($Text, $Font)
    $G.DrawString($Text, $Font, $brush, [single]($CenterX - $size.Width / 2), $Y)
    $brush.Dispose()
}

function Draw-RoundedRect {
    param($G, $Brush, [single]$X, [single]$Y, [single]$W, [single]$H, [single]$R)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($X,             $Y,             $R * 2, $R * 2, 180, 90)
    $path.AddArc($X + $W - $R*2, $Y,             $R * 2, $R * 2, 270, 90)
    $path.AddArc($X + $W - $R*2, $Y + $H - $R*2, $R * 2, $R * 2,   0, 90)
    $path.AddArc($X,             $Y + $H - $R*2, $R * 2, $R * 2,  90, 90)
    $path.CloseFigure()
    $G.FillPath($Brush, $path)
    $path.Dispose()
}

function Stroke-RoundedRect {
    param($G, $Pen, [single]$X, [single]$Y, [single]$W, [single]$H, [single]$R)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($X,             $Y,             $R * 2, $R * 2, 180, 90)
    $path.AddArc($X + $W - $R*2, $Y,             $R * 2, $R * 2, 270, 90)
    $path.AddArc($X + $W - $R*2, $Y + $H - $R*2, $R * 2, $R * 2,   0, 90)
    $path.AddArc($X,             $Y + $H - $R*2, $R * 2, $R * 2,  90, 90)
    $path.CloseFigure()
    $G.DrawPath($Pen, $path)
    $path.Dispose()
}

# ── Promo tile (440x280) ────────────────────────────────────────────
function New-PromoTile {
    param([string]$Title, [string]$Subtitle, [string]$Tagline, [string]$OutPath)
    $W = 440; $H = 280
    $ctx = New-DarkBackground -W $W -H $H
    $g = $ctx.Graphics

    # Logo at left (160x160)
    $logoImg = [System.Drawing.Image]::FromFile($logo)
    $g.DrawImage($logoImg, 30, ($H - 160) / 2, 160, 160)
    $logoImg.Dispose()

    # Right side text
    $titleFont    = New-Object System.Drawing.Font 'Segoe UI', 22, ([System.Drawing.FontStyle]::Bold)
    $subtitleFont = New-Object System.Drawing.Font 'Malgun Gothic', 11, ([System.Drawing.FontStyle]::Regular)
    $taglineFont  = New-Object System.Drawing.Font 'Malgun Gothic', 10, ([System.Drawing.FontStyle]::Regular)

    $brushTitle    = New-Object System.Drawing.SolidBrush $textHi
    $brushSubtitle = New-Object System.Drawing.SolidBrush $accentSoft
    $brushTagline  = New-Object System.Drawing.SolidBrush $textLo

    $textX = 215.0
    $g.DrawString($Title,    $titleFont,    $brushTitle,    $textX, 95)
    $g.DrawString($Subtitle, $subtitleFont, $brushSubtitle, $textX, 138)
    $g.DrawString($Tagline,  $taglineFont,  $brushTagline,  $textX, 165)

    # Local-only badge at bottom-right
    $badgeText = '127.0.0.1 only'
    $badgeFont = New-Object System.Drawing.Font 'Consolas', 9, ([System.Drawing.FontStyle]::Bold)
    $badgeSize = $g.MeasureString($badgeText, $badgeFont)
    $bw = $badgeSize.Width + 16
    $bh = 22
    $bx = $W - $bw - 18
    $by = $H - $bh - 18
    $badgeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 99, 102, 241))
    Draw-RoundedRect $g $badgeBrush $bx $by $bw $bh 11
    $badgePen = New-Object System.Drawing.Pen $accent, 1
    Stroke-RoundedRect $g $badgePen $bx $by $bw $bh 11
    $brushBadge = New-Object System.Drawing.SolidBrush $accentSoft
    $g.DrawString($badgeText, $badgeFont, $brushBadge, $bx + 8, $by + 4)

    foreach ($d in @($titleFont, $subtitleFont, $taglineFont, $badgeFont, $brushTitle, $brushSubtitle, $brushTagline, $brushBadge, $badgeBrush, $badgePen)) { $d.Dispose() }

    Save-Png -Ctx $ctx -Path $OutPath
    Write-Host "  ✓ $OutPath" -ForegroundColor Green
}

# ── Feature screenshot (1280x800) ───────────────────────────────────
function New-FeatureScreenshot {
    param(
        [string]$Headline, [string]$Subheadline, [string]$Caption,
        [string]$BadgeText, [string]$IconName, [string]$OutPath
    )
    $W = 1280; $H = 800
    $ctx = New-DarkBackground -W $W -H $H
    $g = $ctx.Graphics

    # Logo top-left
    $logoImg = [System.Drawing.Image]::FromFile($logo)
    $g.DrawImage($logoImg, 60, 50, 64, 64)
    $logoImg.Dispose()

    $brandFont = New-Object System.Drawing.Font 'Segoe UI', 20, ([System.Drawing.FontStyle]::Bold)
    $brandBrush = New-Object System.Drawing.SolidBrush $textHi
    $g.DrawString('nost Bridge', $brandFont, $brandBrush, 138, 70)
    $brandFont.Dispose(); $brandBrush.Dispose()

    # Step badge top-right (e.g. "1/5")
    if ($BadgeText) {
        $badgeFont = New-Object System.Drawing.Font 'Segoe UI', 12, ([System.Drawing.FontStyle]::Bold)
        $sz = $g.MeasureString($BadgeText, $badgeFont)
        $bw = $sz.Width + 28
        $bh = 36
        $bx = $W - $bw - 60
        $by = 64
        $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(50, 99, 102, 241))
        Draw-RoundedRect $g $bgBrush $bx $by $bw $bh 18
        $bgBrush.Dispose()
        $bp = New-Object System.Drawing.Pen $accent, 1.5
        Stroke-RoundedRect $g $bp $bx $by $bw $bh 18
        $bp.Dispose()
        $btb = New-Object System.Drawing.SolidBrush $accentSoft
        $g.DrawString($BadgeText, $badgeFont, $btb, $bx + 14, $by + 8)
        $badgeFont.Dispose(); $btb.Dispose()
    }

    # Headline (big)
    $headlineFont = New-Object System.Drawing.Font 'Malgun Gothic', 56, ([System.Drawing.FontStyle]::Bold)
    $headlineBrush = New-Object System.Drawing.SolidBrush $textHi
    $sz = $g.MeasureString($Headline, $headlineFont)
    $g.DrawString($Headline, $headlineFont, $headlineBrush, ($W - $sz.Width) / 2, 220)
    $headlineFont.Dispose(); $headlineBrush.Dispose()

    # Subheadline
    $subFont = New-Object System.Drawing.Font 'Malgun Gothic', 24, ([System.Drawing.FontStyle]::Regular)
    $subBrush = New-Object System.Drawing.SolidBrush $accentSoft
    $sz2 = $g.MeasureString($Subheadline, $subFont)
    $g.DrawString($Subheadline, $subFont, $subBrush, ($W - $sz2.Width) / 2, 320)
    $subFont.Dispose(); $subBrush.Dispose()

    # Mock UI card in middle-bottom (illustrative)
    $cardW = 720; $cardH = 240
    $cardX = ($W - $cardW) / 2
    $cardY = 430
    $cardBgBrush = New-Object System.Drawing.SolidBrush $cardBg
    Draw-RoundedRect $g $cardBgBrush $cardX $cardY $cardW $cardH 16
    $cardBgBrush.Dispose()
    $cardBorderPen = New-Object System.Drawing.Pen $cardBorder, 1
    Stroke-RoundedRect $g $cardBorderPen $cardX $cardY $cardW $cardH 16
    $cardBorderPen.Dispose()

    # Three illustrative tab pills inside the card
    $tabY = $cardY + 36
    $tabH = 50
    $tabW = ($cardW - 80) / 3 - 14
    for ($i = 0; $i -lt 3; $i++) {
        $tx = $cardX + 40 + $i * ($tabW + 20)
        $tBg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 45, 45, 80))
        Draw-RoundedRect $g $tBg $tx $tabY $tabW $tabH 10
        $tBg.Dispose()
        # accent dot
        $accentDot = New-Object System.Drawing.SolidBrush $accent
        $g.FillEllipse($accentDot, $tx + 14, $tabY + 18, 14, 14)
        $accentDot.Dispose()
        # label line
        $lineBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 100, 100, 140))
        $g.FillRectangle($lineBrush, $tx + 38, $tabY + 22, $tabW - 50, 6)
        $lineBrush.Dispose()
    }

    # Caption row below card
    $captionFont = New-Object System.Drawing.Font 'Malgun Gothic', 18, ([System.Drawing.FontStyle]::Regular)
    $captionBrush = New-Object System.Drawing.SolidBrush $textLo
    $sz3 = $g.MeasureString($Caption, $captionFont)
    $g.DrawString($Caption, $captionFont, $captionBrush, ($W - $sz3.Width) / 2, $cardY + $cardH + 30)
    $captionFont.Dispose(); $captionBrush.Dispose()

    # Bottom 127.0.0.1 reassurance bar
    $reassureFont = New-Object System.Drawing.Font 'Consolas', 14, ([System.Drawing.FontStyle]::Bold)
    $reassureText = '⚡  127.0.0.1 loopback  ·  no external network  ·  no analytics'
    $reassureBrush = New-Object System.Drawing.SolidBrush $accent
    $sz4 = $g.MeasureString($reassureText, $reassureFont)
    $g.DrawString($reassureText, $reassureFont, $reassureBrush, ($W - $sz4.Width) / 2, $H - 60)
    $reassureFont.Dispose(); $reassureBrush.Dispose()

    Save-Png -Ctx $ctx -Path $OutPath
    Write-Host "  ✓ $OutPath" -ForegroundColor Green
}

# ── Generate ─────────────────────────────────────────────────────────
Write-Host "Generating store graphics for nost Bridge..." -ForegroundColor Cyan
Write-Host ""

# Promo tiles
Write-Host "[1/3] Promo tiles (440x280)" -ForegroundColor Yellow
New-PromoTile `
    -Title    'nost Bridge' `
    -Subtitle 'Tabs ↔ Desktop Launcher' `
    -Tagline  'Local-only · No external network' `
    -OutPath  (Join-Path $out 'promo\default\promo-tile-440x280.png')

New-PromoTile `
    -Title    'nost Bridge' `
    -Subtitle '브라우저 탭 ↔ 데스크톱 런처' `
    -Tagline  '로컬 전용 · 외부 전송 없음' `
    -OutPath  (Join-Path $out 'promo\ko\promo-tile-440x280.png')

# Feature screenshots — 5 each
Write-Host ""
Write-Host "[2/3] Default (English) screenshots (1280x800)" -ForegroundColor Yellow

$enFeatures = @(
    @{ H='Bridge browser tabs to nost.';     S='Search, focus, and tile from one launcher.';      C='Click a tab in nost — Chrome jumps to it instantly.';            B='1/5'; I='swap_horiz' },
    @{ H='Tile two tabs side-by-side.';      S='Run a node group and they auto-arrange.';         C='Side-by-side, top-bottom, or 3-up — preserved per workspace.'; B='2/5'; I='view_column' },
    @{ H='One launcher for everything.';     S='Apps, folders, URLs, and now browser tabs.';      C='Type "/" to search. Click to launch. Hold to tile.';           B='3/5'; I='apps' },
    @{ H='Local loopback only.';             S='No clouds. No analytics. No telemetry.';          C='All traffic stays on 127.0.0.1:14502 — your machine.';         B='4/5'; I='lock' },
    @{ H='Install in seconds.';              S='One click in the Chrome Web Store.';              C='Auto-updates with Chrome — no manual reinstall.';              B='5/5'; I='download' }
)
foreach ($i in 0..4) {
    $f = $enFeatures[$i]
    $n = $i + 1
    New-FeatureScreenshot -Headline $f.H -Subheadline $f.S -Caption $f.C -BadgeText $f.B -IconName $f.I `
        -OutPath (Join-Path $out "screenshots\default\screenshot-$n-1280x800.png")
}

Write-Host ""
Write-Host "[3/3] Korean (한국어) screenshots (1280x800)" -ForegroundColor Yellow

$koFeatures = @(
    @{ H='브라우저 탭을 데스크톱으로.';     S='하나의 런처에서 검색·포커스·분할.';        C='nost에서 탭 클릭 한 번 — Chrome이 즉시 해당 탭으로 점프.';                B='1/5' },
    @{ H='두 탭을 좌우로 자동 배치.';       S='노드 그룹 실행이면 자동 분할.';             C='좌우·상하·3분할 — 작업 공간별로 기억.';                                  B='2/5' },
    @{ H='하나의 런처로 전부.';             S='앱·폴더·URL, 이제 브라우저 탭까지.';       C='" / " 로 검색. 클릭으로 실행. 꾹 눌러 타일.';                              B='3/5' },
    @{ H='100% 로컬 루프백.';              S='클라우드·분석 도구·외부 전송 일체 없음.';   C='모든 통신은 127.0.0.1:14502 — 사용자 본인 컴퓨터에서만 발생.';            B='4/5' },
    @{ H='1-클릭 설치.';                   S='Chrome 웹 스토어에서 한 번에.';            C='Chrome 자동 업데이트 — 재설치 불필요.';                                    B='5/5' }
)
foreach ($i in 0..4) {
    $f = $koFeatures[$i]
    $n = $i + 1
    New-FeatureScreenshot -Headline $f.H -Subheadline $f.S -Caption $f.C -BadgeText $f.B -IconName '' `
        -OutPath (Join-Path $out "screenshots\ko\screenshot-$n-1280x800.png")
}

Write-Host ""
Write-Host "All graphics generated under:" -ForegroundColor Cyan
Write-Host "  $out\promo\{default,ko}\promo-tile-440x280.png"
Write-Host "  $out\screenshots\{default,ko}\screenshot-{1..5}-1280x800.png"
Write-Host ""
Write-Host "Upload mapping in the Chrome Web Store dashboard:"
Write-Host "  Default language     ← promo\default + screenshots\default\*"
Write-Host "  Korean localization  ← promo\ko      + screenshots\ko\*"
Write-Host ""
