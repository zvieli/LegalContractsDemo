# Admin in-browser decrypt UI

This project includes an optional client-side admin decrypt flow exposed via the frontend UI ("Admin decrypt (client)") in the Contract and Resolve modals.

Important security notes

- This client-side flow decrypts using `eth-crypto` in the browser. It requires the admin private key to be entered into a transient input field in the browser. The key is not persisted by the UI, but it will be present in the browser memory for the session.
- DO NOT use long-lived or production private keys in an untrusted browser. Prefer using the server-side admin utilities in `tools/admin/` which can read keys from a secure vault or file and run in a trusted environment.
- The in-browser feature is provided as a convenience for local testing or emergency use only.

How to use

1. Open the Contract or Resolve modal for the contract with the dispute.
2. Click `Admin decrypt (client)`.
3. Paste the ciphertext JSON (EthCrypto format) or an HTTPS URL to fetch the ciphertext into the left textarea.
4. Paste the admin private key (transient) into the private key field on the right.
5. Click `Decrypt`. The plaintext will display in the modal.

CORS note

- If the ciphertext is hosted on a remote server, the browser must be able to fetch it. Ensure the hosting server sets appropriate CORS headers for your origin, or download the ciphertext and paste it into the textarea.

Alternatives

- Use `tools/admin/decrypt-cli.js` (recommended) to decrypt ciphertext outside the browser with keys stored in a secure vault or protected file. See `tools/admin/README.md` for details.
