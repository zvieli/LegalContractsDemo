param(
  [Parameter(Mandatory=$true)] [string] $base64,
  [Parameter(Mandatory=$true)] [string] $digest
)

$body = @{ ciphertext = $base64; digest = $digest } | ConvertTo-Json
Write-Host "Posting to http://127.0.0.1:5001/submit-evidence with digest $digest"
try {
  $res = Invoke-RestMethod -Uri http://127.0.0.1:5001/submit-evidence -Method POST -ContentType 'application/json' -Body $body
  $res | ConvertTo-Json -Depth 5
} catch {
  Write-Error "Request failed: $($_.Exception.Message)"
  if ($_.Exception.Response) { $_.Exception.Response | Format-List -Force }
  exit 1
}
