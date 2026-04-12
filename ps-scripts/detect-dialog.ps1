. "$PSScriptRoot\_Win32Types.ps1"

$hWnd = [NostWin32]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 256
$class = New-Object System.Text.StringBuilder 256
[NostWin32]::GetWindowText($hWnd, $title, 256) | Out-Null
[NostWin32]::GetClassName($hWnd, $class, 256) | Out-Null
$res = @{ title = $title.ToString(); className = $class.ToString(); isDialog = ($class.ToString() -eq "#32770") }
$res | ConvertTo-Json -Compress
