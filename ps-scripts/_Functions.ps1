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
    #
    # IMPORTANT — diagnostic output in this function uses Write-Host, NOT
    # Write-Output. A PowerShell function returns EVERY value written to the
    # output pipeline, so Write-Output "log" would get bundled into the
    # array returned to callers that do `$h = Find-Hwnd $item`. That both
    # hides the log (it never reaches stdout) and corrupts the hwnd cast
    # ([IntPtr][long]"string-log" throws), silently breaking tile. Write-Host
    # bypasses the pipeline entirely and goes straight to the host stream
    # which powershell.exe -Command exposes as real stdout.
    #
    if ($item.type -eq 'app') {
        $appPath = Resolve-AppPath $item.value
        # $null means a Store app shortcut — no reliable process-match possible
        if ($null -eq $appPath) {
            Write-Host "[find-hwnd] app store-lnk, no process-match possible: value='$($item.value)'"
            return $null
        }

        # ── Document vs executable routing ────────────────────────────
        # nost's "app" type is overloaded: users drop either an .exe
        # (PowerPoint) or a document (a specific .pptx) and both land with
        # type='app'. For documents there is NO process named after the
        # file — the real process is the owning application (POWERPNT,
        # WINWORD, AcroRd32…) and the correct handle belongs to whichever
        # window is currently displaying that file. Match by title instead.
        $ext = [System.IO.Path]::GetExtension($appPath).ToLower()
        $executableExts = @('.exe', '.bat', '.cmd', '.lnk', '.msi', '.com', '.ps1')
        $isDocument = $ext.Length -gt 0 -and -not ($executableExts -contains $ext)

        if ($isDocument) {
            $fileBase    = [System.IO.Path]::GetFileNameWithoutExtension($appPath)
            $fileWithExt = [System.IO.Path]::GetFileName($appPath)

            # Needle progression from most-specific to most-forgiving:
            #   1) full filename with extension  (Word/Excel style titles)
            #   2) filename without extension    (PowerPoint sometimes strips)
            #   3) first 20 chars of base        (long-title truncation)
            #   4) first 10 chars of base        (last-ditch match)
            $needles = @($fileWithExt, $fileBase)
            if ($fileBase.Length -gt 20) { $needles += $fileBase.Substring(0, 20) }
            if ($fileBase.Length -gt 10) { $needles += $fileBase.Substring(0, 10) }

            # Use EnumWindows — NOT Get-Process.MainWindowHandle.
            #
            # Multi-document Office apps (PowerPoint with 2+ .pptx open) run
            # under ONE process but host one top-level window per document.
            # Process.MainWindowHandle points at only one of them; the others
            # are real visible HWNDs but invisible to Get-Process. EnumWindows
            # walks the entire window tree so every document-window gets seen.
            foreach ($needle in $needles) {
                $hits = [NostWin32]::FindWindowsByTitleContains($needle)
                if ($hits.Count -gt 0) {
                    $hWnd = $hits[0]
                    $titleSb = New-Object System.Text.StringBuilder 512
                    [NostWin32]::GetWindowText($hWnd, $titleSb, 512) | Out-Null
                    Write-Host "[find-hwnd] document matched by EnumWindows: needle='$needle' hwnd=$([long]$hWnd) total=$($hits.Count) title='$($titleSb.ToString())'"
                    return $hWnd
                }
            }
            Write-Host "[find-hwnd] document NOT found by EnumWindows: file='$fileBase' ext='$ext' — tried $($needles.Count) needle patterns"
            return $null
        }

        $exeName = [System.IO.Path]::GetFileNameWithoutExtension($appPath)

        # Stage 1 — exact MainModule.FileName match. Most reliable but fails
        # when the calling PS session lacks PROCESS_QUERY_LIMITED_INFORMATION
        # on the target (elevated apps, WindowsApps sandboxing).
        $proc = Get-Process | Where-Object { try { $_.MainModule.FileName -eq $appPath } catch { $false } } |
            Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($proc) {
            Write-Host "[find-hwnd] app matched by path: exe='$exeName' pid=$($proc.Id) title='$($proc.MainWindowTitle)'"
            return $proc.MainWindowHandle
        }

        # Stage 2 — process-name exact match. Primary fallback for Office /
        # Adobe / WindowsApps where stage 1 can't read MainModule.
        $proc = Get-Process -Name $exeName -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($proc) {
            Write-Host "[find-hwnd] app matched by name: exe='$exeName' pid=$($proc.Id) title='$($proc.MainWindowTitle)'"
            return $proc.MainWindowHandle
        }

        # Stage 3 — wildcard/substring match over ALL running processes'
        # names. Handles launcher stubs (Click-to-Run for Office), renamed
        # executables, and mismatches between the stored exe path's basename
        # and the actual live process name. We require MainWindowHandle != 0
        # so we don't grab a background helper.
        $proc = Get-Process | Where-Object {
            $_.MainWindowHandle -ne 0 -and (
                $_.ProcessName -like "*$exeName*" -or
                $exeName -like "*$($_.ProcessName)*"
            )
        } | Select-Object -First 1
        if ($proc) {
            Write-Host "[find-hwnd] app matched by wildcard: target='$exeName' live='$($proc.ProcessName)' pid=$($proc.Id) title='$($proc.MainWindowTitle)'"
            return $proc.MainWindowHandle
        }

        # Stage 4 — a process with the right name exists but hasn't shown its
        # main window yet (PowerPoint/Word splash, first-run wizard, Adobe
        # sign-in). Let the caller's polling loop retry — we return $null so
        # Find-Hwnd signals "not ready".
        $waiting = Get-Process -Name $exeName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($waiting) {
            Write-Host "[find-hwnd] app process exists but MainWindowHandle=0: exe='$exeName' pid=$($waiting.Id) — waiting for window"
        } else {
            Write-Host "[find-hwnd] app NOT found: exe='$exeName' path='$appPath'"
        }
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
