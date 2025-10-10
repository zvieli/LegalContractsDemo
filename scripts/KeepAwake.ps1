# Save as KeepAwake.ps1

# פונקציה להחלפת מצב NumLock
function Toggle-NumLock {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("{NUMLOCK}")
}

Write-Host "Starting NumLock toggle every 30 seconds. Press Ctrl+C to stop."

while ($true) {
    Toggle-NumLock
    Start-Sleep -Seconds 30
}
