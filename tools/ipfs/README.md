# IPFS pin-server (dev)

Short developer notes for the local IPFS pin-server used by LegalContractsDemo.

Prerequisites
- Node.js (>=16)
- npm
- Docker (optional, recommended for deterministic CID pinning)
- PowerShell (examples below use PowerShell on Windows)

Quick start (use dockerized go-ipfs)

1. Start go-ipfs (from repo root):

    ```powershell
    cd tools/ipfs
    docker compose up -d
    ```

2. Start the pin-server (from repo root):

    ```powershell
    # from repo root
    node tools/ipfs/pin-server.js
    # or from tools/ipfs
    npm run start
    ```

3. Run the test/integration harness (from repo root):

    ```powershell
    node tools/ipfs/test_run_all.js
    # or from tools/ipfs
    npm run integration
    ```

Behavior
- The pin-server prefers the go-ipfs HTTP API at `http://127.0.0.1:5001` when available and falls back to an in-process `ipfs-core` add operation if the daemon is unreachable.
- Encrypted evidence payloads are persisted as audit records under `tools/ipfs/store/` (this directory is ignored by git).
- Admin decrypt endpoint exists at `POST /admin/decrypt/:id` and requires the API key defined in `tools/ipfs/.env`.

Cleanup / stop (PowerShell)

```powershell
# stop and remove the go-ipfs container and network
cd tools/ipfs
docker compose down --remove-orphans

# stop a locally running pin-server (if started in foreground)
# Find pid by process name or Ctrl+C if started in the current shell
Get-Process -Name node | Where-Object { $_.Path -like '*pin-server.js' } | Stop-Process -Force
```

Security notes
- Do NOT commit `tools/ipfs/.env` to the repository. The file contains `ADMIN_PRIVATE_KEY` and `PIN_SERVER_API_KEY` for local dev only.
- The server implements a simple API key gate for the admin decrypt endpoint; for production use you should secure it behind proper auth and avoid storing private keys on disk.

Troubleshooting
- If `ipfs-core` reports repo locks, ensure there are no other `js-ipfs` processes running and prefer running the docker go-ipfs daemon.
- The go-ipfs HTTP API requires multipart/form-data `file` uploads for `api/v0/add`.

If you want me to expand this README with example HTTP requests or a sample `.env` template, tell me and I will add it.
