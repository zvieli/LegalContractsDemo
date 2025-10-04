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

try {
    Write-Host "Step 1: Starting Hardhat Local Node..." -ForegroundColor Cyan
    Start-NewWindow -Title "Hardhat Node" -Command "npm run node"
    
    Write-Host "Waiting for node to initialize..." -ForegroundColor Yellow
    Start-Sleep 10
    
    Write-Host "Step 2: Deploying Contracts..." -ForegroundColor Cyan
    Start-NewWindow -Title "Deploy Contracts" -Command "npm run deploy:localhost"
    
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
    Write-Host "  Hardhat Node: http://127.0.0.1:8545" -ForegroundColor Gray
    Write-Host "  V7 Backend: http://localhost:3001" -ForegroundColor Gray
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
    Write-Host "  POST /api/v7/evidence/upload - Evidence upload with encryption" -ForegroundColor Gray
    Write-Host "  GET /api/v7/evidence/{id} - Evidence retrieval" -ForegroundColor Gray
    Write-Host "  POST /api/v7/arbitration/decision - LLM arbitration decisions" -ForegroundColor Gray
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