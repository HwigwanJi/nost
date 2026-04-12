. "$PSScriptRoot\_Functions.ps1"

$titles = $env:QL_TITLES | ConvertFrom-Json
$result = @()
foreach ($t in $titles) {
    $tBase = Strip-AppSuffix $t
    $p = Get-Process | Where-Object {
        $_.MainWindowHandle -ne 0 -and (
            $_.MainWindowTitle -eq $t -or
            (Strip-AppSuffix $_.MainWindowTitle) -eq $t -or
            $_.MainWindowTitle -eq $tBase -or
            (Strip-AppSuffix $_.MainWindowTitle) -eq $tBase
        )
    } | Select-Object -First 1
    $result += [PSCustomObject]@{ t=$t; v=($null -ne $p) }
}
ConvertTo-Json -InputObject @($result) -Compress -Depth 2
