. "$PSScriptRoot\_Win32Types.ps1"

$shell = New-Object -ComObject Shell.Application
$target = $env:QL_PATH.TrimEnd('\')
$found = $false
foreach ($w in $shell.Windows()) {
    try {
        if ($w.Document -ne $null -and $w.Document.Folder.Self.Path.TrimEnd('\') -eq $target) {
            $hwnd = [IntPtr][long]$w.HWND
            [NostWin32]::ShowWindow($hwnd, 9)
            [NostWin32]::SetForegroundWindow($hwnd)
            $found = $true
            break
        }
    } catch {}
}
if (-not $found) { Start-Process explorer.exe $env:QL_PATH }
