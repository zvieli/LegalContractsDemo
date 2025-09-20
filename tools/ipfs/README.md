Local IPFS node + simple pin server

This folder provides a lightweight local IPFS setup (using Docker) and a tiny Express "pin server" that uploads ciphertext to your local IPFS node and pins it.

Why: IPFS itself is free and P2P, but to keep content available you must pin it. Running a local IPFS node + pin-server gives you a free, local pinning service.

Prerequisites
- Docker & Docker Compose installed
- Node 18+ for the pin server

Start a local IPFS node (Docker)
PowerShell:
```powershell
cd tools/ipfs
docker compose up -d
```

This will expose:
- API: http://127.0.0.1:5001
- Gateway: http://127.0.0.1:8080

Start the pin server (stores local records and calls the local IPFS API)
PowerShell:
```powershell
cd tools/ipfs
npm init -y
# Install the pin server dependencies. If you don't have Docker IPFS available,
# the server will auto-fallback to an in-process IPFS node (`ipfs-core`).
npm install express body-parser node-fetch uuid fs-extra ipfs-core
node pin-server.js
```

Usage (from frontend)
- POST JSON to `http://localhost:3002/pin` with body:
  {
    "cipherStr": "...", // encrypted evidence JSON string
    "meta": { "contract": "0xabc...", "caseId": 0 }
  }

Response:
- { id, cid, meta, createdAt, raw }

Notes
- This is a development setup. For production you should run a dedicated IPFS node (or a pinning provider) and secure the pin-server (authentication, rate-limiting, TLS).
- The pin-server will attempt to call a local IPFS HTTP API (http://127.0.0.1:5001). If that API is unavailable the server falls back to an in-process `ipfs-core` node (no Docker required). This allows you to run the pin server without Docker installed.
- The pin-server POST currently sends the raw body to the IPFS API for simplicity. For a robust client use `form-data` multipart upload.
Security & optional production notes
- API key: you may secure the pin-server by setting an environment variable `PIN_SERVER_API_KEY` in `tools/ipfs/.env`. When set, API requests must include an `X-API-KEY` header or `?api_key=` query parameter.
- CORS: allowed origins are configured via `ALLOWED_ORIGINS` (comma-separated) in `tools/ipfs/.env`. By default `http://localhost:5173,http://localhost:3000` are allowed.
- TLS: to run the server with HTTPS provide `TLS_KEY_PATH` and `TLS_CERT_PATH` in `tools/ipfs/.env` pointing at the PEM files. If provided, the server starts in HTTPS mode.

Quick start (short)

PowerShell:
```powershell
cd tools/ipfs
docker compose up -d    # start go-ipfs daemon
npm install             # install form-data and helpers
npm start               # start pin-server (listens on :3002)
npm run test-pin        # run the test harness
```

Cleanup (PowerShell):
```powershell
cd tools/ipfs
docker compose down --remove-orphans
docker rm -f local-ipfs 2>$null | Out-Null
docker network rm ipfs_default 2>$null | Out-Null
```

Cleanup (bash):
```bash
cd tools/ipfs
docker compose down --remove-orphans
docker rm -f local-ipfs 2>/dev/null || true
docker network rm ipfs_default 2>/dev/null || true
```
