Evidence hosting & admin fetch (Option A)

This project follows Option A for evidence handling:

- Clients encrypt evidence off-chain (e.g. ECIES/EthCrypto JSON) to the platform admin's public key.
- The client (or a dev helper) stores the ciphertext JSON off-chain on a Helia node or HTTP(S) service reachable by the platform arbitrator/admin.
- The frontend computes the canonical digest: keccak256(UTF-8(ciphertextString)) and submits that 32-byte digest (0x...) on-chain. The contracts store only the 32-byte digest.

Filename and fetch convention (recommended for local dev):

- Place ciphertext JSON files under `front/e2e/static/<digestNo0x>.json` (where `<digestNo0x>` is the digest without the leading `0x`).
- The local static server provided at `front/e2e/serve-static.mjs` serves those files on `http://localhost:5174/<digestNo0x>.json`.

For production, host ciphertext files on an HTTPS URL accessible to the admin. Filename convention must match the digest (or ensure your fetch-and-decrypt flow can map digest->URL).

CORS / hosting notes:

- Ensure your hosting allows GET requests from the arbitrator/admin environment. For browser-based admin fetch (demo only) configure CORS to allow your origin. For server-side admin tools, CORS is not required.
- Use HTTPS in production and restrict access via signed URLs, ACLs, or an authenticated fetcher. Do NOT embed admin private keys in the frontend.

Admin fetch & decrypt example (CLI)

Use the admin tooling in `tools/admin` in a trusted environment. Example (PowerShell):

```
$env:ADMIN_PRIVATE_KEY = '0x...'
node .\tools\admin\fetch-and-decrypt.js --digest 0x... --fetchBase http://localhost:5174 --out decrypted.txt
```

Developer helper (local static upload)

- To prepare ciphertext for local Playwright tests, use `tools/admin/upload-evidence-local.mjs` which writes the ciphertext to `front/e2e/static/<digestNo0x>.json`:

```
node .\tools\admin\upload-evidence-local.mjs --file C:\path\to\ciphertext.json
```

Security note

- Never paste production admin private keys into the frontend. The frontend admin decrypt modal is for demos only. Always perform decryption in a trusted admin environment (CLI or server) and protect private keys with hardware or vaults.
