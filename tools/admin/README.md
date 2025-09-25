# Admin decryption utilities

This folder contains admin-only helpers for decrypting EthCrypto JSON ciphertexts. These tools are intended to run in a trusted admin environment (server or CLI) and must never be bundled into the front-end.

Files

- `decryptHelper.js` — ESM exports with `decryptEvidencePayload(payloadJson, adminPrivateKey)` and `decryptRationale(...)` helpers.
- `decrypt-cli.js` — small CLI wrapper that reads ciphertext JSON from a file or stdin and prints the decrypted plaintext.
 - `check-digest-match.mjs` — small helper to compute keccak256 over a ciphertext file and compare with an expected digest (useful for regression tests and CI).

Security recommendations

- Store admin private keys in a secure vault (HSM, Vault, or environment-protected secret management). Do not commit keys to the repository.
- Restrict access to machines and network paths that run these tools.
- Consider additional logging and access audit for decryption operations.

Key configuration (recommended)

- Preferred: set the environment variable `ADMIN_PRIVATE_KEY` on the machine where you run the CLI. The CLI reads this value and will not accept keys passed on the command line.
- Alternative (recommended for production): configure HashiCorp Vault and set `VAULT_ADDR` and `VAULT_TOKEN` in the environment. Optionally set `VAULT_SECRET_PATH` (default `/secret/data/admin`) and `VAULT_SECRET_KEY` (default `privateKey`). The CLI will fetch the secret from Vault before decrypting.

- File-based key (secure file): you can set `ADMIN_PRIVATE_KEY_FILE` to a filesystem path containing the private key. The CLI will attempt to read the file and will perform a permission check on POSIX systems to ensure the file is owner-only (no group/world read permissions). On Windows the permission check is best-effort and the file will still be read.

Security note

- Do NOT pass private keys on the command line; shells and process lists can leak them. The previous `--key` option was removed to avoid accidental exposure.

Examples

Decrypt from a file using `ADMIN_PRIVATE_KEY`:

```
export ADMIN_PRIVATE_KEY="0x..."
node tools/admin/decrypt-cli.js --file ciphertext.json
```

Windows (PowerShell) example using environment variable (temporary for session):

```
$env:ADMIN_PRIVATE_KEY = '0x...'
node tools/admin/decrypt-cli.js --file ciphertext.json
```

Windows (PowerShell) example reading from a secure file (ensure NTFS ACLs restrict access):

```
$env:ADMIN_PRIVATE_KEY_FILE = 'C:\secure\admin.key'
# Ensure file permissions are tight: use icacls to restrict access on Windows
# icacls C:\secure\admin.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
node tools/admin/decrypt-cli.js --file ciphertext.json
```

Check digest match (compute keccak256 over the file and optionally compare):

```
node tools/admin/check-digest-match.mjs front/e2e/static/<digestNo0x>.json 0x1234...abcd
```

Notes about demo keys in repository

- Demo/front helper scripts previously included an example admin private key for local development. Those hard-coded keys were removed. Do NOT store admin private keys in the repository or the front-end.
- For local testing, set `ADMIN_PRIVATE_KEY` in your session or point `ADMIN_PRIVATE_KEY_FILE` to a secure file containing the private key. Example PowerShell session usage:

```
$env:ADMIN_PRIVATE_KEY = '0x...'
node front/tools/admin/write-ciphertext-to-static.mjs
$env:ADMIN_PRIVATE_KEY = $null
```

Decrypt using Vault (KV v2 default mount):

```
export VAULT_ADDR="https://vault.example.com"
export VAULT_TOKEN="s.xxxxx"
export VAULT_SECRET_PATH="/secret/data/admin"
node tools/admin/decrypt-cli.js --file ciphertext.json
```

Decrypt using a file with owner-only permissions (POSIX):

```
export ADMIN_PRIVATE_KEY_FILE="/path/to/admin.key"
# ensure owner-only: chmod 600 /path/to/admin.key
node tools/admin/decrypt-cli.js --file ciphertext.json
```
```

CI example

See `.github/workflows/admin-key-example.yml` for an example GitHub Actions job that writes the admin key from a secret into a file with restricted permissions and runs the CLI.

Fetch-and-decrypt helper

This repository includes a convenience script `fetch-and-decrypt.js` that automates a common admin flow:

- read the on-chain `bytes32` digest (or accept it as an argument)
- fetch ciphertext from a known storage convention (HTTP/S3/file/stdin)
- verify `keccak256(ciphertext)` equals the on-chain digest
- decrypt the ciphertext using the configured admin private key

Example (PowerShell) using a digest and an S3-like base URL where objects are named `<digestNo0x>.json`:

```
$env:ADMIN_PRIVATE_KEY_FILE = 'C:\secure\admin.key'
node tools/admin/fetch-and-decrypt.js --digest 0x1234...abcd --fetchBase https://storage.example.com/evidence --out decrypted.txt
```

Example using contract + caseId (reads digest on-chain via RPC and fetches from base URL):

```
node tools/admin/fetch-and-decrypt.js --contract 0xContractAddress --caseId 3 --rpc http://localhost:8545 --fetchBase https://storage.example.com/evidence --out out.txt
```

Example reading ciphertext from stdin (pipe) and writing plaintext to stdout:

```
cat ciphertext.json | node tools/admin/fetch-and-decrypt.js --stdin --digest 0x1234...abcd
```

Security reminder: the script reads the admin private key from `ADMIN_PRIVATE_KEY` or `ADMIN_PRIVATE_KEY_FILE` (preferred). Do not pass keys on the command line.
