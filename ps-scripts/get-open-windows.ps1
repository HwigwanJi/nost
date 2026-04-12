. "$PSScriptRoot\_Win32Types.ps1"

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Phase 1: Explorer windows via Shell.Application (gets real folder paths)
$shell = New-Object -ComObject Shell.Application
$explorers = @()
foreach ($w in $shell.Windows()) {
    try {
        $p = $w.Document.Folder.Self.Path
        $n = $w.LocationName
        $h = $w.HWND
        if ($p -and $p -notlike 'http*' -and $p -notlike '::{*') {
            $explorers += @{ ProcessName='explorer'; MainWindowTitle=$n; FolderPath=$p; HWND=$h }
        }
    } catch {}
}

# Phase 2: Non-explorer visible windows (with ExePath)
$procs = @(Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and
    [NostWin32]::IsWindowVisible($_.MainWindowHandle) -and
    $_.MainWindowTitle -and
    $_.ProcessName -ne 'explorer' -and
    $_.ProcessName -ne 'electron' -and
    $_.ProcessName -ne 'nost'
} | ForEach-Object {
    $ep = ''
    try { $ep = $_.MainModule.FileName } catch {}
    @{ ProcessName=$_.ProcessName; MainWindowTitle=$_.MainWindowTitle; ExePath=$ep }
})

$all = @()
if ($explorers.Count -gt 0) { $all += $explorers }
if ($procs.Count -gt 0) { $all += $procs }

ConvertTo-Json -InputObject @{ windows=$all } -Compress -Depth 3
