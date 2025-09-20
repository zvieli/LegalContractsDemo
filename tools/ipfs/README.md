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

Example `.env` (DO NOT COMMIT)

```
# tools/ipfs/.env - local dev only
PIN_SERVER_API_KEY=changeme_api_key_please_replace
ADMIN_PRIVATE_KEY=0x<your_admin_private_key_here>
# Optional: admin public key used by front-end to encrypt evidence for admin
ADMIN_PUBLIC_KEY=0x<your_admin_public_key_here>
# Optional: override IPFS daemon API base
IPFS_API_BASE=http://127.0.0.1:5001
# CORS origins allowed by the pin-server (comma-separated)
ALLOWED_ORIGINS=http://localhost:5173
```

Example HTTP requests

1) Pin encrypted/plain evidence (client -> pin-server)

```
POST /pin
Content-Type: application/json

{
    "cipherStr": "<base64-or-encrypted-string>",
    "meta": { "contractAddress": "0x...", "reporter": "0x...", "fileName": "evidence.png" }
}

Response (200):
{
    "id": "<internal-id>",
    "cid": "Qm...",            // optional - present when IPFS add succeeded
    "used": "api"|"ipfs-core"|"store-fallback",
    "meta": { ... }
}
```

2) Admin decrypt (requires `PIN_SERVER_API_KEY` header)

```
POST /admin/decrypt/<id>
Headers:
    x-api-key: <PIN_SERVER_API_KEY>

Response (200):
{
    "id": "<internal-id>",
    "decrypted": "<original plaintext>"
}
```

Notes
- The pin-server persists the full `cipherStr` in `tools/ipfs/store/<id>.json` as an audit/fallback. This allows admins to decrypt evidence even if IPFS add fails.
- When automating tests/CI, prefer running `docker compose up -d` in `tools/ipfs` before invoking the pin-server to ensure deterministic CID behavior.

If you want, I can add curl/Postman/JS examples for these requests and a small `tools/ipfs/README-quickstart.md` that walks through starting Docker, pinning, and decrypting.
