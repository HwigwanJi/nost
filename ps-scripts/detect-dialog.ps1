# Detect whether the foreground window is a Windows file dialog (Save-As /
# Open) and, if so, hand back enough geometry that nost can position its
# context-bar popup attached to the dialog's top edge.
#
# We treat a dialog as "interesting" when:
#   - className == "#32770" (the standard Windows dialog class — Save-As,
#     Open, Print, Properties etc. all use it)
# Caller filters further by title (e.g. only show on titles containing
# "저장" / "Save" / "Open") if it wants to be conservative.

. "$PSScriptRoot\_Win32Types.ps1"

$hWnd = [NostWin32]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 256
$class = New-Object System.Text.StringBuilder 256
[NostWin32]::GetWindowText($hWnd, $title, 256) | Out-Null
[NostWin32]::GetClassName($hWnd, $class, 256) | Out-Null

$isDialog = ($class.ToString() -eq "#32770")

$rectObj = $null
if ($isDialog) {
    $r = New-Object NostWin32+RECT
    if ([NostWin32]::GetWindowRect($hWnd, [ref]$r)) {
        $rectObj = @{
            x = [int]$r.Left
            y = [int]$r.Top
            width  = [int]($r.Right - $r.Left)
            height = [int]($r.Bottom - $r.Top)
        }
    }
}

# hwnd as decimal int — JS can compare it across polls to detect "same dialog
# still in focus" vs "user clicked another dialog".
$res = @{
    title = $title.ToString()
    className = $class.ToString()
    isDialog = $isDialog
    hwnd = if ($isDialog) { [int64]$hWnd } else { 0 }
    rect = $rectObj
}
$res | ConvertTo-Json -Compress
