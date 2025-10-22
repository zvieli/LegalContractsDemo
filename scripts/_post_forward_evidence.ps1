$h = @{ 'x-api-key' = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; 'Content-Type' = 'application/json' }
$body = @{ evidenceRef = 'test-evidence://local/manual'; caseId = 'TEST' ; contractAddress = '0x0' } | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Uri 'http://localhost:3001/api/admin/forwarder/forward-evidence' -Method POST -Headers $h -Body $body -TimeoutSec 10 -ErrorAction Stop
  Write-Host 'OK'; $r | ConvertTo-Json -Depth 6 | Write-Host
} catch {
  Write-Host 'FAILED:' $_.Exception.Message
  if ($_.Exception.Response) { Write-Host 'Status:' $_.Exception.Response.StatusCode.Value__ }
  if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream) {
    try { $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); Write-Host 'Body:' $sr.ReadToEnd() } catch {} 
  }
}