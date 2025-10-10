# Scripts Directory

Utility scripts for development, deployment, and monitoring.

## Files

### Deployment Scripts
- `deploy-simple.ps1` - Simple deployment script for contracts
- `start-all.ps1` - Start all services (server, frontend, etc.)

### Development Utilities  
- `KeepAwake.ps1` - Prevents Windows from sleeping during long processes
- `quick-debug.js` - Quick debugging utility for Node.js
- `quick-monitor.ps1` - Quick monitoring script
- `realtime-monitor.ps1` - Real-time monitoring dashboard

## Usage

### Run deployment
```powershell
.\scripts\deploy-simple.ps1
```

### Start all services
```powershell
.\scripts\start-all.ps1
```

### Keep system awake during long operations
```powershell
.\scripts\KeepAwake.ps1
```