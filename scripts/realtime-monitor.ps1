#!/usr/bin/env pwsh
# Real-time Performance Monitoring

Write-Host "⏱️  ArbiTrust V7 - Real-time Performance Monitor" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$healthUrl = "http://localhost:3001/api/v7/arbitration/ollama/health"
$testUrl = "http://localhost:3001/api/v7/arbitration/ollama"

# Test payloads
$testCases = @(
    @{
        name = "Quick Test"
        payload = @{
            disputeDescription = "Fast test"
            evidenceData = "Quick evidence"
            contractType = "NDA"
        }
    },
    @{
        name = "Context Test"  
        payload = @{
            disputeDescription = "Context preservation test"
            evidenceData = "TechCorp and DataAnalytics have an NDA dispute over SmartAnalyzer Pro involving John Martinez and 40% efficiency gains discovered on September 15th"
            contractType = "NDA"
        }
    }
)

function Test-Performance {
    param($testCase)
    
    $json = $testCase.payload | ConvertTo-Json
    $start = Get-Date
    
    try {
        $response = Invoke-RestMethod -Uri $testUrl -Method POST -Body $json -ContentType "application/json" -TimeoutSec 45
        $end = Get-Date
        $duration = ($end - $start).TotalSeconds
        
        # Check context preservation for context test
        $contextPreserved = $false
        if ($testCase.name -eq "Context Test") {
            $contextPreserved = ($response.reasoning -like "*TechCorp*") -and 
                               ($response.reasoning -like "*DataAnalytics*") -and
                               ($response.reasoning -like "*SmartAnalyzer*")
        }
        
        return @{
            success = $true
            duration = $duration
            llmUsed = $response.llm_used
            model = $response.model
            decision = $response.decision
            contextPreserved = $contextPreserved
        }
    } catch {
        $end = Get-Date
        $duration = ($end - $start).TotalSeconds
        return @{
            success = $false
            duration = $duration
            error = $_.Exception.Message
        }
    }
}

# Wait for server
Write-Host "🔍 Checking server status..."
do {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -Method GET -TimeoutSec 5
        if ($health.healthy) {
            Write-Host "✅ Server is healthy - Model: $($health.model)" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "⏳ Waiting for server..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
    }
} while ($true)

# Continuous monitoring
Write-Host "`n🚀 Starting continuous performance monitoring..."
Write-Host "Press Ctrl+C to stop monitoring`n" -ForegroundColor Gray

$testCount = 0
$successCount = 0
$totalDuration = 0
$llmUsageCount = 0

while ($true) {
    $testCount++
    $currentTime = Get-Date -Format "HH:mm:ss"
    
    # Alternate between test cases
    $testCase = $testCases[($testCount - 1) % $testCases.Count]
    
    Write-Host "[$currentTime] Test #$testCount - $($testCase.name)..." -NoNewline -ForegroundColor White
    
    $result = Test-Performance -testCase $testCase
    
    if ($result.success) {
        $successCount++
        $totalDuration += $result.duration
        if ($result.llmUsed) { $llmUsageCount++ }
        
        $status = "✅"
        $color = "Green"
        if ($result.duration -gt 15) { $color = "Yellow"; $status = "⚠️" }
        if ($result.duration -gt 30) { $color = "Red"; $status = "❌" }
        
        Write-Host " $status $([Math]::Round($result.duration, 1))s" -ForegroundColor $color -NoNewline
        Write-Host " | LLM: $($result.llmUsed)" -ForegroundColor White -NoNewline
        Write-Host " | Decision: $($result.decision)" -ForegroundColor Gray -NoNewline
        
        if ($testCase.name -eq "Context Test" -and $result.contextPreserved) {
            Write-Host " | Context: ✅" -ForegroundColor Green
        } elseif ($testCase.name -eq "Context Test") {
            Write-Host " | Context: ❌" -ForegroundColor Red
        } else {
            Write-Host ""
        }
    } else {
        Write-Host " ❌ Failed ($([Math]::Round($result.duration, 1))s): $($result.error)" -ForegroundColor Red
    }
    
    # Show running statistics every 5 tests
    if ($testCount % 5 -eq 0) {
        $avgDuration = if ($successCount -gt 0) { $totalDuration / $successCount } else { 0 }
        $successRate = [Math]::Round(($successCount / $testCount) * 100, 1)
        $llmRate = if ($successCount -gt 0) { [Math]::Round(($llmUsageCount / $successCount) * 100, 1) } else { 0 }
        
        Write-Host "`n📊 RUNNING STATS (after $testCount tests):" -ForegroundColor Cyan
        Write-Host "   Success Rate: $successRate% ($successCount/$testCount)" -ForegroundColor White
        Write-Host "   Avg Response Time: $([Math]::Round($avgDuration, 2))s" -ForegroundColor White
        Write-Host "   LLM Usage Rate: $llmRate%" -ForegroundColor White
        Write-Host ""
    }
    
    # Wait before next test
    Start-Sleep -Seconds 10
}