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
        $startApp = Get-StartApps | Where-Object { $_.Name -ieq $exeName } | Select-Object -First 1
        if ($startApp) {
            Start-Process explorer.exe "shell:AppsFolder\$($startApp.AppID)"
            $launched = $true
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
