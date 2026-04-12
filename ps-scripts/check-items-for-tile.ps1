. "$PSScriptRoot\_Functions.ps1"

$items = $env:QL_ITEMS | ConvertFrom-Json
$out = @()
foreach ($item in $items) {
  $h = Find-Hwnd $item
  $out += [PSCustomObject]@{ idx = $item.idx; alive = ($null -ne $h) }
}
$out | ConvertTo-Json -Compress
