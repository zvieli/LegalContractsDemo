<#
PowerShell smoke test for the ArbiTrust forwarder + Ollama + Helia

What it does:
- Reads server/.env for OLLAMA_HOST, IPFS_HOST, BACKEND_URL and admin key names
- Probes Ollama, Helia and Backend endpoints
- Posts a test appeal to /api/admin/forwarder/forward-evidence
- Polls server/data/llm-verdicts.json for the job result (up to timeout)
- Prints server logs for debugging

Usage (run from repo root):
  .\scripts\verify-forwarder.ps1

Requires PowerShell 5+ (Windows) or pwsh on *nix.
#>

param(
  [string]$EnvFile = "server/.env",
  [int]$PollSeconds = 5,
  [int]$TimeoutSeconds = 60
)

function Read-EnvFileValue($filePath, $key) {
  if (-not (Test-Path $filePath)) { return $null }
  $lines = Get-Content $filePath | Where-Object { $_ -and ($_ -notmatch '^\s*#') }
  foreach ($l in $lines) {
    $pair = $l -split '=', 2
    if ($pair.Length -eq 2) {
      $k = $pair[0].Trim()
      $v = $pair[1].Trim()
      if ($k -eq $key) { return $v }
    }
  }
  return $null
}

Write-Host "[verify-forwarder] Loading env from $EnvFile"

$OLLAMA_HOST = Read-EnvFileValue $EnvFile 'OLLAMA_HOST'
# fallback to legacy LLM_ARBITRATOR_URL (present in server/.env attachment)
if (-not $OLLAMA_HOST) { $OLLAMA_HOST = Read-EnvFileValue $EnvFile 'LLM_ARBITRATOR_URL' }

# IPFS / Helia keys present in server/.env: IPFS_HOST and IPFS_GATEWAY_URL
$IPFS_HOST = Read-EnvFileValue $EnvFile 'IPFS_HOST'
if (-not $IPFS_HOST) { $IPFS_HOST = Read-EnvFileValue $EnvFile 'IPFS_GATEWAY_URL' }

# Backend URL: prefer BACKEND_URL, fallback to SERVER_PORT or PORT
$BACKEND_URL = Read-EnvFileValue $EnvFile 'BACKEND_URL'
if (-not $BACKEND_URL) { $port = Read-EnvFileValue $EnvFile 'SERVER_PORT'; if (-not $port) { $port = Read-EnvFileValue $EnvFile 'PORT' }; if ($port) { $BACKEND_URL = "http://localhost:$port" } }

# Admin key: the server/.env uses VITE_PLATFORM_ADMIN and PLATFORM_ADMIN_ADDRESS
$ADMIN_KEY = Read-EnvFileValue $EnvFile 'PREVIEW_API_KEY'
if (-not $ADMIN_KEY) { $ADMIN_KEY = Read-EnvFileValue $EnvFile 'ADMIN_PREVIEW_KEY' }
if (-not $ADMIN_KEY) { $ADMIN_KEY = Read-EnvFileValue $EnvFile 'PLATFORM_ADMIN_ADDRESS' }
if (-not $ADMIN_KEY) { $ADMIN_KEY = Read-EnvFileValue $EnvFile 'VITE_PLATFORM_ADMIN' }

Write-Host "OLLAMA_HOST=$OLLAMA_HOST"
Write-Host "IPFS_HOST=$IPFS_HOST"
Write-Host "BACKEND_URL=$BACKEND_URL"
Write-Host "Using admin key (header x-api-key): $($null -ne $ADMIN_KEY)"

function Test-UrlProbe {
  param(
    [Parameter(Mandatory=$true)][string]$url,
    [string]$method = 'GET',
    [int]$timeoutSec = 5
  )
  try {
    Write-Host "Probing $url ..."
    $resp = Invoke-RestMethod -Method $method -Uri $url -TimeoutSec $timeoutSec -ErrorAction Stop
    return @{ ok = $true; status = 200; body = $resp }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

# 1) Probe services
if ($OLLAMA_HOST) {
  $probeUrl = $OLLAMA_HOST.TrimEnd('/') + '/api/version'
  $p = Test-UrlProbe -url $probeUrl -timeoutSec 3
  if ($p.ok) { Write-Host "OLLAMA reachable at $probeUrl" } else { Write-Warning "OLLAMA probe failed: $($p.error)" }
} else { Write-Warning "OLLAMA_HOST not configured in $EnvFile" }

if ($IPFS_HOST) {
  $probeUrl = $IPFS_HOST.TrimEnd('/') + '/api/v0/version'
  $p = Test-UrlProbe -url $probeUrl -timeoutSec 3
  if ($p.ok) { Write-Host "IPFS/Helia reachable at $probeUrl" } else { Write-Warning "IPFS probe failed: $($p.error)" }
} else { Write-Warning "IPFS_HOST not configured in $EnvFile" }

if ($BACKEND_URL) {
  $probeUrl = $BACKEND_URL.TrimEnd('/') + '/api/v7/arbitration/health'
  $p = Test-UrlProbe -url $probeUrl -timeoutSec 3
  if ($p.ok) { Write-Host "Backend reachable at $probeUrl" } else {
    Write-Warning "Backend health probe failed: $($p.error)"
    # Also try a general API probe
    $probeUrl2 = $BACKEND_URL.TrimEnd('/') + '/api'
  $p2 = Test-UrlProbe -url $probeUrl2 -timeoutSec 3
  if ($p2.ok) { Write-Host "Backend API reachable at $probeUrl2" } else { Write-Warning "Backend API probe failed: $($p2.error)" }
  }
} else { Write-Warning "BACKEND_URL not configured in $EnvFile" }

# 2) Send test forward-evidence
if (-not $BACKEND_URL) { Write-Error "No BACKEND_URL; aborting test."; exit 1 }

$apiEndpoint = $BACKEND_URL.TrimEnd('/') + '/api/admin/forwarder/forward-evidence'
$headers = @{}
if ($ADMIN_KEY) { $headers['x-api-key'] = $ADMIN_KEY }

$timestamp = (Get-Date).ToString('o')
$testEvidenceRef = "test-evidence://local/$timestamp"
$body = @{ evidenceRef = $testEvidenceRef; caseId = "TEST-CASE-$($timestamp)"; contractAddress = "0x0000000000000000000000000000000000000000" } | ConvertTo-Json

Write-Host "Posting test forward-evidence to $apiEndpoint"
try {
  $resp = Invoke-RestMethod -Method Post -Uri $apiEndpoint -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 10 -ErrorAction Stop
  Write-Host "Forwarder API response:"; $resp | ConvertTo-Json -Depth 4 | Write-Host
  $jobId = $resp.jobId
  if (-not $jobId) { Write-Warning "No jobId returned from forwarder API" }
} catch {
  Write-Error "Forwarder API call failed: $($_.Exception.Message)"
  exit 1
}

# 3) Poll for verdict in server/data/llm-verdicts.json
$verdictFile = Join-Path -Path (Join-Path -Path (Get-Location) -ChildPath 'server') -ChildPath 'data/llm-verdicts.json'
Write-Host "Looking for verdict file at $verdictFile"
$start = Get-Date
$found = $false
while ((Get-Date) - $start -lt [TimeSpan]::FromSeconds($TimeoutSeconds)) {
  if (Test-Path $verdictFile) {
    try {
      $text = Get-Content $verdictFile -Raw
      $json = $text | ConvertFrom-Json
      if ($json -is [System.Array]) {
        $match = $json | Where-Object { $_.jobId -eq $jobId }
        if ($match) {
          Write-Host "Found verdict for job ${jobId}:"
          $match | ConvertTo-Json -Depth 6 | Write-Host
          $found = $true; break
        }
      }
    } catch {
      # partial write; ignore
    }
  }
  Start-Sleep -Seconds $PollSeconds
}
if (-not $found) { Write-Warning "Did not find verdict for job $jobId within $TimeoutSeconds seconds" }

# 4) Show forwarder status endpoint
$statusUrl = $BACKEND_URL.TrimEnd('/') + '/api/admin/forwarder/status'
try {
  $s = Invoke-RestMethod -Method Get -Uri $statusUrl -Headers $headers -TimeoutSec 5 -ErrorAction Stop
  Write-Host "Forwarder status:"; $s | ConvertTo-Json -Depth 4 | Write-Host
} catch {
  Write-Warning "Could not fetch forwarder status: $($_.Exception.Message)"
}

# 5) Tail server logs for debugging (if exist)
$logDir = Join-Path -Path (Join-Path -Path (Get-Location) -ChildPath 'server') -ChildPath 'logs'
$serverLog = Join-Path $logDir 'server.log'
$serverErrLog = Join-Path $logDir 'server.err.log'
Write-Host "\n=== Server logs (last 200 lines) ==="
if (Test-Path $serverLog) { Get-Content $serverLog -Tail 200 | Write-Host } else { Write-Warning "No server.log found at $serverLog" }

Write-Host "\n=== Server error logs (last 200 lines) ==="
if (Test-Path $serverErrLog) { Get-Content $serverErrLog -Tail 200 | Write-Host } else { Write-Warning "No server.err.log found at $serverErrLog" }

Write-Host "\nSmoke test complete.\n"