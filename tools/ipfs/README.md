# Pin-server (local dev) — tools/ipfs

This small pin-server is used by tests and the frontend to store "pinned" evidence blobs and (in dev mode) perform a deterministic symmetric decrypt via an admin endpoint.

This README explains how to run the server locally (Node), run it inside Docker (useful for CI), and how to run the included test harness `test_run_all.js`.

## Files

- `pin-server.js` — Express server that accepts `POST /pin` and `POST /admin/decrypt/:id`.
- `store/` — directory where pin records are written. When run in Docker, `docker-compose.yml` mounts this directory.
- `test_run_all.js` — small node script that posts a pin and requests admin decrypt to validate behavior.
- `Dockerfile` & `docker-compose.yml` — containerization files for local/CI usage.

## Environment variables

- `PIN_SERVER_API_KEY` — Admin API key used by `POST /admin/*` endpoints. (Default: `admin` in dev/test only.)
- `PIN_SERVER_SYMM_KEY` — Symmetric key for dev-mode deterministic encryption/decryption. The server uses XOR+base64 in dev mode. Default: `devkey`.
- `PIN_SERVER_PORTS` — Optional comma-separated ports the server should try to listen on. The server will attempt each in order and continue if a port is already in use. Example: `8080,3002`.
- `ADMIN_PRIVATE_KEY` — (Optional) placeholder private key used by some scripts; not required to run the pin-server itself.

Note: Defaults are chosen for local development. Do not use the deterministic XOR mode in production.

## Run locally (Node)

1. Install dependencies (if you haven't already):

```powershell
cd tools/ipfs; npm ci
```

2. Run the server:

```powershell
# Recommended: set env variables as needed
$env:PIN_SERVER_SYMM_KEY = 'devkey'; $env:PIN_SERVER_API_KEY = 'admin'; node pin-server.js
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
- The server uses an AES-GCM symmetric key derived from the env var `PIN_SERVER_AES_KEY` (or `PIN_SERVER_SYMM_KEY`) for encrypting stored `cipherStr` values. The key is derived by hashing the provided passphrase via SHA-256.
- Nonces and audit logs are stored as local JSON files under `tools/ipfs/store/` and `tools/ipfs/store/audit.log` for simplicity.
- There is an admin API key mode (set `PIN_SERVER_API_KEY`) for operator-style access; the server rejects API-key usage originating from browser origins to reduce accidental exposure.

Why we avoid AAD / KMS here
- This is an educational demo: adding AAD or integrating a KMS would increase complexity and add operational dependencies that are out of scope. If you want to experiment with those features, the codebase is structured so you can add AAD or KMS later (see "Next steps").

Recommended caution
- Do not run this pin-server in production or on the public internet with the default environment variables.
- Keep `PIN_SERVER_AES_KEY` secret in your local environment when running tests that include sensitive data.

Optional next steps (not required for learning)
- Use AAD with AES-GCM to bind ciphertext to `pinId` and `contract` for stronger integrity.
- Move AES keys to a KMS or seed them from a secure secret store if you plan to operate this service in a shared environment.

Note: For this educational project we intentionally keep nonces and audit as simple file-based storage under `tools/ipfs/store/`. We do not use SQLite/Postgres here to avoid adding operational dependencies — file-based storage is chosen for clarity and ease of local testing.

## Troubleshooting

- If a port is already in use, the server will attempt the next port in `PIN_SERVER_PORTS`. Check the log to see the port selected.
- If admin decrypt fails, verify `PIN_SERVER_API_KEY` and `PIN_SERVER_SYMM_KEY` are identical between the poster and the admin client.

---
Generated by automation as part of repository maintenance.
