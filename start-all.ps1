# V7 Development Environment Startup Script - Final Version
# ArbiTrust V7 with CCIP Oracle Integration

Write-Host "Starting ArbiTrust V7 Development Environment with CCIP Oracle" -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green

function Start-NewWindow {
    param(
        [string]$Title,
        [string]$Command,
        [string]$WorkingDirectory = (Get-Location)
    )
    
    Write-Host "Starting $Title..." -ForegroundColor Yellow
    $argumentList = @("-NoExit", "-Command", "cd '$WorkingDirectory'; $Command")
    Start-Process -FilePath "powershell.exe" -ArgumentList $argumentList -WindowStyle Normal
    Start-Sleep 2
}

# Load .env variables
if (Test-Path .env) {
    Write-Host "Loading .env variables..." -ForegroundColor Gray
    Get-Content .env | ForEach-Object {
        if ($_ -match '^[ \t]*#') { return }
        if ($_ -match '^\s*$') { return }
        if ($_ -match '^(?<k>[A-Za-z_][A-Za-z0-9_]*)=(?<v>.*)$') {
            $k = $matches['k']
            $v = $matches['v']
            # Trim surrounding quotes if present
            if ($v.Length -ge 2) {
                if ($v.StartsWith('"') -and $v.EndsWith('"')) {
                    $v = $v.Substring(1, $v.Length - 2)
                } elseif ($v[0] -eq "'" -and $v[$v.Length - 1] -eq "'") {
                    $v = $v.Substring(1, $v.Length - 2)
                }
            }
            $existing = [System.Environment]::GetEnvironmentVariable($k, 'Process')
            if (-not $existing -or $existing -eq "") {
                [System.Environment]::SetEnvironmentVariable($k, $v, 'Process')
                Write-Host "  + $k" -ForegroundColor DarkGray
            }
        }
    }
}

Write-Host ""
Write-Host "Checking environment..." -ForegroundColor Cyan

try {
    $nodeVersion = & node --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "Node.js not found" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
} catch {
    Write-Host "Node.js not found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""



Write-Host ""
Write-Host "Starting services..." -ForegroundColor Cyan

# Check for mainnet fork URL
    Write-Host "Starting Hardhat node with mainnet fork..." -ForegroundColor Yellow
        Start-NewWindow "Hardhat Node" "npx hardhat node "

# (You may want to add logic here to check for forkUrl and use else as needed)
# else {
#     Write-Host "Starting Hardhat node (local, no fork)..." -ForegroundColor Yellow
#     Write-Host "Note: Running without mainnet fork. CCIP contracts will be mocked." -ForegroundColor Orange
#     Start-NewWindow "Hardhat Node" "npx hardhat node"
# }

Write-Host "Waiting for Hardhat node to start..." -ForegroundColor Yellow
$retryCount = 0
$maxRetries = 30
do {
    Start-Sleep 2
    $retryCount++
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8545" -Method POST -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' -ContentType "application/json" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "Hardhat node is ready!" -ForegroundColor Green
            break
        }
    } catch {
        # Continue waiting
    }
    
    if ($retryCount -ge $maxRetries) {
        Write-Host "Hardhat node failed to start within 60 seconds" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "Waiting... ($retryCount/$maxRetries)" -ForegroundColor Gray
} while ($true)



Write-Host "Deploying contracts..." -ForegroundColor Yellow
# Ensure we are in the project root before deploying
Set-Location "$PSScriptRoot"
npx hardhat run scripts/deploy.js --network localhost
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Deployment failed (exit code $LASTEXITCODE)" -ForegroundColor Red
} else {
    Write-Host "Contracts deployed successfully" -ForegroundColor Green
}

Start-Sleep 3
Start-NewWindow "V7 Backend" "cd server; node index.js"
Start-Sleep 3
Start-NewWindow "Frontend" "cd front; npm run dev"
Start-Sleep 3
Start-NewWindow "Tests" "npx hardhat test"

Write-Host ""
Write-Host "ArbiTrust V7 Started Successfully!" -ForegroundColor Green
Write-Host "Hardhat: http://localhost:8545" -ForegroundColor White
Write-Host "Backend: http://localhost:3002" -ForegroundColor White  
Write-Host "Frontend: http://localhost:5173" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
