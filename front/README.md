Frontend notes

- The front-end uses the contract service helpers in `front/src/services/contractService.js` to compute evidence digests. Do NOT attempt to import admin decryption helpers into the front-end.
- Admin decryption tooling lives in `tools/admin/` and is intended for trusted admin environments only. Do not bundle private keys or admin helpers into the front build.

Build / dev

```
npm install
npm run dev
```
Front-end notes

This frontend attempts to use the injected wallet provider (e.g. MetaMask) for all on-chain reads and writes. For local development with Hardhat, MetaMask sometimes blocks or returns an internal RPC error ("Execution prevented because the circuit breaker is open").

To make local development smoother the frontend will automatically fall back to a direct JSON-RPC provider at `http://127.0.0.1:8545` for certain read-only RPCs (such as `eth_getCode`) when the app detects it's connected to a localhost chain (chainId 31337/1337/5777) and the injected provider fails.

If you see errors in the browser console about the circuit breaker, ensure your local Hardhat node is running (`npx hardhat node`) and that MetaMask is pointed at the same network.

Evidence workflow (client-side helper)

Use `front/src/utils/evidence.js` to prepare evidence payloads before reporting:

```js
import { prepareEvidencePayload } from './src/utils/evidence';

// Example: encrypt to admin public key then upload ciphertext off-chain
const { ciphertext, digest } = await prepareEvidencePayload('some secret text', { encryptToAdminPubKey: '04abcd...' });
// upload `ciphertext` to your storage (S3 / server), then call the contract with `digest`
// e.g. contract.reportDispute(caseType, amount, digest)
```

If you do not want client-side encryption, call `prepareEvidencePayload(payload)` and it will return `{ digest }` computed over the plaintext.

Short note on evidence and admin keys

- The front-end only computes and submits a bytes32 evidence digest (keccak256) to the contract. For empty evidence the canonical sentinel `ethers.ZeroHash` is used. The front-end does not and must not hold admin private keys.
- If you choose the encrypted evidence flow: the client encrypts the plaintext to the admin public key (ECIES) and uploads the ciphertext to your off-chain storage (S3/HTTPS). The contract should store the keccak256 digest of the ciphertext only. Admins fetch the ciphertext off-chain and decrypt it using the secure CLI/tools under `tools/admin/` on a trusted machine.
- Never embed admin private keys in the front-end bundle or in public repositories. Prefer secure key storage such as environment variables on a locked admin host, cloud KMS/HSM, or a secrets manager.
