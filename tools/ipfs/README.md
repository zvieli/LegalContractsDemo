# Pin-server (local dev) — tools/ipfs

This small pin-server is used by tests and the frontend to store "pinned" evidence blobs and (in dev mode) perform a deterministic symmetric decrypt via an admin endpoint.

This README explains how to run the server locally (Node), run it inside Docker (useful for CI), and how to run the included test harness `test_run_all.js`.

## Files

- `pin-server.js` — Express server that accepts `POST /pin` and `POST /admin/decrypt/:id`.
- `store/` — directory where pin records are written. When run in Docker, `docker-compose.yml` mounts this directory.
- `test_run_all.js` — small node script that posts a pin and requests admin decrypt to validate behavior.
- `Dockerfile` & `docker-compose.yml` — containerization files for local/CI usage.

## Environment variables

-- `ADMIN_PRIVATE_KEY` — (Optional for local dev) admin private key used to sign EIP-712 admin requests for `POST /admin/*` endpoints. In production prefer injecting `PIN_SERVER_ADMIN_ADDRESS` and using separate admin signing infrastructure.
-- `PIN_SERVER_AES_KEY` or `PIN_SERVER_SYMM_KEY` — Symmetric AES-256 key for encrypting/decrypting stored `cipherStr` values. For local development a key may be provided via `.env`. In production you MUST provide the key as a secret at runtime (do NOT commit it in `.env).
- `PIN_SERVER_PORTS` — Optional comma-separated ports the server should try to listen on. The server will attempt each in order and continue if a port is already in use. Example: `8080,3002`.
- `ADMIN_PRIVATE_KEY` — (Optional) placeholder private key used by some scripts; not required to run the pin-server itself.

Note: Defaults in `.env` are only for local development. Do NOT commit or use `.env` in production. Provide secrets via your CI/CD or container runtime (see Docker notes below).

## Run locally (Node)

1. Install dependencies (if you haven't already):

```powershell
cd tools/ipfs; npm ci
```

2. Run the server:

```powershell
# Recommended for local dev only: load .env or export env vars in your shell
# Do NOT commit or use .env in production. In production provide secrets via your runtime (Kubernetes secrets, Docker secrets, CI secrets, etc.)
# Example (PowerShell):
$env:PIN_SERVER_AES_KEY = 'BASE64_32_BYTE_KEY'; $env:ADMIN_PRIVATE_KEY = '<your-admin-private-key>'; node pin-server.js
```

3. The server will try to bind to ports from `PIN_SERVER_PORTS` or fallback defaults. Check the console output to see which port it bound to.

## Run with Docker (recommended for CI)

Build and run using the included `docker-compose.yml`:

```powershell
# Build image and start container
docker compose -f tools/ipfs/docker-compose.yml build --no-cache; docker compose -f tools/ipfs/docker-compose.yml up -d

# Stop and remove
docker compose -f tools/ipfs/docker-compose.yml down --volumes --remove-orphans
```

By default the compose file maps ports `8080` and `3002` from the container to the host. The `store/` directory is mounted so pinned data is persisted on the host.

Important production note: Do NOT bake secrets into the image or mount a `.env` file in production. Use your orchestrator's secrets management to inject `PIN_SERVER_AES_KEY` and `ADMIN_PRIVATE_KEY` at runtime.

## Run the test harness

The `test_run_all.js` script posts a pin with a deterministic payload and immediately calls the admin decrypt endpoint to verify the decrypted value matches the original plaintext.

```powershell
cd tools/ipfs; node test_run_all.js
```

If running against the Docker container, ensure the container is up first (see Docker commands above).

## Notes for CI

- The test harness exits with a nonzero code on failure, so it can be used directly in CI.
- The GitHub Actions workflow should build the image, run the container, execute the test script, and then tear down the container.

## Security

This repository and the included pin-server are intended for educational and local development use only. For that reason we intentionally keep the design simple and do NOT use production features such as Additional Authenticated Data (AAD) binding or Key Management Service (KMS) integrations.

Current dev security posture:
- The server uses an AES-GCM symmetric key read from the env var `PIN_SERVER_AES_KEY` (or `PIN_SERVER_SYMM_KEY`) for encrypting stored `cipherStr` values. The server accepts raw 32-byte hex or base64 keys, or will derive a 32-byte key via SHA-256 if a passphrase is provided.
- Nonces and audit logs are stored as local JSON files under `tools/ipfs/store/` and `tools/ipfs/store/audit.log` for simplicity.
- Admin operations are performed by verifying an EIP-712 typed-data signature recovered to the configured admin address derived from `ADMIN_PRIVATE_KEY` (or set `PIN_SERVER_ADMIN_ADDRESS` explicitly).

Why we avoid AAD / KMS here
- This is an educational demo: adding AAD or integrating a KMS would increase complexity and add operational dependencies that are out of scope. If you want to experiment with those features, the codebase is structured so you can add AAD or KMS later (see "Next steps").

Recommended caution
- Do not run this pin-server in production or on the public internet with the default environment variables committed to source.
- Keep `PIN_SERVER_AES_KEY` and `ADMIN_PRIVATE_KEY` secret. In production, inject them as runtime secrets (CI/CD secrets, Docker/Kubernetes secrets, or a KMS) and do NOT store them in `.env` checked in to source control.

Optional next steps (not required for learning)
- Use AAD with AES-GCM to bind ciphertext to `pinId` and `contract` for stronger integrity.
- Move AES keys to a KMS or seed them from a secure secret store if you plan to operate this service in a shared environment.

Note: For this educational project we intentionally keep nonces and audit as simple file-based storage under `tools/ipfs/store/`. We do not use SQLite/Postgres here to avoid adding operational dependencies — file-based storage is chosen for clarity and ease of local testing.

## Troubleshooting

- If a port is already in use, the server will attempt the next port in `PIN_SERVER_PORTS`. Check the log to see the port selected.
- If admin decrypt fails, verify `ADMIN_PRIVATE_KEY` (or `PIN_SERVER_ADMIN_ADDRESS`) and `PIN_SERVER_SYMM_KEY` are set correctly in the environment used by the client.
- If admin decrypt fails, verify `ADMIN_PRIVATE_KEY` (or `PIN_SERVER_ADMIN_ADDRESS`) and `PIN_SERVER_SYMM_KEY` are set correctly in the environment used by the client.

---
Generated by automation as part of repository maintenance.
