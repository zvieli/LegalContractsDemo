$h = @{ 'x-api-key' = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }
try {
  $r = Invoke-RestMethod -Uri 'http://localhost:3001/api/admin/forwarder/status' -Method GET -Headers $h -TimeoutSec 10 -ErrorAction Stop
  Write-Host 'OK'
  $r | ConvertTo-Json -Depth 6 | Write-Host
} catch {
  Write-Host 'FAILED:' $_.Exception.Message
  if ($_.Exception.Response) { Write-Host 'Status:' $_.Exception.Response.StatusCode.Value__ }
}