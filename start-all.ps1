# V7 Development Environment Startup Script
Write-Host "Starting V7 LegalContractsDemo Development Environment" -ForegroundColor Green

# Function to start a new PowerShell window with a command
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

# Load .env variables (non-destructive: don't override already-set env vars)
if (Test-Path .env) {
    Write-Host "Loading .env variables..." -ForegroundColor Gray
    Get-Content .env | ForEach-Object {
        if ($_ -match '^[ \t]*#') { return }
        if ($_ -match '^\s*$') { return }
        if ($_ -match '^(?<k>[A-Za-z_][A-Za-z0-9_]*)=(?<v>.*)$') {
            $k = $matches['k']
            $v = $matches['v']
            # Trim surrounding quotes (single or double) if present
            if ($v.Length -ge 2) {
                if ($v.StartsWith('"') -and $v.EndsWith('"')) {
                    $v = $v.Substring(1, $v.Length - 2)
                } elseif ($v[0] -eq "'" -and $v[$v.Length - 1] -eq "'") {
                    $v = $v.Substring(1, $v.Length - 2)
                }
            }
            $existing = [System.Environment]::GetEnvironmentVariable($k, 'Process')
            if (-not $existing) {
                [System.Environment]::SetEnvironmentVariable($k, $v, 'Process')
                Write-Host "  + $k (set)" -ForegroundColor DarkGray
            } else {
                Write-Host "  - $k (preserved existing)" -ForegroundColor DarkGray
            }
        }
    }
}

try {
    # Support a mode to only probe the existing node without restarting processes
    $onlyProbe = $env:ONLY_PROBE_FORK -and $env:ONLY_PROBE_FORK -ne '0'
    if (-not $onlyProbe) {
        Write-Host "Step 1: Starting Hardhat Forked Mainnet Node..." -ForegroundColor Cyan
        # SECURITY: If you hardcode your Alchemy/Infura endpoint here, add start-all.ps1 to .gitignore!
        $forkUrl = $env:MAINNET_FORK_URL
        if (-not $forkUrl -or $forkUrl.Trim() -eq "") {
            # Explicit Alchemy endpoint for mainnet fork
            $forkUrl = "https://eth-mainnet.g.alchemy.com/v2/C71xjjRnVc5bmInmm-AQ3"
            Write-Host "MAINNET_FORK_URL not set. Using explicit Alchemy endpoint for fork." -ForegroundColor Yellow
        } else {
            Write-Host "Using fork URL: $forkUrl" -ForegroundColor Gray
        }
        if ($forkUrl) {
            Start-NewWindow -Title "Hardhat Node (Fork)" -Command "npx hardhat node --fork '$forkUrl'"
        } else {
            Start-NewWindow -Title "Hardhat Node (Config Fork)" -Command "npx hardhat node"
        }
        Write-Host "Waiting for node to initialize..." -ForegroundColor Yellow
        Start-Sleep 10
    } else {
        Write-Host "ONLY_PROBE_FORK=1 -> Skipping process launches; probing existing node." -ForegroundColor Yellow
    }

    function Invoke-EthRpc {
        param(
            [string]$Method,
            [object[]]$Params
        )
        $payload = @{ jsonrpc = '2.0'; id = (Get-Random); method = $Method; params = $Params } | ConvertTo-Json -Compress
        try {
            return Invoke-RestMethod -Uri 'http://127.0.0.1:8545' -Method POST -Body $payload -ContentType 'application/json' -TimeoutSec 5
        } catch {
            return $null
        }
    }

    if (-not $env:SKIP_FORK_PROBE -or $env:SKIP_FORK_PROBE -eq '0') {
        Write-Host "Verifying fork (native JSON-RPC)..." -ForegroundColor Cyan
        $FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'
        $WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
        $attempts = 0; $maxAttempts = 6; $success = $false
        while (-not $success -and $attempts -lt $maxAttempts) {
            $attempts++
            $blockResp = Invoke-EthRpc -Method 'eth_blockNumber' -Params @()
            $feedResp  = Invoke-EthRpc -Method 'eth_getCode' -Params @($FEED, 'latest')
            $wethResp  = Invoke-EthRpc -Method 'eth_getCode' -Params @($WETH, 'latest')
            if (-not $blockResp -or -not $feedResp -or -not $wethResp) {
                Write-Host "  Probe attempt $($attempts)/$($maxAttempts): node not ready yet..." -ForegroundColor DarkYellow
                Start-Sleep 5
                continue
            }
            $blockHex = $blockResp.result
            $block = [int]($blockHex)  # PowerShell auto parses 0x
            $feedCode = $feedResp.result
            $wethCode = $wethResp.result
            $feedHasCode = ($feedCode -ne '0x')
            $wethHasCode = ($wethCode -ne '0x')
            if ($feedHasCode -and $wethHasCode) {
                Write-Host ("Fork OK: block={0} feedHasCode={1} wethHasCode={2}" -f $block, $feedHasCode, $wethHasCode) -ForegroundColor Green
            } else {
                Write-Host ("Fork WARNING: block={0} feedHasCode={1} wethHasCode={2}" -f $block, $feedHasCode, $wethHasCode) -ForegroundColor Yellow
                if (-not $feedHasCode) { Write-Host "   Missing code at Chainlink ETH/USD feed address." -ForegroundColor Yellow }
                if (-not $wethHasCode) { Write-Host "   Missing code at WETH address." -ForegroundColor Yellow }
            }
            $success = $true
        }
        if (-not $success) {
            Write-Host "Fork probe failed after $maxAttempts attempts (node may not be running or port in use)." -ForegroundColor Red
        }
    } else {
        Write-Host "Skipping fork probe (SKIP_FORK_PROBE=1)" -ForegroundColor Yellow
    }
    
    if ($onlyProbe) { return }

    Write-Host "Step 2: Deploying Contracts to localhost node..." -ForegroundColor Cyan
    $deployOut = & cmd /c "npx hardhat run scripts/deploy.js --network localhost" 2>&1
    $deployExit = $LASTEXITCODE
    Write-Host $deployOut
    if ($deployExit -ne 0) {
        Write-Host "❌ Deployment failed with exit code $deployExit. See above for error." -ForegroundColor Red
        Write-Host "Press any key to exit..." -ForegroundColor Yellow
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        exit $deployExit
    }
    Write-Host "Waiting for deployment..." -ForegroundColor Yellow
    Start-Sleep 8
    
    Write-Host "Step 3: Starting V7 Backend Server..." -ForegroundColor Cyan
    Start-NewWindow -Title "V7 Backend" -Command "cd server; node start-v7.js"
    
    Write-Host "Waiting for backend to start..." -ForegroundColor Yellow
    Start-Sleep 5
    
    Write-Host "Step 4: Starting Frontend Development Server..." -ForegroundColor Cyan
    Start-NewWindow -Title "Frontend Server" -Command "cd front; npm run dev"
    
    Write-Host "Waiting for frontend to start..." -ForegroundColor Yellow
    Start-Sleep 5
    
    Write-Host "Step 5: Running Tests..." -ForegroundColor Cyan
    Start-NewWindow -Title "Test Runner" -Command "npm test"
    
    Write-Host "" -ForegroundColor Green
    Write-Host "Development Environment Started Successfully!" -ForegroundColor Green
    Write-Host "" -ForegroundColor Green
    Write-Host "Service Status:" -ForegroundColor White
    Write-Host "  Hardhat Node (Forked Mainnet): http://127.0.0.1:8545" -ForegroundColor Gray
    if ($forkUrl) { Write-Host "  Fork Source: $forkUrl" -ForegroundColor Gray }
    Write-Host "  V7 Backend API base: http://localhost:3001/api/v7" -ForegroundColor Gray
    Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Gray
    Write-Host "  Tests: Running in separate window" -ForegroundColor Gray
    Write-Host "  Gas Reports: Available in test output" -ForegroundColor Gray
    Write-Host "" -ForegroundColor Green
    Write-Host "Key Features Available:" -ForegroundColor White
    Write-Host "  EIP-712 Signature Verification" -ForegroundColor Gray
    Write-Host "  Dynamic Bond Calculation" -ForegroundColor Gray
    Write-Host "  Evidence Viewer with Multi-Gateway Support" -ForegroundColor Gray
    Write-Host "  Key Management Registry (NEW!)" -ForegroundColor Green
    Write-Host "  Enhanced UX with Error Help Modals" -ForegroundColor Gray
    Write-Host "  LLM-Driven Oracle Arbitration" -ForegroundColor Gray
    Write-Host "" -ForegroundColor Green
    Write-Host "Backend APIs Available:" -ForegroundColor White
    Write-Host "  POST /api/v7/dispute/report - Report dispute with evidence CID" -ForegroundColor Gray
    Write-Host "  POST /api/v7/dispute/appeal - Submit appeal with evidence CID" -ForegroundColor Gray
    Write-Host "  POST /api/v7/rent/calculate-payment - Calculate payment with late fees" -ForegroundColor Gray
    Write-Host "  POST /api/v7/arbitration/ollama - LLM arbitration (Ollama)" -ForegroundColor Gray
    Write-Host "  POST /api/v7/arbitration/simulate - Arbitration simulation mode" -ForegroundColor Gray
    Write-Host "  GET /api/v7/arbitration/ollama/health - Ollama service health check" -ForegroundColor Gray
    Write-Host "  GET /api/v7/arbitration/health - Arbitration service health check" -ForegroundColor Gray
    Write-Host "  GET /api/v7/debug/evidence/:cid - Validate evidence CID" -ForegroundColor Gray
    Write-Host "  GET /api/v7/debug/development-info - Backend development info" -ForegroundColor Gray
    Write-Host "  POST /api/v7/debug/ipfs/restart - Restart IPFS (dev mode)" -ForegroundColor Gray
    Write-Host "  GET /api/v7/debug/time/:timestamp - Get time-based data" -ForegroundColor Gray
    Write-Host "  GET /api/v7/health - System health check" -ForegroundColor Gray
    Write-Host "" -ForegroundColor Green
    Write-Host "Next Steps:" -ForegroundColor White
    Write-Host "  1. Open browser to http://localhost:5173" -ForegroundColor Gray
    Write-Host "  2. Connect MetaMask to localhost:8545 (Chain ID: 31337)" -ForegroundColor Gray
    Write-Host "  3. Import test accounts from WALLETS.txt" -ForegroundColor Gray
    Write-Host "  4. Test key management, evidence upload, and arbitration" -ForegroundColor Gray
    Write-Host "  5. Check backend health: http://localhost:3001/api/v7/health" -ForegroundColor Gray
    Write-Host "" -ForegroundColor Green
    Write-Host "Press any key to continue..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    
} catch {
    Write-Host "Error starting development environment: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Press any key to exit..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}