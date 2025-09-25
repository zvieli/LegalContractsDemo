<#
run-e2e-windows.ps1

Runs a local Hardhat node, deploys contracts, starts the frontend dev server,
waits for services, runs the Playwright encrypt-decrypt E2E test, and then
provides exit status.

Usage (PowerShell):
  .\scripts\run-e2e-windows.ps1

Requirements:
- Node.js, npm
- Git Bash / Windows PowerShell
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Wait-ForHttp($url, $timeoutSec=60) {
  for ($i=0; $i -lt $timeoutSec; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
      return $true
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

Write-Host "Starting Hardhat node..."
Start-Process -FilePath "npx" -ArgumentList "hardhat node" -WorkingDirectory $root -WindowStyle Hidden
Write-Host "Waiting for Hardhat RPC at http://127.0.0.1:8545 ..."
if (-not (Wait-ForHttp 'http://127.0.0.1:8545' 60)) { Write-Warning 'Hardhat RPC did not respond in 60s. Continuing anyway.' }

Write-Host "Deploying contracts to localhost..."
npx hardhat run scripts/deploy.js --network localhost

Write-Host "Starting frontend dev server (background)..."
Start-Process -FilePath "npm" -ArgumentList "--prefix", "./front", "run", "dev" -WorkingDirectory $root -WindowStyle Hidden
Write-Host "Waiting for frontend at http://localhost:5173 ..."
if (-not (Wait-ForHttp 'http://127.0.0.1:5173' 30)) { Write-Warning 'Frontend did not respond in 30s. Proceeding to run tests anyway.' }

Write-Host "Running Playwright E2E test (encrypt-decrypt)..."
try {
  # Ensure TEST_RENT_CONTRACT env var is set by reading deploy output artifact
  $artifact = Join-Path $root 'deployments' 'localhost' 'TemplateRentContract.json'
  if (Test-Path $artifact) {
    try {
      $json = Get-Content $artifact -Raw | ConvertFrom-Json
      if ($json.address) { $env:TEST_RENT_CONTRACT = $json.address }
    } catch { }
  }

  # Run Playwright E2E (this script assumes front/e2e is configured)
  npm --prefix ./front run e2e
  $exit = $LASTEXITCODE
  if ($exit -ne 0) { throw "E2E tests failed with exit code $exit" }
  Write-Host 'E2E tests passed' -ForegroundColor Green
} catch {
  Write-Error "E2E run failed: $_"
  exit 1
}

Write-Host "Done. Manually terminate background processes if desired." -ForegroundColor Cyan
