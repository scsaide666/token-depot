param([int]$GatewayPid, [int]$IntervalMs = 1000)
$ErrorActionPreference = 'Stop'
$logicalProcessors = [Environment]::ProcessorCount
while ($true) {
  try {
    $gateway = Get-Process -Id $GatewayPid -ErrorAction Stop
    [ordered]@{
      timestampMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      cpuTotalMs = $gateway.TotalProcessorTime.TotalMilliseconds
      workingSetBytes = $gateway.WorkingSet64
      privateBytes = $gateway.PrivateMemorySize64
      logicalProcessors = $logicalProcessors
    } | ConvertTo-Json -Compress
  } catch { break }
  Start-Sleep -Milliseconds $IntervalMs
}
