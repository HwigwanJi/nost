. "$PSScriptRoot\_Win32Types.ps1"

# ── Inputs ────────────────────────────────────────────────────────────
$target  = $env:QL_PATH
$lnkArgs = ''
$lnkCwd  = ''

# ── Sanity check: the stored value must be a rooted absolute path ────
# nost historically stored drag-dropped files as "Name.ext" (no directory)
# on Electron 32+ because File.path became undefined. Such items can never
# be launched — surface a clear "re-register" hint instead of a cryptic
# Start-Process error.
if (-not [System.IO.Path]::IsPathRooted($target)) {
    Write-Output "ERROR: 경로가 파일명만 저장되어 있습니다 ($target). 카드를 삭제하고 다시 등록하세요."
    exit
}
if (-not (Test-Path -LiteralPath $target)) {
    Write-Output "ERROR: 파일이 존재하지 않습니다: $target"
    exit
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

$exeName = [System.IO.Path]::GetFileNameWithoutExtension($target)

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

    # Method 2: Extract AUMID from path + Get-AppxPackage
    if (-not $launched) {
        try {
            $pkg = Get-AppxPackage | Where-Object {
                $_.InstallLocation -and $target.StartsWith($_.InstallLocation, [System.StringComparison]::OrdinalIgnoreCase)
            } | Select-Object -First 1
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

    # Method 3: Parse PackageFamilyName from folder path directly
    if (-not $launched) {
        try {
            $folderName = ($target -split '\\WindowsApps\\')[1] -split '\\' | Select-Object -First 1
            if ($folderName -match '^(.+?)_[\d.]+_.*?__(.+)$') {
                $familyName = "$($Matches[1])_$($Matches[2])"
                foreach ($aid in @($Matches[1], 'App', 'app')) {
                    Start-Process explorer.exe "shell:AppsFolder\${familyName}!${aid}" -ErrorAction Stop
                    $launched = $true
                    break
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
