<#
run-e2e-windows-sync.ps1

Runs the E2E pipeline synchronously in a single PowerShell session.
This script is intended to be started interactively so you can stop it with Ctrl+C.

Usage: from repo root run:
  powershell -ExecutionPolicy Bypass -File .\scripts\run-e2e-windows-sync.ps1

Note: This will run long-lived processes in the foreground (Hardhat node and Frontend). Keep the terminal open.
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

Write-Host "Starting Hardhat node (foreground). Use Ctrl+C to stop." -ForegroundColor Cyan
Start-Process -NoNewWindow -FilePath "npx" -ArgumentList "hardhat node" -WorkingDirectory $root -WindowStyle Normal -PassThru | Out-Null
Write-Host "Waiting for Hardhat RPC at http://127.0.0.1:8545 ..."
if (-not (Wait-ForHttp 'http://127.0.0.1:8545' 60)) { Write-Warning 'Hardhat RPC did not respond in 60s. Continuing anyway.' }

Write-Host "Deploying contracts to localhost..."
npx hardhat run scripts/deploy.js --network localhost

Write-Host "Starting frontend dev server (foreground). Use a new terminal if you want it separate." -ForegroundColor Cyan
Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "--prefix", "./front", "run", "dev" -WorkingDirectory $root -WindowStyle Normal -PassThru | Out-Null
Write-Host "Waiting for frontend at http://localhost:5173 ..."
if (-not (Wait-ForHttp 'http://127.0.0.1:5173' 30)) { Write-Warning 'Frontend did not respond in 30s. Proceeding to run tests anyway.' }

Write-Host "Please open a new PowerShell terminal and run the Playwright test: `npm --prefix ./front run e2e`" -ForegroundColor Yellow
Write-Host "This script leaves Hardhat and Vite running in the foreground. Press Ctrl+C in this terminal to terminate them." -ForegroundColor Cyan
