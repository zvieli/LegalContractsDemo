#!/usr/bin/env powershell
# V7 Backend Testing Script
# Runs comprehensive tests for V7 Backend + CCIP Oracle integration

Write-Host "🧪 V7 Backend Testing Suite" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""

# Function to run test with error handling
function Run-Test {
    param(
        [string]$TestName,
        [string]$TestFile,
        [string]$Description
    )
    
    Write-Host "🔬 Running $TestName..." -ForegroundColor Cyan
    Write-Host "   $Description" -ForegroundColor Gray
    
    try {
        $result = & npx mocha $TestFile --timeout 120000 --reporter spec
        $exitCode = $LASTEXITCODE
        
        if ($exitCode -eq 0) {
            Write-Host "✅ $TestName - PASSED" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ $TestName - FAILED" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "❌ $TestName - ERROR: $_" -ForegroundColor Red
        return $false
    }
}

# Check prerequisites
Write-Host "🔍 Checking prerequisites..." -ForegroundColor Yellow

# Check if we're in the right directory
if (-not (Test-Path "package.json")) {
    Write-Host "❌ Error: Not in project root directory" -ForegroundColor Red
    Write-Host "Please run this script from the LegalContractsDemo root directory" -ForegroundColor Red
    exit 1
}

# Check Node.js
try {
    $nodeVersion = & node --version
    Write-Host "✅ Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found" -ForegroundColor Red
    exit 1
}

# Check if Hardhat node is running
Write-Host "🌐 Checking Hardhat node..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8545" -Method POST -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Hardhat node is running" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️ Hardhat node not detected - some tests may fail" -ForegroundColor Orange
    Write-Host "To start Hardhat node: npx hardhat node --fork $env:MAINNET_FORK_URL" -ForegroundColor Gray
}

# Check if Ollama is running
Write-Host "🤖 Checking Ollama LLM..." -ForegroundColor Yellow
try {
    $ollamaResponse = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 5 -ErrorAction Stop
    if ($ollamaResponse.StatusCode -eq 200) {
        Write-Host "✅ Ollama LLM is accessible" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️ Ollama not detected - LLM tests may fail" -ForegroundColor Orange
    Write-Host "To start Ollama: ollama serve" -ForegroundColor Gray
}

Write-Host ""
Write-Host "🚀 Starting V7 Backend Tests..." -ForegroundColor Green
Write-Host ""

# Test results tracking
$testResults = @()

# 1. Backend Standalone Tests
$standalone = Run-Test `
    "Backend Standalone" `
    "test/V7BackendStandalone.test.js" `
    "Tests V7 backend modules independently"
$testResults += @{Name="Backend Standalone"; Passed=$standalone}

# 2. Server Module Tests
Write-Host ""
Write-Host "🔧 Running Server Module Tests..." -ForegroundColor Cyan

$modules = @(
    @{Name="LLM Module"; File="server/test/testLLM.js"; Desc="Ollama LLM integration"},
    @{Name="Evidence Module"; File="server/test/testEvidence.js"; Desc="IPFS evidence validation"},
    @{Name="Time Module"; File="server/test/testTime.js"; Desc="Time utilities"}
)

foreach ($module in $modules) {
    if (Test-Path $module.File) {
        Write-Host "🔬 Testing $($module.Name)..." -ForegroundColor Yellow
        try {
            & node $module.File
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ $($module.Name) - PASSED" -ForegroundColor Green
                $testResults += @{Name=$module.Name; Passed=$true}
            } else {
                Write-Host "❌ $($module.Name) - FAILED" -ForegroundColor Red
                $testResults += @{Name=$module.Name; Passed=$false}
            }
        } catch {
            Write-Host "❌ $($module.Name) - ERROR: $_" -ForegroundColor Red
            $testResults += @{Name=$module.Name; Passed=$false}
        }
    } else {
        Write-Host "⚠️ $($module.Name) - File not found: $($module.File)" -ForegroundColor Orange
    }
}

# 3. Integration Tests (if Hardhat is running)
if ($response) {
    Write-Host ""
    $integration = Run-Test `
        "CCIP Full Flow" `
        "test/V7BackendCCIPFullFlow.test.js" `
        "Complete E2E flow with CCIP Oracle integration"
    $testResults += @{Name="CCIP Full Flow"; Passed=$integration}
}

# 4. Existing Contract Tests (selective)
Write-Host ""
Write-Host "🏗️ Running Key Contract Tests..." -ForegroundColor Cyan

$contractTests = @(
    @{Name="Merkle Evidence"; File="test/MerkleEvidence.test.js"},
    @{Name="Factory"; File="test/Factory.test.js"},
    @{Name="Evidence Utilities"; File="test/EvidenceUtilities.test.js"}
)

foreach ($test in $contractTests) {
    if (Test-Path $test.File) {
        $result = Run-Test $test.Name $test.File "Contract functionality test"
        $testResults += @{Name=$test.Name; Passed=$result}
    }
}

# Results Summary
Write-Host ""
Write-Host "📊 Test Results Summary" -ForegroundColor Magenta
Write-Host "========================" -ForegroundColor Magenta

$passed = 0
$failed = 0

foreach ($result in $testResults) {
    if ($result.Passed) {
        Write-Host "✅ $($result.Name)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "❌ $($result.Name)" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "📈 Overall Results:" -ForegroundColor Yellow
Write-Host "   Passed: $passed tests" -ForegroundColor Green
Write-Host "   Failed: $failed tests" -ForegroundColor Red
Write-Host "   Success Rate: $([math]::Round(($passed / ($passed + $failed)) * 100, 1))%" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Orange" })

if ($failed -eq 0) {
    Write-Host ""
    Write-Host "🎉 All tests passed! V7 Backend is ready for production." -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "⚠️ Some tests failed. Please review and fix issues before proceeding." -ForegroundColor Orange
    exit 1
}