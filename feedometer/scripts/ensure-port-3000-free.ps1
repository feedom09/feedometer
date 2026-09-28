$ErrorActionPreference = 'Stop'

$listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
  Write-Host "[2/2] Stopping existing listener on Port 3000 (PID $($listener.OwningProcess))..."
  Stop-Process -Id $listener.OwningProcess -Force
}

Start-Sleep -Milliseconds 750

if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 3000 is still in use and could not be released.'
}
