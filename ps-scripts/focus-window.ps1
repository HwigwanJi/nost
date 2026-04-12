. "$PSScriptRoot\_Win32Types.ps1"
. "$PSScriptRoot\_Functions.ps1"

$tgt = $env:QL_TITLE; $tgtBase = Strip-AppSuffix $tgt
$process = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and (
        $_.MainWindowTitle -eq $tgt -or
        (Strip-AppSuffix $_.MainWindowTitle) -eq $tgt -or
        $_.MainWindowTitle -eq $tgtBase -or
        (Strip-AppSuffix $_.MainWindowTitle) -eq $tgtBase
    )
} | Select-Object -First 1
if ($process) {
  $hWnd = $process.MainWindowHandle
  [NostWin32]::ShowWindow($hWnd, 9)
  [NostWin32]::SetForegroundWindow($hWnd)
  Write-Output "FOUND"
} else {
  Write-Output "NOT_FOUND"
}
