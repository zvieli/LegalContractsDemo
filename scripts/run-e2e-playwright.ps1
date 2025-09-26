# Start evidence endpoint, simple static server, run Playwright tests, then clean up
param(
  [int]$EndpointPort = 3003,
  [int]$StaticPort = 5173
)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# repo root is parent of scripts directory
$repo = Split-Path -Parent $scriptDir
Push-Location $repo

Write-Host "Starting evidence endpoint on port $EndpointPort"
$env:DOTENV_CONFIG_PATH = Join-Path $repo '.env'
$endpointProc = Start-Process -FilePath node -ArgumentList "-r dotenv/config","$repo\\tools\\evidence-endpoint.cjs","$EndpointPort","$repo\\front\\e2e\\static" -WorkingDirectory $repo -PassThru
Start-Sleep -Seconds 1

Write-Host "Starting simple static server on port $StaticPort"
$staticProc = Start-Process -FilePath node -ArgumentList "$repo\\tools\\simple-static-server.cjs", "$StaticPort", "$repo\\front\\dist" -WorkingDirectory $repo -PassThru
Start-Sleep -Seconds 1

try {
  Write-Host "Running Playwright tests"
  # Run Playwright from the front directory so it automatically picks up front/playwright.config.js
  Push-Location (Join-Path $repo 'front')
  try {
    npx playwright test
  } finally {
    Pop-Location
  }
} finally {
  Write-Host "Cleaning up processes"
  try { Stop-Process -Id $endpointProc.Id -ErrorAction SilentlyContinue } catch {}
  try { Stop-Process -Id $staticProc.Id -ErrorAction SilentlyContinue } catch {}
  Pop-Location
}
