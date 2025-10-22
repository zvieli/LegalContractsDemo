# Smoke test for Helia evidence upload & retrieval (PowerShell)
# Usage: Open PowerShell in repo root and run:
#   .\scripts\smoke-helia.ps1

$server = $env:V7_SERVER_URL
if (-not $server) { $server = 'http://localhost:3001' }

Write-Host "Using server: $server"

# Prepare payload (base64 of JSON evidence)
$evidence = @{ type = 'rent_dispute'; description = 'Smoke test evidence from smoke-helia.ps1'; metadata = @{ contractAddress = '0xDEADBEEF'; disputeType = 'UNPAID_RENT'; amount = '0.1 ETH' } }
$json = $evidence | ConvertTo-Json -Depth 5
$encoded = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
$body = @{ ciphertext = $encoded } | ConvertTo-Json

Write-Host "Uploading evidence..."
try {
    $res = Invoke-RestMethod -Method Post -Uri "$server/api/evidence/upload" -ContentType 'application/json' -Body $body -ErrorAction Stop
} catch {
    Write-Error "Upload failed: $_"
    exit 2
}

Write-Host "Upload response:"
Write-Host ($res | ConvertTo-Json -Depth 5)

if (-not $res.cid) {
    Write-Error "No cid returned - upload failed or Helia not available"
    exit 3
}

$cid = $res.cid
Write-Host "Retrieved CID: $cid"

Write-Host "Retrieving evidence by CID..."
try {
    $get = Invoke-RestMethod -Method Get -Uri "$server/api/evidence/retrieve/$cid" -ErrorAction Stop
} catch {
    Write-Error "Retrieve failed: $_"
    exit 4
}

Write-Host "Retrieve response:"
Write-Host ($get | ConvertTo-Json -Depth 5)

if ($res.heliaConfirmed -ne $true) {
    Write-Warning "Warning: heliaConfirmed was not true in upload response"
}

Write-Host "Smoke test completed successfully"
exit 0
