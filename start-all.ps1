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

# Cleanup old ABIs and generated contract artifacts to avoid ABI mismatch
function Clean-CompiledAbis {
    param(
        [string]$ProjectRoot
    )
    if (-not $ProjectRoot) { $ProjectRoot = Get-Location }
    Write-Host "Cleaning compiled ABIs to avoid ABI/deployment mismatches..." -ForegroundColor Yellow

    $frontContracts = Join-Path $ProjectRoot 'front\src\utils\contracts'
    $serverConfig = Join-Path $ProjectRoot 'server\config'
    $serverConfigContracts = Join-Path $serverConfig 'contracts'

    # Remove files inside front/src/utils/contracts (keep directory)
    if (Test-Path $frontContracts) {
        try {
            $fList = Get-ChildItem -Path $frontContracts -File -Force -ErrorAction Stop
            if ($fList.Count -gt 0) {
                foreach ($f in $fList) {
                    Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
                    Write-Host "  Removed front ABI: $($f.Name)" -ForegroundColor DarkGray
                }
            } else { Write-Host "  No files to remove in $frontContracts" -ForegroundColor DarkGray }
        } catch {
            Write-Host ("  Failed cleaning " + $frontContracts + ": " + $_) -ForegroundColor Red
        }
    } else { Write-Host "  Path not found: $frontContracts" -ForegroundColor DarkGray }

    # Remove files directly under server/config but preserve server/config/contracts directory itself
    if (Test-Path $serverConfig) {
        try {
            $items = Get-ChildItem -Path $serverConfig -Force -ErrorAction Stop
            foreach ($it in $items) {
                if ($it.PSIsContainer) {
                    # Preserve the 'contracts' directory name, remove contents if it exists
                    if ($it.Name -ieq 'contracts') {
                        if (Test-Path $serverConfigContracts) {
                            try {
                                $inner = Get-ChildItem -Path $serverConfigContracts -File -Force
                                foreach ($f in $inner) {
                                    Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
                                    Write-Host "  Removed server config contract file: $($f.Name)" -ForegroundColor DarkGray
                                }
                            } catch {
                                Write-Host ("  Failed cleaning " + $serverConfigContracts + ": " + $_) -ForegroundColor Red
                            }
                        }
                    } else {
                        # leave other directories untouched
                        Write-Host "  Preserving directory: $($it.Name)" -ForegroundColor DarkGray
                    }
                } else {
                    # it's a file directly under server/config -> remove it
                    try {
                        Remove-Item -LiteralPath $it.FullName -Force -ErrorAction SilentlyContinue
                        Write-Host "  Removed server config file: $($it.Name)" -ForegroundColor DarkGray
                    } catch {
                        Write-Host ("  Failed removing " + $($it.FullName) + ": " + $_) -ForegroundColor Red
                    }
                }
            }
        } catch {
            Write-Host ("  Failed enumerating " + $serverConfig + ": " + $_) -ForegroundColor Red
        }
    } else { Write-Host "  Path not found: $serverConfig" -ForegroundColor DarkGray }

    Write-Host "Cleanup complete." -ForegroundColor Green
}

# Run cleanup before starting services to ensure ABI consistency
Clean-CompiledAbis -ProjectRoot $PSScriptRoot

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
Start-NewWindow "V7 Backend" "cd server; node start-v7.js"
Start-Sleep 3
Start-NewWindow "Frontend" "cd front; npm run dev"
Start-Sleep 3
Start-NewWindow "Tests" "npx hardhat test"

Write-Host ""
Write-Host "ArbiTrust V7 Started Successfully!" -ForegroundColor Green
Write-Host "Hardhat: http://localhost:8545" -ForegroundColor White
Write-Host "Backend: http://localhost:3001" -ForegroundColor White
Write-Host "Frontend: http://localhost:5173" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
