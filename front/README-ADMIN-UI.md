# Admin in-browser decrypt UI

This project includes an optional client-side admin decrypt flow exposed via the frontend UI ("Admin decrypt (client)") in the Contract and Resolve modals.

Important security notes

- The frontend never generates or persists any admin keypair. The only private key in the system is the admin private key and it MUST be kept and used only in a trusted admin environment.
- The client-side flow (admin decrypt modal) is a demo convenience: it decrypts ciphertext in the browser when an admin transiently pastes their private key. The private key must NOT be stored in the frontend.
- For production and routine operations, use the server-side admin utilities under `tools/admin/` which can integrate with secure key storage (KMS/HSM/vault) and avoid handling private keys in the browser or client bundles.

How to use

1. Open the Contract or Resolve modal for the contract with the dispute.
2. Click `Admin decrypt (client)`.
3. Paste the ciphertext JSON (EthCrypto format) or an HTTPS URL to fetch the ciphertext into the left textarea.
4. Paste the admin private key (transient) into the private key field on the right.
5. Click `Decrypt`. The plaintext will display in the modal.

CORS note

- If the ciphertext is hosted on a remote server, the browser must be able to fetch it. Ensure the hosting server sets appropriate CORS headers for your origin, or download the ciphertext and paste it into the textarea.

Alternatives

Alternatives (recommended)

- Use `tools/admin/decrypt-cli.js` to decrypt ciphertext outside the browser with keys stored in a secure vault or protected file. This is the recommended production flow.
- The frontend is only expected to receive the admin public key (for encryption) via a runtime environment variable (e.g. `VITE_ADMIN_PUBLIC_KEY`). Do not embed private keys in the frontend code or environment.
