$ErrorActionPreference = 'Stop'

$appPort = if ($env:PORT) { [int]$env:PORT } else { 3817 }
$pidFile = Join-Path $PSScriptRoot '.worker-card.pid'

Write-Host "Stopping Worker Card on port $appPort..."

$listenerPids = @(netstat -ano -p TCP | ForEach-Object {
    if ($_ -match "^\s*TCP\s+\S+:$appPort\s+\S+\s+LISTENING\s+(\d+)\s*$") {
        [int]$Matches[1]
    }
})
$listenerPids = @($listenerPids | Select-Object -Unique)

if (-not (Test-Path -LiteralPath $pidFile)) {
    # Support an instance started before PID-file tracking was added.
    if ($listenerPids.Count -eq 1) {
        $legacyProcess = Get-Process -Id $listenerPids[0] -ErrorAction SilentlyContinue
        if ($legacyProcess -and $legacyProcess.ProcessName -eq 'node') {
            Stop-Process -Id $legacyProcess.Id -Force
            Write-Host "Worker Card stopped (legacy PID $($legacyProcess.Id))."
            exit 0
        }
    }

    Write-Host 'Worker Card is not running.'
    exit 0
}

try {
    $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    $savedPid = [int]$saved.pid
    $savedPort = [int]$saved.port
} catch {
    Remove-Item -LiteralPath $pidFile -Force
    Write-Error 'The PID file was invalid and has been removed. Start the service again.'
    exit 1
}

if ($savedPort -ne $appPort) {
    Write-Error "The running service uses port $savedPort. Set PORT=$savedPort before stopping it."
    exit 1
}

$process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue

if (-not $process -or $process.ProcessName -ne 'node' -or $savedPid -notin $listenerPids) {
    Remove-Item -LiteralPath $pidFile -Force
    Write-Host 'Worker Card is not running. A stale PID file was removed.'
    exit 0
}

Stop-Process -Id $savedPid -Force
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "Worker Card stopped (PID $savedPid)."
