# smoke-check.ps1
# PowerShell smoke-check that uses curl.exe to avoid PowerShell's Invoke-WebRequest behavior

$v7 = $env:V7_URL -or 'http://localhost:3001'
$ipfs = $env:IPFS_URL -or 'http://127.0.0.1:5001'

Write-Host '=== HEALTH ==='
try { curl.exe -s -X GET "$v7/api/v7/arbitration/health" | Write-Host } catch { Write-Host 'ERR' $_ }

Write-Host '\n=== MODULES ==='
try { curl.exe -s -X GET "$v7/api/v7/modules" | Write-Host } catch { Write-Host 'ERR' $_ }

Write-Host '\n=== CCIP STATUS ==='
try { curl.exe -s -X GET "$v7/api/v7/ccip/status" | Write-Host } catch { Write-Host 'ERR' $_ }

Write-Host '\n=== IPFS VERSION (POST) ==='
try { curl.exe -s -X POST "$ipfs/api/v0/version" | Write-Host } catch { Write-Host 'ERR' $_ }
