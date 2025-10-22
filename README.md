<div align="center">

# ArbiTrust

Arbitration-driven on-chain contract templates (NDA & Rent). This repository provides smart-contract templates with AI-powered arbitration via Chainlink Functions for automated dispute resolution.

</div>


## Recent Changes (October 2025) - V7 Release

- **NEW**: 🦙 **Ollama LLM Integration** - Native Ollama integration for on-prem LLM arbitration (no external Python dependencies)
- **NEW**: 🚀 **Unified V7 Backend** - Single Node.js server with integrated arbitration
- **NEW**: 🌳 **Merkle Evidence System** - Gas-efficient batched evidence submission with 82% cost savings
- **NEW**: 🧹 **Unified Deployment** - Single `deploy.js` script for all infrastructure (replaces 3 separate scripts)
- **COMPLETE MIGRATION**: All contract views, event listeners, and evidence/dispute/arbitration flows have been fully migrated to EnhancedRentContract/NDATemplate. Legacy TemplateRentContract logic and event handling are fully removed from all layers (frontend, backend, scripts, docs).

## Overview


What you get:
- `NDATemplate` contract with deposits, breach reporting and arbitrator hooks
- `EnhancedRentContract` (replaces TemplateRentContract) with AI arbitration, Merkle evidence batching, and deposit capping mechanisms
 **V7 Backend**: Integrated Ollama LLM arbitration with simulation fallback
## Architecture
### LLM Arbitration Verdict Format & Flow

**LLM Verdict Format:**
```
VERDICT: [PARTY_A_WINS | PARTY_B_WINS | NO_PENALTY | DRAW]
RATIONALE: [brief explanation]
CONFIDENCE: [0.0-1.0]
REIMBURSEMENT: [amount or NONE]
```

## V7 Quickstart (Hardhat + Helia + Ollama)

This quickstart shows a minimal local setup to run the V7 server with a local Hardhat node, a Helia (IPFS) store, and an Ollama LLM instance. Commands are shown for Windows PowerShell.

Prereqs:
- Node.js (16+) and npm
- npx/hardhat
- Ollama installed locally (or running on a host reachable via OLLAMA_HOST)

1) Install dependencies

```
npm install
```

2) Start a local Hardhat node (PowerShell):

```
npx hardhat node
```

3) (Optional) Start Helia externally, or let the server start an in-process Helia instance. To run an external Helia-compatible daemon, set HELIA_LOCAL_API to the daemon URL. If you want the server to start an in-process Helia, set START_INPROC_HELIA=1.

Example (use in-process Helia):

```
	subgraph Deployment
```

Example (explicit Helia API):

```
		D[Deployer / Frontend] -- creates --> F[ContractFactory]
```

4) Start Ollama (on the machine or another host accessible by the server). Ensure the model name you plan to use is available (e.g., llama3.2). Set OLLAMA_HOST/OLLAMA_PORT or OLLAMA_URL in your `.env` if using non-default addresses.

PowerShell example (if Ollama is installed and exposes a CLI command):

```
# start Ollama (example placeholder if installed as a service)
Start-Process -FilePath "ollama" -ArgumentList "serve"
```

5) Start the V7 server (PowerShell), with an example environment file:

```
		F -- createNDA() --> N[NDATemplate]
```

6) Verify Helia evidence upload (quick smoke test):

Use PowerShell to POST a sample JSON body to the evidence upload endpoint (server default port: 3001). The server will return a real CID when Helia is available.

```
$body = @{ ciphertext = "SGVsbG8gV29ybGQ=" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/evidence/upload" -ContentType "application/json" -Body $body
```

Expected response (example):

```
{
	"cid": "bafybeigdyrzt7examplecidfakexyz1234567890abcdef",
	"stored": true,
	"size": 111,
	"heliaConfirmed": true
}
```

7) Verify Ollama health and a quick arbitration call:

```
Invoke-RestMethod -Method Get -Uri "http://localhost:3001/api/v7/arbitration/ollama/health"

$req = @{ evidenceData = "Test evidence"; contractAddress = "0x..." } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/v7/arbitration/ollama" -ContentType "application/json" -Body $req
```

Notes:
- V7 no longer returns mock CIDs. If the server cannot access Helia or Ollama it will return an explicit error (5xx/4xx) rather than silently providing a mock response.
- For CI or ephemeral runs you can start lightweight Helia and Ollama instances in your test environment. The repository includes tests that exercise local Helia + Ollama flows.
- If you rely on Chainlink/CCIP integrations, ensure RPC_URL points to a running JSON-RPC provider (e.g., hardhat node at http://127.0.0.1:8545).

Deployment notes (automated wiring)
----------------------------------

The unified `scripts/deploy.js` script now handles most deployment needs for local testing and wiring of contracts to the `ArbitrationService`.
		F -- createEnhancedRent() --> R[EnhancedRentContract]
	end
	N -- reportBreach(offender, requested, evidenceHash) --> A[Arbitrator (owner/manual)]
	A -- resolve() call (owner) --> N2[NDATemplate.applyResolution]
	N2 -- Funds distribution + case closed --> End[End]
	R -- reportDispute(digest, amount) --> A2[Arbitrator (owner/manual)]
	A2 -- resolve() call (owner) --> R2[EnhancedRentContract.applyResolution]
	R2 -- Funds distribution + case closed --> End2[End]
```

> **Note:** All template deployments in this repo are intended to be created via `ContractFactory`.

## Quickstart

Prereqs:
- Node.js and npm
- Hardhat

Install deps:
```
npm install
```

Deployment notes (automated wiring)
----------------------------------

The unified `scripts/deploy.js` script now handles all deployment needs:

- **Core Infrastructure**: Deploys `ContractFactory`, `ArbitrationService`, `RecipientKeyRegistry`, and `Arbitrator`
- **Merkle Evidence System**: Deploys `MerkleEvidenceManager` for gas-efficient evidence batching
- **Automatic Wiring**: Configures all contract relationships and permissions
- **Frontend Integration**: Copies ABIs and generates configuration files automatically
- **Gas Optimization**: Test deployment shows 82% gas savings for batched evidence submission

**Previous scripts consolidated:**
- ✅ `deploy.js` (unified - current)
- 🗑️ `deploy-clean.js` (legacy - archived)
- 🗑️ `deploy-merkle-evidence.js` (merged - archived)
- 🗑️ `deploy-unified.js` (duplicate - removed)

How to run the common verification steps locally
------------------------------------------------

1. Start a local Hardhat node:

```
npx hardhat node
```

2. Deploy and copy ABIs to the frontend:

```
npx hardhat run scripts/deploy.js --network localhost
```

3. Run the smoke test to exercise Rent and NDA flows:

```
npx hardhat run scripts/smokeTest.js --network localhost
```

4. Quick frontend check (verifies generated JSON and ABI files):

```
node scripts/checkFrontendContracts.js
```

```

Compile:
```
npm run compile
```

Run tests:
```
npm test
```

Start a local node (optional):
```
npm run node
```

## Environment (.env)

Create a `.env` file in the project root (copy from `.env.example`). `.env` is already in `.gitignore`.

**V7 AI Arbitration Configuration:**

For full AI arbitration functionality, you'll need:

**Chainlink Functions:**
- `CHAINLINK_SUBSCRIPTION_ID` - Your Chainlink Functions subscription ID
- `CHAINLINK_ROUTER_ADDRESS` - Chainlink Functions router contract address
- `CHAINLINK_DON_ID` - Decentralized Oracle Network ID
- `ORACLE_PRIVATE_KEY` - Private key for the oracle account

**AI Arbitrator API:**
- `ARBITRATOR_API_URL` - URL of the AI arbitrator service (default: http://localhost:8000/arbitrate)
- `OLLAMA_MODEL` - LLM model name (default: llama3.2:latest)

**Blockchain Networks:**
- `RPC_URL` - Ethereum RPC endpoint
- `PRIVATE_KEY` - Deployer private key
- `ETHERSCAN_API_KEY` - For contract verification

For local testing, the system defaults to localhost endpoints and uses Hardhat's built-in accounts.

## Deploying contracts

Scripts live under `scripts/`.

Deploy (examples):
```
npm run deploy:localhost
npm run deploy:sepolia
```

Notes:
- `ContractFactory` is used to deploy NDA and EnhancedRent templates and initialize admin/parties.

## Frontend

ABIs are copied into `front/src/utils/contracts`. The V7 UI integrates with:

- **AI Arbitration Flow**: Create case → Trigger Chainlink Functions → AI decision → Automatic resolution
- **Deposit Capping**: When requested amount exceeds available deposits, system automatically caps to available amount
- **Merkle Evidence Batching**: EnhancedRentContract supports gas-efficient batched evidence submission (see docs)
- **Evidence Encryption**: Client-side encryption to admin public key with keccak256 digest storage on-chain
- **Real-time Updates**: Event listening for `DisputeAppliedCapped` and `ResolutionApplied` events

### E2E Testing


Run the complete arbitration flow test:
```bash
cd front
npm test -- tests/e2e/enhanced.rent.e2e.spec.ts
```

The E2E test validates:
- Contract deployment and signing (NDA & EnhancedRent)
- Dispute creation with bond deposits
- AI arbitration via ArbitrationContractV2
- Deposit capping when requested > available
- Merkle evidence batching (EnhancedRentContract)
- Fund distribution and withdrawable tracking

### Admin decryption helper

Evidence ciphertexts are intended to be encrypted client-side to an admin public key and stored off-chain (the contract stores only the `bytes32` keccak256 digest of the ciphertext). Admin-only decryption utilities live under `tools/admin/` and are intended to run in a trusted admin environment (server or CLI).

Do NOT include admin private keys or decryption modules in client-side bundles. Keep decryption in a trusted admin environment and store keys securely (HSM or vault).

## Tests

Hardhat tests cover NDA flows, the owner arbitrator, and rent contract workflows.

Run:
```
npm test
```

## Admin tooling note

Admin decryption utilities live under `tools/admin/`. These helpers are intended for trusted admin environments only. Do not commit private keys or bundle admin helpers into front-end builds. See `tools/admin/README.md` for usage and a CLI wrapper.

## Troubleshooting

- If tests fail due to configuration, ensure dependencies are installed and run `npm run compile`.
- Secrets and external integrations are no longer part of this repo; nothing to configure for Chainlink or AI.

## Security

- Never commit real secrets. `.env` is git-ignored.
- The NDA contract clamps penalties to an offender’s available deposit to avoid overdrafts.

## ABI / Evidence digest change (2025-09)


EnhancedRentContract and NDATemplate store off-chain evidence as a `bytes32` digest (keccak256 of the off-chain payload) instead of relying on raw string CIDs or URIs on-chain. This reduces gas and standardizes verification.
Smart-contract entrypoints:
	- `reportDispute(...)` (EnhancedRentContract) accepts a `bytes32 evidenceDigest` only; the contract no longer stores or references raw off-chain URIs.
	- Merkle evidence batching is supported in EnhancedRentContract for gas savings.

If you maintain integrations or UIs, update your contract ABIs and prefer providing the digest precomputed by the frontend (see `front/src/services/contractService.js`).

## Evidence Submission (submitEvidence vs submitEvidenceWithDigest)

Two related evidence anchoring entrypoints exist on the rent template (and may be mirrored on future templates):

- `submitEvidence(caseId, cid)`
	- Stores ONLY `cidDigest = keccak256(utf8Bytes(cid))`.
	- Emits `EvidenceSubmitted(caseId, cidDigest, submitter, cid)`.
	- Lowest gas cost (single SSTORE for the duplicate-prevention bitmap/mapping).
	- Suitable when the off-chain object is content-addressed (e.g., Helia CID already binds content) and you only need duplicate prevention + a stable reference.

- `submitEvidenceWithDigest(caseId, cid, contentDigest)`
	- Stores both `cidDigest` (for duplicate prevention) AND a caller‑provided `contentDigest` (a keccak256 hash of a canonicalized JSON payload or other deterministic representation).
	- Emits `EvidenceSubmittedDigest(caseId, cidDigest, contentDigest, submitter, cid)`.
	- Adds one extra SSTORE (slightly higher gas) but enables stronger tamper detection if the underlying off-chain CID ever re-hosts modified data or if you use gateways that could return inconsistent encodings.
	- Recommended when: (1) you canonicalize JSON client-side (e.g., stable key order, stripped whitespace) and hash that canonical string, or (2) you want a chain-stored digest independent from any particular content-addressing scheme.

### Choosing which to call

Frontend logic can optimistically attempt `submitEvidenceWithDigest` first (providing both the CID and the precomputed `contentDigest`) and fall back to `submitEvidence` if the extended function is unavailable on older deployments. This repository's current frontend already follows that pattern.

### Digest computation reference

See `front/src/utils/evidenceCanonical.js` (or similarly named utility) for:
1. Canonicalizing a JSON envelope.
2. Computing `contentDigest = keccak256(canonicalBytes)`.
3. Computing `cidDigest = keccak256(utf8Bytes(cid))`.

Store only the 32-byte digest(s) on-chain; do NOT store raw ciphertext, large JSON, or CIDs unless absolutely required—this keeps gas low and simplifies verification.

### Verifying on the client / admin side

1. Fetch the evidence record (CID + stored digests) via events (`EvidenceSubmitted` or `EvidenceSubmittedDigest`).
2. Retrieve the off-chain object (Helia, HTTPS, etc.).
3. Canonicalize (exact same algorithm) and recompute contentDigest.
4. Compare with the on-chain `contentDigest` (when using the extended method). If mismatch → treat as tampered / invalid.
5. Optionally recompute `cidDigest` from the original CID string and ensure it matches what was emitted.

## Recipient Public Key Sync CLI

Encrypted evidence expects a registry of recipient ECIES public keys (e.g., admin, landlord, tenant). To reduce manual editing, a lightweight CLI tool normalizes a config file into the runtime JSON consumed by the frontend.

Script: `tools/admin/sync-recipient-keys.js`

Usage:

```
node tools/admin/sync-recipient-keys.js path/to/recipients.config.json recipient_pubkeys.json
```

Input config structure example (`recipients.config.json`):

```json
{
	"recipients": [
		{ "address": "0xAbC123...", "pubkey": "04abcdef..." },
		{ "address": "0xDeF456...", "pubkey": "0499ffee..." }
	]
}
```

Output: A normalized array written to the specified output path (commonly the project root `recipient_pubkeys.json`):

```json
[
	{ "address": "0xAbC123...", "pubkey": "04abcdef..." },
	{ "address": "0xDeF456...", "pubkey": "0499ffee..." }
]
```

### Exit codes & validation

- 1: Usage error (missing args)
- 2: Config file not found
- 3: Invalid JSON
- 4: Missing `recipients` array
- 5: No valid recipients after filtering

Recipients missing either `address` or `pubkey` are skipped with a console warning.

### Frontend auto-registration flow

On load, the Evidence UI reads `recipient_pubkeys.json` and registers each `{address, pubkey}` into an in-memory registry. When a user enables encryption and no explicit recipients were manually selected, the registry list is used automatically—ensuring consistent encryption targets across runs and test environments.

### Recommended workflow

1. Maintain a human-friendly source file: `recipients.config.json` (can include comments if you preprocess; JSON5 not directly supported).
2. Run the sync script whenever keys change:
	 ```
	 node tools/admin/sync-recipient-keys.js recipients.config.json recipient_pubkeys.json
	 ```
3. Commit `recipient_pubkeys.json` ONLY if keys are public (they should be). Never place private keys in these files.
4. Restart / refresh the frontend so it picks up the updated registry.

### Security notes

- Only public encryption keys should appear here—no signing or private keys.
- Rotate keys by updating the source config and re-running the sync tool; consumers will start encrypting to the new keys once redeployed/refreshed.
- If a key is compromised, remove its entry and (optionally) publish an on-chain revocation or registry update depending on your broader key management strategy.

### Testing convenience

Playwright tests can inject a known private key (for a test recipient) into the window scope to allow deterministic decryption assertions. Ensure this key is never a production key.

---

For additional admin-side decryption and verification utilities, see `tools/admin/` and associated README notes.

## License

This is a demo. Add your preferred license file if you plan to distribute.
