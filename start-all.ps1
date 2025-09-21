# start-all.ps1
# Script to start the DApp stack in separate PowerShell windows (IPFS, Hardhat, Deploy, Frontend, Tests)

function Start-Terminal($title, $command, $workdir) {
    $args = @("-NoExit", "-Command", "Write-Host '[$title]' -ForegroundColor Cyan; $command")
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        # PowerShell 7+ preserves working directory with -WorkingDirectory
        if ($workdir) {
            Start-Process pwsh -ArgumentList $args -WorkingDirectory $workdir -WindowStyle Normal
        } else {
            Start-Process pwsh -ArgumentList $args -WindowStyle Normal
        }
    } else {
        # Windows PowerShell
        if ($workdir) {
            Start-Process powershell -ArgumentList $args -WorkingDirectory $workdir -WindowStyle Normal
        } else {
            Start-Process powershell -ArgumentList $args -WindowStyle Normal
        }
    }
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

# A - IPFS node (use compose file in tools/ipfs)
$ipfsCmd = "docker compose -f \"$repoRoot\tools\ipfs\docker-compose.yml\" up -d; Write-Host 'IPFS compose started'"
Start-Terminal "IPFS" $ipfsCmd $repoRoot

# B - Hardhat node
$hardhatCmd = "npx hardhat node"
Start-Terminal "Hardhat" $hardhatCmd $repoRoot

# C - Deploy contracts & copy ABIs (waits for Hardhat RPC on 127.0.0.1:8545)
$deployCmd = @"
while (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 8545 -InformationLevel Quiet)) {
  Write-Host 'Waiting for Hardhat RPC on 127.0.0.1:8545...'; Start-Sleep -Seconds 1
}
Write-Host 'Hardhat RPC available, running deploy...'
npx hardhat run scripts/deploy.js --network localhost
Write-Host 'Deploy finished'
"@
Start-Terminal "Deploy" $deployCmd $repoRoot

# D - Frontend dev server (Vite)
# Note: frontend folder is `front`
$frontendCmd = "cd front; npm run dev"
Start-Terminal "Frontend" $frontendCmd $repoRoot

# E - Integration / Unit Tests (optional)
$testsCmd = "npm test"
Start-Terminal "Tests" $testsCmd $repoRoot

Write-Host 'Launched all windows. Monitor each window for progress.' -ForegroundColor Green
