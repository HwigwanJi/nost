# Resolve the best icon-source path for a Windows shortcut (.lnk).
#
# Priority:
#   1) IconLocation — explicit icon set in the shortcut's properties. Common
#      for Store/UWP launchers, Adobe/Creative Cloud, JetBrains, etc.
#   2) TargetPath   — the underlying executable itself. Standard path.
#
# Output: a single line containing the resolved path, or nothing on failure.
# The caller (main.js) feeds this path into Electron's app.getFileIcon().
#
# IconLocation format: "<path>,<index>" or just "<path>". We strip the index
# because Electron's getFileIcon always returns the default (index 0); a
# shortcut pointing at a specific icon index will get the exe's default icon
# instead, which is still dramatically better than the generic .lnk icon.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding            = [System.Text.Encoding]::UTF8

$target = $env:QL_PATH
if (-not $target -or -not (Test-Path -LiteralPath $target)) { exit }

try {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut($target)

    # (1) IconLocation — strip any ",index" suffix, quotes, and env var refs.
    if ($lnk.IconLocation) {
        $iconRaw = ($lnk.IconLocation -split ',')[0].Trim().Trim('"')
        # Expand %SystemRoot%, %ProgramFiles%, etc.
        $iconExpanded = [System.Environment]::ExpandEnvironmentVariables($iconRaw)
        if ($iconExpanded -and (Test-Path -LiteralPath $iconExpanded)) {
            Write-Output $iconExpanded
            exit
        }
    }

    # (2) TargetPath — the underlying exe. Skip if it's explorer.exe with
    # shell:AppsFolder arguments (Store app) because explorer's generic icon
    # is uglier than the shortcut's own icon. The caller will fall back to
    # getFileIcon on the raw .lnk in that case.
    if ($lnk.TargetPath -and (Test-Path -LiteralPath $lnk.TargetPath)) {
        if ($lnk.TargetPath -match 'explorer\.exe$' -and
            $lnk.Arguments  -match 'shell:AppsFolder\\') {
            # Store app shortcut without a useful IconLocation — caller's fallback
            exit
        }
        Write-Output $lnk.TargetPath
    }
} catch {
    # Silent — caller will fall back to the raw .lnk icon
}
