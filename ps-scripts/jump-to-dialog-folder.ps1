$obj = New-Object -ComObject WScript.Shell
Start-Sleep -m 100
$obj.SendKeys("^l")
Start-Sleep -m 100
$obj.SendKeys($env:QL_PATH)
Start-Sleep -m 100
$obj.SendKeys("{ENTER}")
