<#
.SYNOPSIS
  Run local end-to-end tests (Playwright) on Windows.

.DESCRIPTION
  This script starts the frontend Vite dev server and the evidence endpoint (Helia in-process),
  waits until both are reachable, runs Playwright E2E tests located under front/tests/e2e,
  and then gracefully shuts down both background processes. It also attempts to clean up
  if the script is interrupted (Ctrl+C) or exits early.

.NOTES
  - Designed for PowerShell 5.1 (Windows 10/11). Uses Start-Process to open new PowerShell windows
    for long-running processes so logs remain visible.
  - Uses environment variables SUPPORT_NOBLE_SECP=1 and TESTING=1 for the evidence endpoint by default.
#>

Set-StrictMode -Version Latest

function Write-Log($msg) {
  $t = Get-Date -Format 'HH:mm:ss'
  Write-Host "[$t] $msg"
}

# Resolve repository root and important paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
$repoRoot = $repoRoot.Path
$frontDir = Join-Path $repoRoot 'front'

# Config
$viteUrl = 'http://localhost:5173'
$endpointPing = 'http://127.0.0.1:5001/ping'
$waitTimeoutSec = 60

$devProc = $null
$endpointProc = $null

function Cleanup {
  Write-Log 'Cleaning up background processes...'
  try {
    if ($devProc -and -not $devProc.HasExited) {
      Write-Log "Stopping frontend (PID $($devProc.Id))"
      Stop-Process -Id $devProc.Id -Force -ErrorAction SilentlyContinue
    }
  } catch { }
  try {
    if ($endpointProc -and -not $endpointProc.HasExited) {
      Write-Log "Stopping evidence endpoint (PID $($endpointProc.Id))"
      Stop-Process -Id $endpointProc.Id -Force -ErrorAction SilentlyContinue
    }
  } catch { }
}

# Register Ctrl+C handler to ensure cleanup
try {
  Register-EngineEvent ConsoleCancelEvent -Action { 
    Write-Log 'Console cancel detected (Ctrl+C). Initiating cleanup...'; Cleanup; exit 1 
  } | Out-Null
} catch {
  Write-Log 'Warning: Could not register Ctrl+C handler. Cleanup will still run on normal exit.'
}

try {
  Write-Log 'Starting frontend Vite dev server in a new PowerShell window...'
  $devCmd = "Set-Location -LiteralPath '$frontDir'; npm run dev"
  $devProc = Start-Process -FilePath 'powershell' -ArgumentList '-NoExit','-Command',$devCmd -WorkingDirectory $frontDir -PassThru

  Write-Log 'Starting evidence endpoint (Helia) in a new PowerShell window...'
  # Set env vars only for that process and run the endpoint
  $endpointCmd = "Set-Location -LiteralPath '$repoRoot'; `$env:SUPPORT_NOBLE_SECP='1'; `$env:TESTING='1'; node 'tools\evidence-endpoint.cjs'"
  $endpointProc = Start-Process -FilePath 'powershell' -ArgumentList '-NoExit','-Command',$endpointCmd -WorkingDirectory $repoRoot -PassThru

  # Wait until both servers are reachable
  function Wait-ForUrl($url, $timeoutSec) {
    $end = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $end) {
      try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {
          return $true
        }
      } catch { }
      Start-Sleep -Seconds 1
    }
    return $false
  }

  Write-Log "Waiting up to $waitTimeoutSec seconds for frontend at $viteUrl ..."
  if (-not (Wait-ForUrl $viteUrl $waitTimeoutSec)) {
    Write-Log "Frontend did not become ready within $waitTimeoutSec seconds."
    throw 'Frontend readiness timeout'
  }
  Write-Log 'Frontend is ready.'

  Write-Log "Waiting up to $waitTimeoutSec seconds for evidence endpoint at $endpointPing ..."
  if (-not (Wait-ForUrl $endpointPing $waitTimeoutSec)) {
    Write-Log "Evidence endpoint did not become ready within $waitTimeoutSec seconds."
    throw 'Endpoint readiness timeout'
  }
  Write-Log 'Evidence endpoint is ready.'

  # Run Playwright tests from front folder
  Write-Log 'Running Playwright tests (this will block until completion)...'
  Push-Location $frontDir
  try {
    # Use npx to ensure local playwright is used
    $ps = Start-Process -FilePath 'npx' -ArgumentList 'playwright','test','tests/e2e/evidence.spec.js','--reporter=list' -NoNewWindow -Wait -PassThru -WorkingDirectory $frontDir
    $exitCode = $ps.ExitCode
  } catch {
    Write-Log 'Playwright execution failed.'
    throw
  } finally {
    Pop-Location
  }

  Write-Log "Playwright finished with exit code $exitCode"
  if ($exitCode -ne 0) { throw "Playwright tests failed (exit code $exitCode)" }

} catch {
  Write-Log "Error: $($_.Exception.Message)"
  Cleanup
  exit 2
} finally {
  Write-Log 'Tests finished — performing final cleanup.'
  Cleanup
}

Write-Log 'All done.'
exit 0
