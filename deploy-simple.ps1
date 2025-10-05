# Simple deployment script for manual testing
Write-Host "Starting deployment process..." -ForegroundColor Green

# Start Hardhat node in background
Write-Host "1. Starting Hardhat node..." -ForegroundColor Yellow
Start-Job -ScriptBlock { 
    Set-Location "C:\Users\user\vsc\blockchain\LegalContractsDemo"
    npm run node 
} -Name "HardhatNode"

Start-Sleep 10

# Deploy contracts
Write-Host "2. Deploying contracts..." -ForegroundColor Yellow
try {
    npm run deploy:localhost
    Write-Host "Contracts deployed successfully!" -ForegroundColor Green
} catch {
    Write-Host "Deployment failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Copy ABIs
Write-Host "3. Copying ABIs to frontend..." -ForegroundColor Yellow
npm run copy-abi

# Start backend server
Write-Host "4. Starting V7 Backend server..." -ForegroundColor Yellow
Start-Job -ScriptBlock { 
    Set-Location "C:\Users\user\vsc\blockchain\LegalContractsDemo\server"
    node start-v7.js 
} -Name "V7Backend"

Start-Sleep 5

Write-Host "Setup complete! You can now:" -ForegroundColor Green
Write-Host "  - Start frontend: cd front && npm run dev" -ForegroundColor Gray
Write-Host "  - Run tests: npm test" -ForegroundColor Gray
Write-Host "  - Node running at: http://127.0.0.1:8545" -ForegroundColor Gray
Write-Host "  - Backend API base: http://localhost:3001/api/v7" -ForegroundColor Gray
Write-Host "  - Check backend health: http://localhost:3001/api/v7/health" -ForegroundColor Gray