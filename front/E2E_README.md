Playwright E2E (smoke)

Prerequisites
- Node.js and npm
- From the repository root install frontend deps: `cd front && npm install`

Run dev server and tests
1. Start the Vite dev server:
   ```powershell
   cd front; npm run dev
   ```
2. In another terminal run Playwright tests (will use Chromium headless):
   ```powershell
   cd front; npm run e2e
   ```

Notes
- The test is a light smoke test and uses permissive selectors; update `front/tests/e2e/resolve.spec.js` to match your app's exact selectors (data-testid attributes are recommended).

Encrypt→Onchain→UI decrypt test

This repository includes an E2E test `front/e2e/tests/encrypt-decrypt.spec.mjs` that performs a full roundtrip.

Important security note: the only private key used in the system is the admin private key. The frontend does not generate or persist any admin keypair. Clients encrypt to a single admin public key (provided to the frontend as an environment variable) and the ciphertext is stored off-chain. Admin private-key operations (decryption, key management) must be performed in a trusted admin environment (see `tools/admin`).

The E2E flow performed by the test is:
- encrypt plaintext to the admin public key (EthCrypto)
- compute digest and call `reportDispute` on a deployed `TemplateRentContract` with the digest
- open the frontend UI and use the `Admin decrypt (client)` modal to paste ciphertext and the admin private key (demo only)
- verify the UI shows the original plaintext and that the on-chain digest matches

Requirements to run this test:
- Hardhat node with contracts deployed (run `npx hardhat node` and `npx hardhat run scripts/deploy.js --network localhost`)
- Frontend dev server running at `http://localhost:5173` (`npm --prefix ./front run dev`)
- Set environment variable `TEST_RENT_CONTRACT` to the deployed `TemplateRentContract` address before running Playwright.

Example (PowerShell):

```
# Start dev server in one terminal
npm --prefix ./front run dev

# In another terminal start hardhat node and deploy
npx hardhat node &
npx hardhat run scripts/deploy.js --network localhost

# Export the deployed contract address (replace with actual address printed by deploy)
$env:TEST_RENT_CONTRACT = '0x...'

# Run Playwright E2E
npm --prefix ./front run e2e
```
