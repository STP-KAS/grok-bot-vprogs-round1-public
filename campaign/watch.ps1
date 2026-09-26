# Restarts the TN10 runner if it is not already up, until campaign/until.txt.
$root = "C:\Users\<user>\Documents\kaspa\grok-bot-vprogs"
$until = [datetimeoffset]::Parse((Get-Content "$root\campaign\until.txt").Trim())
if ([datetimeoffset]::UtcNow -ge $until) { exit 0 }
$alive = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*grok-bot-vprogs*campaign\run.mjs*" }
if ($alive) { exit 0 }
Start-Process -FilePath "node" `
  -ArgumentList "$root\campaign\run.mjs" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$root\campaign\runner.out" `
  -RedirectStandardError "$root\campaign\runner.err"
