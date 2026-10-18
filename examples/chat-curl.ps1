if (-not $env:AIHUB_API_KEY) { throw 'Set AIHUB_API_KEY to your platform key.' }
$taskBase = if ($env:AIHUB_BASE_URL) { $env:AIHUB_BASE_URL.TrimEnd('/') } else { 'http://127.0.0.1:3000/v1' }
$taskModel = if ($env:AIHUB_MODEL) { $env:AIHUB_MODEL } else { 'deepseek-flash' }
foreach ($taskStream in @($false, $true)) {
  $taskBody = @{ model = $taskModel; messages = @(@{ role = 'user'; content = 'Say hello briefly.' }); max_tokens = 32; stream = $taskStream }
  if ($taskStream) { $taskBody.stream_options = @{ include_usage = $true } }
  $taskJson = $taskBody | ConvertTo-Json -Compress -Depth 5
  # Pass credentials through stdin, rather than putting the key in process args.
  @"
url = "$taskBase/chat/completions"
header = "Authorization: Bearer $env:AIHUB_API_KEY"
header = "Content-Type: application/json"
data = "$($taskJson.Replace('\', '\\').Replace('"', '\"'))"
no-buffer
silent
show-error
fail-with-body
"@ | curl.exe --config -
  if ($LASTEXITCODE -ne 0) { throw 'The completion request failed.' }
  Write-Output ''
}
