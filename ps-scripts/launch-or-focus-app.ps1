. "$PSScriptRoot\_Win32Types.ps1"

# ── Inputs ────────────────────────────────────────────────────────────
$target  = $env:QL_PATH
$lnkArgs = ''
$lnkCwd  = ''

# ── Helper: rebase stale versioned browser exe paths ──────────────────
# Chromium browsers (Chrome / Edge / Whale) put their version in the
# install path: `...\Application\134.0.6998.166\chrome.exe`. When the
# browser auto-updates, the OLD version folder is deleted — so any
# .lnk or saved exe path captured before the update goes stale and
# Test-Path fails. We detect that pattern and rebase to the highest-
# numbered sibling under the same `Application\` parent.
#
# This fixes the most common failure mode for PWA shortcuts that
# point through a versioned browser exe: the user complains "after
# I close and reopen nost, the Claude card stops working" because
# the saved Whale-PWA shortcut has a versioned target that's gone.
function Rebase-VersionedBrowserPath([string]$path) {
    if (-not $path) { return $path }
    if ($path -match '^(.+\\Application)\\([\d.]+)\\([^\\]+\.exe)$') {
        $appRoot = $Matches[1]
        $exeName = $Matches[3]
        if (Test-Path -LiteralPath $appRoot) {
            try {
                $latest = Get-ChildItem -LiteralPath $appRoot -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -match '^[\d.]+$' } |
                    Sort-Object { [version]$_.Name } -Descending |
                    Select-Object -First 1
                if ($latest) {
                    $candidate = Join-Path $latest.FullName $exeName
                    if (Test-Path -LiteralPath $candidate) {
                        return $candidate
                    }
                }
            } catch {
                # Malformed version dirs — ignore and fall through to original path.
            }
        }
    }
    return $path
}

# ── Sanity check: the stored value must be a rooted absolute path ────
# nost historically stored drag-dropped files as "Name.ext" (no directory)
# on Electron 32+ because File.path became undefined. Such items can never
# be launched — surface a clear "re-register" hint instead of a cryptic
# Start-Process error.
if (-not [System.IO.Path]::IsPathRooted($target)) {
    Write-Output "ERROR: 경로가 파일명만 저장되어 있습니다 ($target). 카드를 삭제하고 다시 등록하세요."
    exit
}
# Stale-path recovery (run BEFORE early existence bail so a saved
# exe path that lost its version folder still gets a chance):
#   - Versioned browser exe (Chrome / Edge / Whale) → rebase to
#     the highest-numbered sibling under `\Application\`.
#   - WindowsApps / Store MSIX paths → handled below in section (A)
#     via Get-AppxPackage by package name; we just SKIP the bail
#     for those so the fallback can run.
if (-not (Test-Path -LiteralPath $target)) {
    $rebased = Rebase-VersionedBrowserPath $target
    if ($rebased -ne $target -and (Test-Path -LiteralPath $rebased)) {
        $target = $rebased
    } elseif ($target -notmatch '\\WindowsApps\\') {
        Write-Output "ERROR: 파일이 존재하지 않습니다: $target"
        exit
    }
}

# ── .lnk resolution ───────────────────────────────────────────────────
#
# Shortcuts come in three flavors; each needs different handling:
#   1) Store/MSIX app     → TargetPath = explorer.exe, Arguments = shell:AppsFolder\<AUMID>
#   2) Classic app        → TargetPath = C:\...\app.exe, plus optional Arguments / WorkingDirectory
#   3) Malformed / stale  → TargetPath empty or non-existent
#
# For classic apps we carry Arguments + WorkingDirectory forward to Start-Process.
# Adobe, Creative Cloud, JetBrains launchers, etc. fail silently if WorkingDirectory
# is missing — the exe launches but can't locate its sibling DLLs.
if ($target -match '\.lnk$') {
    try {
        $wsh = New-Object -ComObject WScript.Shell
        $lnk = $wsh.CreateShortcut($target)

        # (1) Store/MSIX shortcut — shell:AppsFolder path is the ONLY reliable launch.
        if ($lnk.TargetPath -match 'explorer\.exe$' -and
            $lnk.Arguments  -match 'shell:AppsFolder\\(.+)') {
            try {
                Start-Process explorer.exe "shell:AppsFolder\$($Matches[1])" -ErrorAction Stop
                Write-Output "LAUNCHED"
                exit
            } catch {
                Write-Output "ERROR: Store app launch failed: $($_.Exception.Message)"
                exit
            }
        }

        # (2) Classic shortcut — carry target + args + cwd.
        if ($lnk.TargetPath) {
            $target  = $lnk.TargetPath
            $lnkArgs = $lnk.Arguments
            $lnkCwd  = $lnk.WorkingDirectory
        }
    } catch {
        Write-Output "ERROR: .lnk resolve failed: $($_.Exception.Message)"
        exit
    }
}

# Rebase versioned browser paths AFTER .lnk resolution (so it covers
# both directly-saved exe paths AND .lnk-resolved paths). If the
# stored exe is `whale.exe` under a stale version folder, we hop
# to the latest version that's actually on disk.
if (-not (Test-Path -LiteralPath $target)) {
    $rebased = Rebase-VersionedBrowserPath $target
    if ($rebased -ne $target -and (Test-Path -LiteralPath $rebased)) {
        $target = $rebased
    }
}

$exeName = [System.IO.Path]::GetFileNameWithoutExtension($target)

# ── Document vs executable routing for focus stage ───────────────────
# For documents (.pptx, .docx, .pdf, etc.), the right "already running"
# check is whether an app is displaying a window whose title contains the
# filename — NOT a process named after the file.
$ext = [System.IO.Path]::GetExtension($target).ToLower()
$executableExts = @('.exe', '.bat', '.cmd', '.lnk', '.msi', '.com', '.ps1')
$isDocument = $ext.Length -gt 0 -and -not ($executableExts -contains $ext)

if ($isDocument) {
    $fileBase    = [System.IO.Path]::GetFileNameWithoutExtension($target)
    $fileWithExt = [System.IO.Path]::GetFileName($target)

    # Needle progression + EnumWindows — see Find-Hwnd for full rationale.
    $needles = @($fileWithExt, $fileBase)
    if ($fileBase.Length -gt 20) { $needles += $fileBase.Substring(0, 20) }
    if ($fileBase.Length -gt 10) { $needles += $fileBase.Substring(0, 10) }

    foreach ($needle in $needles) {
        $hits = [NostWin32]::FindWindowsByTitleContains($needle)
        if ($hits.Count -gt 0) {
            [NostWin32]::ShowWindow($hits[0], 9)
            [NostWin32]::SetForegroundWindow($hits[0])
            Write-Output "FOCUSED"
            exit
        }
    }
    # Not currently open — fall through to ShellExecute launch.
}

# ── Already-running window? → focus it ───────────────────────────────
# Stage 1: match by full exe path. Access denied on elevated processes is
# swallowed by the inner try/catch so the pipeline can continue.
$proc = Get-Process | Where-Object {
    try { $_.MainModule.FileName -eq $target } catch { $false }
} | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1

# Stage 2: match by process name. Handles the case where the current user
# can't read MainModule (WindowsApps / elevated / cross-user) and also the
# case where the shortcut's resolved exe name equals the running process.
if (-not $proc) {
    $proc = Get-Process -Name $exeName -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

if ($proc) {
    $hWnd = $proc.MainWindowHandle
    [NostWin32]::ShowWindow($hWnd, 9)
    [NostWin32]::SetForegroundWindow($hWnd)
    Write-Output "FOCUSED"
    exit
}

# ── Launch ────────────────────────────────────────────────────────────
$launched = $false
$attemptErrors = @()

# (A) WindowsApps / Store — user stored the exe path directly, not the .lnk.
if ($target -match '\\WindowsApps\\') {
    # Method 1: Get-StartApps (most reliable when available)
    try {
        $startApp = Get-StartApps -ErrorAction Stop | Where-Object { $_.Name -ieq $exeName } | Select-Object -First 1
        if ($startApp) {
            Start-Process explorer.exe "shell:AppsFolder\$($startApp.AppID)"
            $launched = $true
        }
    } catch { $attemptErrors += "Get-StartApps: $($_.Exception.Message)" }

    # Method 2: Get-AppxPackage by package NAME (first underscore segment
    # of the WindowsApps folder), not by full prefix match. Prefix
    # matching breaks the moment the Store auto-updates the app — the
    # old saved path no longer starts with the new InstallLocation.
    # Name-based matching survives version bumps.
    if (-not $launched) {
        try {
            $folderName = ($target -split '\\WindowsApps\\')[1] -split '\\' | Select-Object -First 1
            $baseName   = ($folderName -split '_')[0]
            $pkg = $null
            if ($baseName) {
                $pkg = Get-AppxPackage | Where-Object { $_.Name -eq $baseName } | Select-Object -First 1
            }
            if (-not $pkg) {
                # Last-resort: full prefix match (covers exotic install paths
                # outside Program Files that the name match might miss).
                $pkg = Get-AppxPackage | Where-Object {
                    $_.InstallLocation -and $target.StartsWith($_.InstallLocation, [System.StringComparison]::OrdinalIgnoreCase)
                } | Select-Object -First 1
            }
            if ($pkg) {
                $manifest = Get-AppxPackageManifest -Package $pkg
                $appId = $manifest.Package.Applications.Application.Id
                if ($appId) {
                    Start-Process explorer.exe "shell:AppsFolder\$($pkg.PackageFamilyName)!$appId"
                    $launched = $true
                }
            }
        } catch { $attemptErrors += "AppxPackage: $($_.Exception.Message)" }
    }

    # Method 3: Parse PackageFamilyName from folder path. Used when
    # Get-AppxPackage couldn't be queried (locked-down environments,
    # cross-user installs). We try several App-ID guesses in order of
    # likelihood; per-iteration try/catch so a wrong guess doesn't
    # kill the whole fallback (the original loop break-on-throw bug).
    if (-not $launched) {
        try {
            $folderName = ($target -split '\\WindowsApps\\')[1] -split '\\' | Select-Object -First 1
            if ($folderName -match '^(.+?)_[\d.]+_.*?__(.+)$') {
                $familyName  = "$($Matches[1])_$($Matches[2])"
                $packageName = $Matches[1]
                # 'App' is the by-far most common AppID; lowercase 'app'
                # next; the package short-name is rare but happens for
                # apps with multiple Application entries.
                foreach ($aid in @('App', 'app', $packageName)) {
                    try {
                        Start-Process explorer.exe "shell:AppsFolder\${familyName}!${aid}" -ErrorAction Stop
                        $launched = $true
                        break
                    } catch {
                        $attemptErrors += "PackageFamily!$aid : $($_.Exception.Message)"
                    }
                }
            }
        } catch { $attemptErrors += "PackageFamily parse: $($_.Exception.Message)" }
    }
}

# (B) Classic launch with preserved .lnk arguments and working directory.
#     Skipping this step for Store apps (handled above).
if (-not $launched) {
    try {
        $psParams = @{ FilePath = $target; ErrorAction = 'Stop' }
        if ($lnkArgs) { $psParams.ArgumentList = $lnkArgs }
        if ($lnkCwd -and (Test-Path -LiteralPath $lnkCwd)) {
            $psParams.WorkingDirectory = $lnkCwd
        }
        Start-Process @psParams
        $launched = $true
    } catch { $attemptErrors += "Start-Process: $($_.Exception.Message)" }
}

# (C) ShellExecute fallback via Invoke-Item — handles the .lnk directly,
#     which is the ONLY path Adobe / Creative Cloud / JetBrains launchers
#     sometimes work through because it triggers the shell's own elevation
#     and protocol handler resolution. We try the ORIGINAL $env:QL_PATH
#     (the .lnk itself) first so ShellExecute sees the shortcut's
#     full configuration, not our partially-unrolled version.
if (-not $launched) {
    try {
        $invokeTarget = if ($env:QL_PATH -match '\.lnk$') { $env:QL_PATH } else { $target }
        Invoke-Item -LiteralPath $invokeTarget -ErrorAction Stop
        $launched = $true
    } catch { $attemptErrors += "Invoke-Item: $($_.Exception.Message)" }
}

if ($launched) {
    Write-Output "LAUNCHED"
} else {
    # Machine-readable line so main.js can parse + surface to the user
    Write-Output "ERROR: all launch attempts failed | target=$target | $($attemptErrors -join ' || ')"
}
