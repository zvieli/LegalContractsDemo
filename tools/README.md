Evidence tools (local dev)

This folder contains small helper scripts used to demo and test the Option A evidence flow:

- `evidence-endpoint.cjs` — Express endpoint that accepts POST `/submit-evidence`, encrypts the payload with the admin public key and writes a canonical ciphertext JSON file under the static directory (default `front/e2e/static`). Returns the computed `digest`.
- `evidence-e2e-test.cjs` — simple E2E script that POSTs a sample payload to the endpoint and waits for the resulting `<digest>.json` to appear.
- `evidence-server.cjs` — simple static server for serving `front/e2e/static` during local testing.

New: `e2e-evidence-flow.cjs` — full flow test that posts plaintext, then a failing wrapper (to trigger a 400 and receive `adminPublicKey`), then re-encrypts locally and retries the POST. Useful to validate client retry behavior during local dev.

Quick start (local)

1. Create a local admin key (or point to an existing one) and **do not commit it**:

```powershell
# create local file with admin private key (example dev key)
Set-Content -Path ./admin.key -Value "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
```

2. Add `.env` entries (or set env vars):

```powershell
# either point to a file
$env:ADMIN_PRIVATE_KEY_FILE = './admin.key'
# or set the private key directly (not recommended)
$env:ADMIN_PRIVATE_KEY = '0x...'
```

3. Start the evidence endpoint (loads `.env` if you use `dotenv`):

```powershell
node -r dotenv/config .\tools\evidence-endpoint.cjs 3000 .\front\e2e\static
```

4. In another terminal run the static server (optional, endpoint already writes files):

```powershell
node .\tools\evidence-server.cjs 5174 .\front\e2e\static
```

5. Run the E2E test script which POSTs a sample payload and validates the file was written:

```powershell
node .\tools\evidence-e2e-test.cjs .\front\e2e\static

Full flow test (plain -> failed wrapper -> re-encrypt):

```powershell
node .\tools\e2e-evidence-flow.cjs http://127.0.0.1:3003/submit-evidence
```
```

Notes & troubleshooting
- If you see `secp256k1 unavailable, reverting to browser version` it means the native `secp256k1` binding was not available and the library fell back to a JS implementation. Functionality is preserved but performance may be lower. To install the native binding on Windows you will need Visual Studio Build Tools and Python (see repository README or CI docs).
- Never commit private keys to the repository. Use `ADMIN_PRIVATE_KEY_FILE` pointing to a local file outside the repo or CI secrets for automated runs.

Note: The `TemplateRentContract` constructor now accepts one additional parameter at the end: `bytes32 initialEvidenceDigest`. Tests and scripts that deploy this contract should pass a 32-byte digest or `ethers.ZeroHash` (or `bytes32(0)`) to preserve legacy behavior.
