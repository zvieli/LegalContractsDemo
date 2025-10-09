# ArbiTrust V7 - Optimization Performance Tests
# Testing Ollama LLM Integration Performance

Write-Host "🚀 ArbiTrust V7 - Optimization Performance Tests" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# Test configurations
$baseUrl = "http://localhost:3001"
$ollamaEndpoint = "$baseUrl/api/v7/arbitration/ollama"
$healthEndpoint = "$baseUrl/api/v7/arbitration/ollama/health"

# Wait for server to be ready
function Wait-ForServer {
    Write-Host "⏳ Waiting for server to be ready..." -ForegroundColor Yellow
    $maxAttempts = 30
    $attempt = 0
    
    do {
        Start-Sleep -Seconds 2
        try {
            $health = Invoke-RestMethod -Uri $healthEndpoint -Method GET -TimeoutSec 5
            if ($health.healthy -eq $true) {
                Write-Host "✅ Server is ready!" -ForegroundColor Green
                return $true
            }
        } catch {
            $attempt++
            Write-Host "⌛ Attempt $attempt/$maxAttempts - Server not ready yet..." -ForegroundColor Gray
        }
    } while ($attempt -lt $maxAttempts)
    
    Write-Host "❌ Server failed to start within timeout" -ForegroundColor Red
    return $false
}

# Test 1: Short Text Performance
function Test-ShortTextPerformance {
    Write-Host "`n📝 Test 1: Short Text Performance" -ForegroundColor Blue
    Write-Host "=================================" -ForegroundColor Blue
    
    $shortText = @{
        disputeDescription = "Simple NDA violation - should Party A or Party B win?"
        evidenceData = "Party A shared confidential algorithm details with competitor Party B"
        contractType = "NDA"
    } | ConvertTo-Json
    
    $startTime = Get-Date
    try {
        $response = Invoke-RestMethod -Uri $ollamaEndpoint -Method POST -Body $shortText -ContentType "application/json" -TimeoutSec 90
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        
        Write-Host "✅ Short text test completed in $([Math]::Round($duration, 2)) seconds" -ForegroundColor Green
        Write-Host "   - LLM Used: $($response.llm_used)" -ForegroundColor White
        Write-Host "   - Decision: $($response.decision)" -ForegroundColor White
        Write-Host "   - Model: $($response.model)" -ForegroundColor White
        
        return @{
            success = $true
            duration = $duration
            llmUsed = $response.llm_used
            decision = $response.decision
        }
    } catch {
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        Write-Host "❌ Short text test failed after $([Math]::Round($duration, 2)) seconds" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
        
        return @{
            success = $false
            duration = $duration
            error = $_.Exception.Message
        }
    }
}

# Test 2: Medium Text Performance  
function Test-MediumTextPerformance {
    Write-Host "`n📄 Test 2: Medium Text Performance" -ForegroundColor Blue
    Write-Host "===================================" -ForegroundColor Blue
    
    $mediumText = "TechCorp Ltd (discloser) and DataAnalytics Inc (recipient) signed an NDA regarding proprietary transformer algorithms that improve AI efficiency by 40%. The confidential information included mathematical formulations, architectural designs, and 3 years of R&D work valued at 2.5 million dollars. The violation occurred when DataAnalytics reverse-engineered the transformer architecture and used it in their SmartAnalyzer Pro product without permission. Their lead developer John Martinez, who previously worked for TechCorp and had access to the original designs, shared detailed technical documentation with their development team. The breach was discovered on September 15th through market analysis showing identical 40% efficiency improvements in DataAnalytics' product. Evidence includes email communications between Martinez and the DataAnalytics team, source code with identical variable names and function structures, and timeline analysis suggesting premeditated violation rather than accidental similarity."
    
    $payload = @{
        disputeDescription = "Complex NDA violation case - who should win and what compensation?"
        evidenceData = $mediumText
        contractType = "NDA"
    } | ConvertTo-Json
    
    Write-Host "   Text length: $($mediumText.Length) characters" -ForegroundColor Gray
    
    $startTime = Get-Date
    try {
        $response = Invoke-RestMethod -Uri $ollamaEndpoint -Method POST -Body $payload -ContentType "application/json" -TimeoutSec 120
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        
        Write-Host "✅ Medium text test completed in $([Math]::Round($duration, 2)) seconds" -ForegroundColor Green
        Write-Host "   - LLM Used: $($response.llm_used)" -ForegroundColor White
        Write-Host "   - Decision: $($response.decision)" -ForegroundColor White
        Write-Host "   - Context preserved (TechCorp): $($response.reasoning -like '*TechCorp*')" -ForegroundColor White
        Write-Host "   - Context preserved (SmartAnalyzer): $($response.reasoning -like '*SmartAnalyzer*')" -ForegroundColor White
        Write-Host "   - Context preserved (John Martinez): $($response.reasoning -like '*John Martinez*')" -ForegroundColor White
        
        return @{
            success = $true
            duration = $duration
            llmUsed = $response.llm_used
            contextPreserved = ($response.reasoning -like '*TechCorp*') -and ($response.reasoning -like '*SmartAnalyzer*')
        }
    } catch {
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        Write-Host "❌ Medium text test failed after $([Math]::Round($duration, 2)) seconds" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
        
        return @{
            success = $false
            duration = $duration
            error = $_.Exception.Message
        }
    }
}

# Test 3: Long Text Chunking Performance
function Test-LongTextChunking {
    Write-Host "`n📚 Test 3: Long Text Chunking Performance" -ForegroundColor Blue
    Write-Host "=========================================" -ForegroundColor Blue
    
    # Create long text by repeating the medium text
    $baseText = "TechCorp Ltd (discloser) and DataAnalytics Inc (recipient) signed an NDA regarding proprietary transformer algorithms that improve AI efficiency by 40%. The confidential information included mathematical formulations, architectural designs, and 3 years of R&D work valued at 2.5 million dollars. SECTION BREAK. The violation occurred when DataAnalytics reverse-engineered the transformer architecture and used it in their SmartAnalyzer Pro product without permission. Their lead developer John Martinez, who previously worked for TechCorp and had access to the original designs, shared detailed technical documentation with their development team. EVIDENCE SECTION. The breach was discovered on September 15th through market analysis showing identical 40% efficiency improvements in DataAnalytics' product. Evidence includes email communications between Martinez and the DataAnalytics team, source code with identical variable names and function structures, and timeline analysis suggesting premeditated violation rather than accidental similarity. CONCLUSION SECTION. Additional evidence shows that Martinez downloaded 50GB of proprietary data from TechCorp servers just two weeks before joining DataAnalytics. Security logs indicate unauthorized access to sensitive transformer architecture files. Multiple witnesses confirm that Martinez presented TechCorp's exact algorithms during DataAnalytics team meetings."
    
    $longText = $baseText * 3  # Create ~3000+ character text for chunking
    
    $payload = @{
        disputeDescription = "Complex multi-section NDA violation requiring chunked analysis"
        evidenceData = $longText
        contractType = "NDA"
    } | ConvertTo-Json
    
    Write-Host "   Text length: $($longText.Length) characters (should trigger chunking)" -ForegroundColor Gray
    
    $startTime = Get-Date
    try {
        $response = Invoke-RestMethod -Uri $ollamaEndpoint -Method POST -Body $payload -ContentType "application/json" -TimeoutSec 300
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        
        Write-Host "✅ Long text chunking test completed in $([Math]::Round($duration, 2)) seconds" -ForegroundColor Green
        Write-Host "   - LLM Used: $($response.llm_used)" -ForegroundColor White
        Write-Host "   - Decision: $($response.decision)" -ForegroundColor White
        Write-Host "   - Processing Method: Chunked Analysis" -ForegroundColor White
        Write-Host "   - Context preserved (TechCorp): $($response.reasoning -like '*TechCorp*')" -ForegroundColor White
        Write-Host "   - Context preserved (DataAnalytics): $($response.reasoning -like '*DataAnalytics*')" -ForegroundColor White
        Write-Host "   - Context preserved (Martinez): $($response.reasoning -like '*Martinez*')" -ForegroundColor White
        
        return @{
            success = $true
            duration = $duration
            llmUsed = $response.llm_used
            chunkedProcessing = $true
            contextPreserved = ($response.reasoning -like '*TechCorp*') -and ($response.reasoning -like '*DataAnalytics*')
        }
    } catch {
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        Write-Host "❌ Long text chunking test failed after $([Math]::Round($duration, 2)) seconds" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
        
        return @{
            success = $false
            duration = $duration
            error = $_.Exception.Message
        }
    }
}

# Test 4: Concurrent Requests Performance
function Test-ConcurrentRequests {
    Write-Host "`n🔄 Test 4: Concurrent Requests Performance" -ForegroundColor Blue
    Write-Host "==========================================" -ForegroundColor Blue
    
    $payload = @{
        disputeDescription = "Concurrent test - rental dispute"
        evidenceData = "Tenant failed to pay rent on time, landlord wants eviction"
        contractType = "RENT"
    } | ConvertTo-Json
    
    Write-Host "   Testing 2 concurrent requests..." -ForegroundColor Gray
    
    $startTime = Get-Date
    
    # Start two requests concurrently
    $job1 = Start-Job -ScriptBlock {
        param($endpoint, $payload)
        try {
            Invoke-RestMethod -Uri $endpoint -Method POST -Body $payload -ContentType "application/json" -TimeoutSec 90
        } catch {
            @{ error = $_.Exception.Message }
        }
    } -ArgumentList $ollamaEndpoint, $payload
    
    $job2 = Start-Job -ScriptBlock {
        param($endpoint, $payload)
        try {
            Invoke-RestMethod -Uri $endpoint -Method POST -Body $payload -ContentType "application/json" -TimeoutSec 90
        } catch {
            @{ error = $_.Exception.Message }
        }
    } -ArgumentList $ollamaEndpoint, $payload
    
    # Wait for both to complete
    $results = @()
    $results += Wait-Job $job1 | Receive-Job
    $results += Wait-Job $job2 | Receive-Job
    
    Remove-Job $job1, $job2
    
    $endTime = Get-Date
    $totalDuration = ($endTime - $startTime).TotalSeconds
    
    $successCount = ($results | Where-Object { $_.llm_used -eq $true }).Count
    
    Write-Host "✅ Concurrent test completed in $([Math]::Round($totalDuration, 2)) seconds" -ForegroundColor Green
    Write-Host "   - Successful responses: $successCount/2" -ForegroundColor White
    Write-Host "   - Both used LLM: $(($results | Where-Object { $_.llm_used -eq $true }).Count -eq 2)" -ForegroundColor White
    
    return @{
        success = $successCount -eq 2
        duration = $totalDuration
        successfulRequests = $successCount
    }
}

# Main execution
if (Wait-ForServer) {
    Write-Host "`n🎯 Starting Performance Tests..." -ForegroundColor Magenta
    
    $results = @{
        shortTest = Test-ShortTextPerformance
        mediumTest = Test-MediumTextPerformance
        longTest = Test-LongTextChunking
        concurrentTest = Test-ConcurrentRequests
    }
    
    # Performance Summary
    Write-Host "`n📊 PERFORMANCE SUMMARY" -ForegroundColor Magenta
    Write-Host "======================" -ForegroundColor Magenta
    
    Write-Host "`n⏱️  Response Times:" -ForegroundColor Yellow
    Write-Host "   Short Text:  $([Math]::Round($results.shortTest.duration, 2))s" -ForegroundColor White
    Write-Host "   Medium Text: $([Math]::Round($results.mediumTest.duration, 2))s" -ForegroundColor White
    Write-Host "   Long Text:   $([Math]::Round($results.longTest.duration, 2))s" -ForegroundColor White
    Write-Host "   Concurrent:  $([Math]::Round($results.concurrentTest.duration, 2))s" -ForegroundColor White
    
    Write-Host "`n🎯 Success Rates:" -ForegroundColor Yellow
    Write-Host "   All tests successful: $(($results.shortTest.success -and $results.mediumTest.success -and $results.longTest.success -and $results.concurrentTest.success))" -ForegroundColor White
    Write-Host "   LLM usage consistent: $(($results.shortTest.llmUsed -and $results.mediumTest.llmUsed -and $results.longTest.llmUsed))" -ForegroundColor White
    Write-Host "   Context preservation: $(($results.mediumTest.contextPreserved -and $results.longTest.contextPreserved))" -ForegroundColor White
    
    Write-Host "`n🚀 Optimization Recommendations:" -ForegroundColor Green
    if ($results.shortTest.duration -gt 10) {
        Write-Host "   ⚠️  Short text response time is high (>10s) - consider using smaller model" -ForegroundColor Yellow
    }
    if ($results.longTest.duration -gt 60) {
        Write-Host "   ⚠️  Long text chunking is slow (>60s) - consider chunk size optimization" -ForegroundColor Yellow
    }
    if (-not $results.concurrentTest.success) {
        Write-Host "   ⚠️  Concurrent requests failing - consider connection pooling" -ForegroundColor Yellow
    }
    
    # Optimal performance indicators
    if ($results.shortTest.duration -lt 10 -and $results.mediumTest.duration -lt 20 -and $results.longTest.duration -lt 60) {
        Write-Host "   ✅ Performance is within optimal range!" -ForegroundColor Green
    }
    
    Write-Host "`n🏁 Performance testing completed!" -ForegroundColor Cyan
} else {
    Write-Host "❌ Server is not ready. Cannot run performance tests." -ForegroundColor Red
}