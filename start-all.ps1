<#
Start-All.ps1

Opens separate PowerShell windows for common local development tasks:
- Hardhat node (local JSON-RPC)
- Deploy contracts and copy ABIs to `front/src/utils/contracts`
- Frontend dev server (front/)
- Run tests (npm test)

Usage: Open a PowerShell prompt in the repo root and run:
  .\start-all.ps1

This script uses `Start-Process` to open new PowerShell windows so logs are visible independently.
Adjust paths or commands if your environment differs (e.g., `npm` vs `pnpm`).
#>

function Start-Terminal($title, $command, $workdir) {
  # Use a single-quoted format string so any $variables inside the provided command
  # (for example the loop variable `$i`) are not expanded by this outer script.
  $psArgs = "-NoExit", "-Command", 'Write-Host ''[{0}]'' -ForegroundColor Cyan; Set-Location ''{1}''; {2}' -f $title, ($workdir -replace "'","''"), $command
  Start-Process powershell -ArgumentList $psArgs -WindowStyle Normal
}

$root = $PSScriptRoot

# A - Evidence storage: this repository does not run a local IPFS/pin-server by default.
# Evidence payloads are expected to be stored off-chain and the contract stores only a
# keccak256 digest. Admin-side decryption/helpers are located under `tools/admin` and
# must run in a trusted environment (do NOT bundle admin private keys into the frontend).

# B - Hardhat node
Start-Terminal "Hardhat" "npx hardhat node" "$root"

# C - Deploy contracts & copy ABIs to frontend utils (copy only if artifacts exist)
# Wait for Hardhat JSON-RPC (http://127.0.0.1:8545) to be available before running deploy.
# This avoids racing the deploy step with the Hardhat node startup. Times out after 60s.
Start-Terminal "Deploy" "for ($i=0; $i -lt 60; $i++) { try { Invoke-WebRequest -Uri 'http://127.0.0.1:8545' -UseBasicParsing -TimeoutSec 2 > \$null; Write-Host 'Hardhat RPC available' -ForegroundColor Green; break } catch { if ($i -eq 0) { Write-Host 'Waiting for Hardhat RPC at http://127.0.0.1:8545 ...' -ForegroundColor Cyan } Start-Sleep -Seconds 1 } } ; if ($i -ge 60) { Write-Host 'Timed out waiting for Hardhat RPC (60s). Proceeding with deploy anyway.' -ForegroundColor Yellow } ; node scripts/deploy.js" "$root"

# D - Frontend (Vite dev)
# start in the frontend folder; avoid an extra `cd front` which would create a `front\front` path
Start-Terminal "Frontend" "npm run dev" "$root\front"

# E - Integration Tests (run in repo root)
Start-Terminal "Tests" "npm test" "$root"

Write-Host "Launched background terminals. Check individual windows for logs." -ForegroundColor Green









