Param(
  [string]$ApiToken,
  [switch]$Dev,
  [switch]$SkipDeploy,
  [switch]$SkipSecrets,
  [switch]$VerboseTest
)

function Write-Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m){ Write-Host "[ERR ] $m" -ForegroundColor Red }
$ErrorActionPreference='Stop'

<#
Automates Cloudflare Worker setup for AI arbitration endpoint.
Usage:
  npm run ai:setup -- -ApiToken <TOKEN>
  npm run ai:setup -- -ApiToken <TOKEN> -SkipDeploy -Dev
Switches:
  -Dev          Run wrangler dev after other steps.
  -SkipDeploy   Do not deploy.
  -SkipSecrets  Do not write secrets.
  -VerboseTest  After deploy run test-ai-endpoint.js
#>

if (-not (Test-Path server/wrangler.toml)) { Write-Err 'Run from repo root (missing server/wrangler.toml)'; exit 1 }

Push-Location server
try {
  if ($ApiToken) {
    Write-Info 'Logging in with API token...'
    try { wrangler login --api-token $ApiToken | Out-Null } catch { Write-Err "Login failed: $($_.Exception.Message)"; exit 1 }
  } else { Write-Warn 'No -ApiToken provided; assuming existing auth.' }

  Write-Info 'Running wrangler whoami'
  $whoami = wrangler whoami 2>$null
  if (-not $whoami) { Write-Err 'whoami empty'; exit 1 }
  $accountId = ($whoami | Select-String -Pattern 'Account ID:\s*([0-9a-fA-F]+)' | ForEach-Object { $_.Matches[0].Groups[1].Value })
  if ($accountId) { Write-Info "Account ID: $accountId" } else { Write-Warn 'Could not parse Account ID' }

  if (-not $SkipSecrets) {
    if ($ApiToken) { Write-Info 'Setting CF_API_TOKEN secret'; $ApiToken | wrangler secret put CF_API_TOKEN --quiet 2>$null }
    if ($accountId) { Write-Info 'Setting CF_ACCOUNT_ID secret'; $accountId | wrangler secret put CF_ACCOUNT_ID --quiet 2>$null }
  } else { Write-Info 'Skipping secrets per flag' }

  $deployedUrl=$null
  if (-not $SkipDeploy) {
    Write-Info 'Deploying worker'
    $deployOut = wrangler deploy 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Err 'Deploy failed'; $deployOut | Write-Host; exit 1 }
    $deployedUrl = ($deployOut | Select-String -Pattern 'https://[^\s]+' | Select-Object -First 1 | ForEach-Object { $_.Matches[0].Value })
    if ($deployedUrl) { Write-Info "Deployed URL: $deployedUrl" } else { Write-Warn 'Could not parse deployed URL' }
  } else { Write-Info 'Skipping deploy per flag' }

  if ($VerboseTest -and $deployedUrl -and (Test-Path ..\scripts\test-ai-endpoint.js)) {
    Write-Info 'Running test script'
    Pop-Location
    node scripts/test-ai-endpoint.js --url $deployedUrl
    Push-Location server
  }

  if ($Dev) {
    Write-Info 'Starting wrangler dev (Ctrl+C to exit)'
    wrangler dev
  }
} finally { Pop-Location }

Write-Info 'Done.'
