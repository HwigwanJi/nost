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

# v1.3.44: also accept non-#32770 windows whose title looks like a file
# action — HWP / 일부 Office・Adobe 빌드 / 자체 다이얼로그를 그린 앱들. The
# native koffi path does a proper button-walk; this PS fallback (koffi 실패
# 시) settles for the title heuristic alone. Keep this regex in sync with
# TITLE_FILE_VERB_RE in foreground-window.js.
$titleStr = $title.ToString()
$titleHasVerb = $titleStr -match '다른 이름으로 저장|이름으로 저장|저장|열기|불러오기|다운로드|업로드|첨부|파일 선택|폴더 선택|가져오기|내보내기|Save As|Save|Open|Download|Upload|Attach|Choose File|Choose Folder|Browse For|Select File|Select Folder|Import|Export'
$isFileDialog = ($isDialog -and $titleHasVerb) -or (-not $isDialog -and $titleHasVerb)

$rectObj = $null
if ($isDialog -or $isFileDialog) {
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
    title = $titleStr
    className = $class.ToString()
    isDialog = $isDialog
    isFileDialog = $isFileDialog
    hwnd = if ($isDialog -or $isFileDialog) { [int64]$hWnd } else { 0 }
    rect = $rectObj
}
$res | ConvertTo-Json -Compress
