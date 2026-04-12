. "$PSScriptRoot\_Win32Types.ps1"

$target = $env:QL_PATH
$exeName = [System.IO.Path]::GetFileNameWithoutExtension($target)

# 1. Try to find already-running process by full path
$proc = Get-Process | Where-Object {
    try { $_.MainModule.FileName -eq $target } catch { $false }
} | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1

# 2. Fallback: match by process name (handles WindowsApps / access-denied cases)
if (-not $proc) {
    $proc = Get-Process -Name $exeName -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

if ($proc) {
    $hWnd = $proc.MainWindowHandle
    [NostWin32]::ShowWindow($hWnd, 9)
    [NostWin32]::SetForegroundWindow($hWnd)
    Write-Output "FOCUSED"
} else {
    $launched = $false

    # Detect WindowsApps (Store/MSIX) — launch via AUMID
    if ($target -match '\\WindowsApps\\') {
        # Method 1: Get-StartApps (most reliable when available)
        try {
            $startApp = Get-StartApps -ErrorAction Stop | Where-Object { $_.Name -ieq $exeName } | Select-Object -First 1
            if ($startApp) {
                Start-Process explorer.exe "shell:AppsFolder\$($startApp.AppID)"
                $launched = $true
            }
        } catch {}

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
            } catch {}
        }

        # Method 3: Parse PackageFamilyName from folder path directly
        if (-not $launched) {
            try {
                # Path: ...\WindowsApps\Name_Version_Arch__PublisherId\...
                $folderName = ($target -split '\\WindowsApps\\')[1] -split '\\' | Select-Object -First 1
                if ($folderName -match '^(.+?)_[\d.]+_.*?__(.+)$') {
                    $pkgName = $Matches[1]
                    $publisherId = $Matches[2]
                    $familyName = "${pkgName}_${publisherId}"
                    # Try common app IDs
                    foreach ($aid in @($pkgName, 'App', 'app')) {
                        Start-Process explorer.exe "shell:AppsFolder\${familyName}!${aid}" -ErrorAction Stop
                        $launched = $true
                        break
                    }
                }
            } catch {}
        }
    }

    # Normal exe launch
    if (-not $launched) {
        try {
            Start-Process $target -ErrorAction Stop
            $launched = $true
        } catch {}
    }

    if ($launched) { Write-Output "LAUNCHED" }
    else { Write-Output "ERROR" }
}
