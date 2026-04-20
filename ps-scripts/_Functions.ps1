# Shared PowerShell functions for nost PS scripts.
# Dot-source at the top of any script that needs these helpers:
#   . "$PSScriptRoot\_Functions.ps1"

function Strip-AppSuffix {
    param([string]$s)
    if ($s -match '^(.*?)\s+-\s+[^-]{1,30}$') { return $Matches[1].Trim() }
    return $s.Trim()
}

function Find-ExplorerHwnd {
    param([string]$path)
    $tp = $path.TrimEnd('\')
    $cs = New-Object -ComObject Shell.Application
    foreach ($w in $cs.Windows()) {
        try {
            if ($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\') -eq $tp) {
                return [IntPtr][long]$w.HWND
            }
        } catch {}
    }
    $leaf = Split-Path $tp -Leaf
    $proc = Get-Process explorer -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$leaf*" } |
        Select-Object -First 1
    if ($proc) { return $proc.MainWindowHandle }
    return $null
}

function Resolve-AppPath {
    # Resolve a Windows shortcut (.lnk) to its real target executable path.
    # Returns the original path unchanged for non-.lnk inputs or on error.
    #
    # Store/MSIX app shortcuts use TargetPath=explorer.exe + Arguments=shell:AppsFolder\<AUMID>.
    # For these we return $null (caller must handle AUMID separately) rather
    # than returning explorer.exe, which would incorrectly match a file-explorer window.
    param([string]$path)
    if ($path -match '\.lnk$') {
        try {
            $wsh = New-Object -ComObject WScript.Shell
            $lnk = $wsh.CreateShortcut($path)
            if ($lnk.TargetPath -match 'explorer\.exe$' -and
                $lnk.Arguments  -match 'shell:AppsFolder\\') {
                return $null   # Store app — caller should skip process-match
            }
            if ($lnk.TargetPath) { return $lnk.TargetPath }
        } catch {}
    }
    return $path
}

function Find-Hwnd {
    param($item)
    if ($item.type -eq 'app') {
        $appPath = Resolve-AppPath $item.value
        # $null means a Store app shortcut — no reliable process-match possible
        if ($null -eq $appPath) { return $null }
        $proc = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $appPath } catch { $false } } |
            Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if (-not $proc) {
            $exeName = [System.IO.Path]::GetFileNameWithoutExtension($appPath)
            $proc = Get-Process -Name $exeName -ErrorAction SilentlyContinue |
                Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        }
        if ($proc) { return $proc.MainWindowHandle }
    } elseif ($item.type -eq 'window') {
        $proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $item.value -and $_.MainWindowHandle -ne 0 } |
            Select-Object -First 1
        if (-not $proc -and $item.title -ne $item.value) {
            $proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $item.title -and $_.MainWindowHandle -ne 0 } |
                Select-Object -First 1
        }
        if (-not $proc) {
            $sv = $item.value
            $proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$sv*" } |
                Select-Object -First 1
        }
        if ($proc) { return $proc.MainWindowHandle }
    } elseif ($item.type -eq 'folder') {
        return Find-ExplorerHwnd $item.value
    } elseif ($item.type -eq 'url' -or $item.type -eq 'browser') {
        $st = if ($null -ne $item.tabTitle -and $item.tabTitle -ne '') { $item.tabTitle } else { $item.title }
        $br = @('chrome','msedge','firefox','opera','brave','vivaldi')
        $proc = Get-Process -Name $br -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$st*" } |
            Select-Object -First 1
        if (-not $proc) {
            $proc = Get-Process -Name $br -ErrorAction SilentlyContinue |
                Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } |
                Sort-Object StartTime -Descending | Select-Object -First 1
        }
        if ($proc) { return $proc.MainWindowHandle }
    }
    return $null
}
