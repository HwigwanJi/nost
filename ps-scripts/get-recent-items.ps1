[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$shell = New-Object -ComObject WScript.Shell
$recent = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Recent')
$links = Get-ChildItem $recent -Filter *.lnk -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 50
$results = @()
foreach ($f in $links) {
    try {
        $lnk = $shell.CreateShortcut($f.FullName)
        $target = $lnk.TargetPath
        if (-not $target) { continue }
        if (-not (Test-Path $target -ErrorAction SilentlyContinue)) { continue }
        $isDir = (Get-Item $target -ErrorAction SilentlyContinue).PSIsContainer
        $results += @{
            title = $f.BaseName
            value = $target
            type = if ($isDir) { 'folder' } else { 'app' }
            lastAccessed = $f.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss')
        }
    } catch { continue }
}
if ($results.Count -eq 0) { Write-Output '[]' }
else { $results | ConvertTo-Json -Compress }
