# Stop and remove the local go-ipfs container and network
cd "$PSScriptRoot"
Write-Host 'Stopping and removing local-ipfs container (if present) ...'
try { docker compose down --remove-orphans } catch { }
try { docker rm -f local-ipfs -ErrorAction SilentlyContinue } catch { }
try { docker network rm ipfs_default -ErrorAction SilentlyContinue } catch { }
Write-Host 'Cleanup complete.'
