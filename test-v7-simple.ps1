# V7 Backend Testing Script
# Runs comprehensive tests for V7 Backend + CCIP Oracle integration

Write-Host "🧪 V7 Backend Testing Suite" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""

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
$hardhatRunning = $false
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8545" -Method POST -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' -ContentType "application/json" -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Hardhat node is running" -ForegroundColor Green
        $hardhatRunning = $true
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

# 1. Server Module Tests
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
        $testResults += @{Name=$module.Name; Passed=$false}
    }
}

# 2. Backend Standalone Tests with Mocha
Write-Host ""
Write-Host "🌐 Running Backend Standalone Tests..." -ForegroundColor Cyan

if (Test-Path "test/V7BackendStandalone.test.js") {
    Write-Host "🔬 Testing Backend Standalone..." -ForegroundColor Yellow
    try {
        & npx mocha test/V7BackendStandalone.test.js --timeout 120000 --reporter spec
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Backend Standalone - PASSED" -ForegroundColor Green
            $testResults += @{Name="Backend Standalone"; Passed=$true}
        } else {
            Write-Host "❌ Backend Standalone - FAILED" -ForegroundColor Red
            $testResults += @{Name="Backend Standalone"; Passed=$false}
        }
    } catch {
        Write-Host "❌ Backend Standalone - ERROR: $_" -ForegroundColor Red
        $testResults += @{Name="Backend Standalone"; Passed=$false}
    }
} else {
    Write-Host "⚠️ Backend Standalone test not found" -ForegroundColor Orange
}

# 3. Key Contract Tests (if Hardhat is running)
if ($hardhatRunning) {
    Write-Host ""
    Write-Host "🏗️ Running Key Contract Tests..." -ForegroundColor Cyan

    $contractTests = @(
        "test/MerkleEvidence.test.js",
        "test/Factory.test.js", 
        "test/EvidenceUtilities.test.js"
    )

    foreach ($testFile in $contractTests) {
        if (Test-Path $testFile) {
            $testName = (Split-Path $testFile -Leaf) -replace ".test.js", ""
            Write-Host "🔬 Testing $testName..." -ForegroundColor Yellow
            try {
                & npx hardhat test $testFile
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✅ $testName - PASSED" -ForegroundColor Green
                    $testResults += @{Name=$testName; Passed=$true}
                } else {
                    Write-Host "❌ $testName - FAILED" -ForegroundColor Red
                    $testResults += @{Name=$testName; Passed=$false}
                }
            } catch {
                Write-Host "❌ $testName - ERROR: $_" -ForegroundColor Red
                $testResults += @{Name=$testName; Passed=$false}
            }
        }
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

if ($passed + $failed -gt 0) {
    $successRate = [math]::Round(($passed / ($passed + $failed)) * 100, 1)
    Write-Host "   Success Rate: $successRate%" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Orange" })
}

if ($failed -eq 0 -and $passed -gt 0) {
    Write-Host ""
    Write-Host "🎉 All tests passed! V7 Backend is ready for production." -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "⚠️ Some tests failed or no tests ran. Please review and fix issues." -ForegroundColor Orange
    exit 1
}