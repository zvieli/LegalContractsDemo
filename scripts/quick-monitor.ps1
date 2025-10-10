#!/usr/bin/env pwsh
# Quick Performance Monitor for ArbiTrust V7

Write-Host "📊 ArbiTrust V7 - Quick Performance Monitor" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3001"
$healthEndpoint = "$baseUrl/api/v7/arbitration/ollama/health"
$testEndpoint = "$baseUrl/api/v7/arbitration/ollama"

function Test-QuickResponse {
    $payload = @{
        disputeDescription = "Quick test - who wins?"
        evidenceData = "Simple evidence for performance testing"
        contractType = "NDA"
    } | ConvertTo-Json
    
    $start = Get-Date
    try {
        $response = Invoke-RestMethod -Uri $testEndpoint -Method POST -Body $payload -ContentType "application/json" -TimeoutSec 30
        $end = Get-Date
        $duration = ($end - $start).TotalSeconds
        
        return @{
            success = $true
            duration = $duration
            llmUsed = $response.llm_used
            model = $response.model
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
Write-Host "⏳ Waiting for server..."
do {
    Start-Sleep -Seconds 3
    try {
        $health = Invoke-RestMethod -Uri $healthEndpoint -Method GET -TimeoutSec 5
        if ($health.healthy) {
            Write-Host "✅ Server ready!"
            break
        }
    } catch {
        Write-Host "⌛ Still waiting..."
    }
} while ($true)

# Run quick tests
Write-Host "`n🚀 Running quick performance tests..."
$testResults = @()

for ($i = 1; $i -le 3; $i++) {
    Write-Host "Test $i/3..." -NoNewline
    $result = Test-QuickResponse
    $testResults += $result
    
    if ($result.success) {
        Write-Host " ✅ $([Math]::Round($result.duration, 1))s (LLM: $($result.llmUsed), Model: $($result.model))" -ForegroundColor Green
    } else {
        Write-Host " ❌ Failed after $([Math]::Round($result.duration, 1))s" -ForegroundColor Red
    }
    
    if ($i -lt 3) { Start-Sleep -Seconds 2 }
}

# Summary
$successfulTests = $testResults | Where-Object { $_.success }
$avgDuration = ($successfulTests | Measure-Object -Property duration -Average).Average

Write-Host "`n📈 QUICK PERFORMANCE SUMMARY:" -ForegroundColor Yellow
Write-Host "Successful tests: $($successfulTests.Count)/3" -ForegroundColor White
Write-Host "Average response time: $([Math]::Round($avgDuration, 2)) seconds" -ForegroundColor White
Write-Host "LLM consistently used: $(($successfulTests | Where-Object { $_.llmUsed }).Count -eq $successfulTests.Count)" -ForegroundColor White

if ($avgDuration -lt 10) {
    Write-Host "✅ Performance is GOOD!" -ForegroundColor Green
} elseif ($avgDuration -lt 20) {
    Write-Host "⚠️  Performance is ACCEPTABLE" -ForegroundColor Yellow
} else {
    Write-Host "❌ Performance needs OPTIMIZATION" -ForegroundColor Red
}

Write-Host "`nMonitor will continue running. Press Ctrl+C to stop." -ForegroundColor Gray