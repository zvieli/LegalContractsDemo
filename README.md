<div align="center">

# ArbiTrust

Arbitration-driven on-chain contract templates (NDA & Rent). This repository provides smart-contract templates with AI-powered arbitration via Chainlink Functions for automated dispute resolution.

</div>

## Recent Changes (October 2025) - V7 Release

- **NEW**: 🦙 **Ollama LLM Integration** - Native Ollama integration with automatic fallback to simulation mode
- **NEW**: 🚀 **Unified V7 Backend** - Single Node.js server with integrated arbitration (no external Python dependencies)
- **NEW**: 🎯 **Hybrid Arbitration System** - Real LLM decisions with simulation fallback for reliability
- **NEW**: ⚡ **Improved Performance** - Direct Ollama integration eliminates API overhead
- **NEW**: 🌳 **Merkle Evidence System** - Gas-efficient batched evidence submission with 82% cost savings
- **NEW**: 🧹 **Unified Deployment** - Single `deploy.js` script for all infrastructure (replaces 3 separate scripts)
- **DEPRECATED**: 🗑️ Python FastAPI arbitrator (moved to `tools/legacy/`)
- Enhanced `ArbitrationService.sol` with improved validation and event emission
- Updated E2E tests for modern ethers v6 API compatibility
- **NEW**: Comprehensive E2E test suite with Playwright for V7 integration

## Overview

This repo demonstrates how to encode dispute resolution into smart contracts and resolve disputes using **Ollama LLM-powered arbitration** with automatic fallback mechanisms.

What you get:
- `NDATemplate` contract with deposits, breach reporting and arbitrator hooks
- `TemplateRentContract` with AI arbitration and deposit capping mechanisms
- **V7 Backend**: Integrated Ollama LLM arbitration with simulation fallback
- Enhanced `ArbitrationService` with comprehensive validation
- Hardhat tests and scripts to deploy/configure the complete system
- **No Python dependencies** - Pure Node.js implementation

## Architecture

- **V7 Backend Server:**
	- `server/index.js` — Unified V7 backend with Ollama LLM integration
	- `server/modules/ollamaLLMArbitrator.js` — Direct Ollama integration with fallback
	- `server/modules/llmArbitrationSimulator.js` — Rule-based simulation for testing/fallback
	- Evidence validation, time management, and arbitration processing

- **Smart Contracts:**
	- `ArbitrationService.sol` — Central dispatcher applying arbitration decisions to target contracts
	- `NDATemplate.sol` — NDA between parties with deposits, breach reporting and arbitration hooks
	- `TemplateRentContract.sol` — Rent contract with dispute reporting and AI arbitration
	- `Arbitrator.sol` — Reference implementation for manual arbitration (legacy fallback)

- **API Endpoints (V7):**
	- `POST /api/v7/arbitration/ollama` — Ollama LLM arbitration (primary)
	- `POST /api/v7/arbitration/simulate` — Simulation mode arbitration (fallback)

## Project Structure

The project is organized for clarity and maintainability:

```
LegalContractsDemo/
├── contracts/          # Smart contracts (Solidity)
├── server/             # V7 Backend (Node.js + Ollama)
│   ├── modules/        # LLM arbitration modules
│   └── test/           # Backend tests
├── front/              # Frontend (Vite + MetaMask)
├── docs/               # Main documentation
│   └── archive/        # Historical documentation
├── scripts/            # Deployment and utility scripts
├── logs/               # Log files and outputs
├── test/               # Contract tests (Hardhat)
├── WALLETS.txt         # Important wallet information
└── README.md           # This file
```

### Key Files
- **`.env`** - Environment configuration with optimized LLM settings
- **`hardhat.config.js`** - Hardhat configuration
- **`package.json`** - Project dependencies
- **`WALLETS.txt`** - Wallet addresses and keys (IMPORTANT!)

### Documentation
- **Main docs**: `docs/` - Current specifications and guides
- **Archive**: `docs/archive/` - Historical migration documentation
- **Optimization**: `docs/LLM_OPTIMIZATION_GUIDE.md` - LLM performance tuning
	- `GET /api/v7/arbitration/ollama/health` — Ollama service health check

### V7 Arbitration Flow

```
 ┌──────────────┐     dispute      ┌────────────────────┐
 │ Smart        │ ─────────────▶   │ V7 Backend Server  │
 │ Contract     │                  │ (Node.js + Ollama) │
 └──────────────┘                  └─────────┬──────────┘
                                            │
                ┌──────────────────┬────────▼─────────────┐
                │                  │                      │
                ▼                  ▼                      ▼
        ┌───────────────┐  ┌─────────────────┐  ┌─────────────────┐
        │ 🦙 Ollama LLM │  │ 🎯 Simulation   │  │ 📊 Evidence     │
        │ Primary AI    │  │ Fallback Mode   │  │ Validation      │
        │ Arbitration   │  │ Rule-based      │  │ IPFS/Helia      │
        └───────────────┘  └─────────────────┘  └─────────────────┘
                │                  │                      │
                └──────────────────┼──────────────────────┘
                                   │
                                   ▼
                           ┌─────────────────┐
                           │ Arbitration     │
                           │ Decision        │
                           │ (JSON Response) │
                           └─────────────────┘
```

### ArbitrationService (wiring & notes)

- Purpose: central, owner-controlled service that applies arbitrator resolutions to template contracts using low-level ABI attempts. This keeps template bytecode small and avoids coupling templates to a specific arbitrator ABI.
- Typical wiring steps:
	1. Deploy `ArbitrationService`.
	2. Deploy `Arbitrator` (your platform's arbitrator factory or reference implementation).
	3. Transfer the service ownership to the arbitrator: `arbitrationService.transferOwnership(arbitratorAddress)` so the arbitrator can call `applyResolutionToTarget`.
	4. Prefer configuring arbitration at the factory level so templates are created with an immutable `arbitrationService` set at deployment. Example wiring:
	   - Deploy `ArbitrationService` and, if using an `Arbitrator`, transfer ownership of the service to the arbitrator so it can call `applyResolutionToTarget`.
	   - Call `ContractFactory.setDefaultArbitrationService(arbitrationServiceAddress, requiredDeposit)` from the factory owner. Then create templates via the factory; they will receive the configured `arbitrationService` and required deposit immutably in their constructor.
	   - For existing templates (already deployed without an immutable arbitration address), use an appropriate migration or redeploy pattern; templates in this repository are designed to be created via `ContractFactory`.

- ABI compatibility: `ArbitrationService.applyResolutionToTarget` attempts common entrypoints (e.g., `serviceResolve(...)` for NDA templates and `resolveDisputeFinal(...)` for rent templates) using low-level `call`. If none match the target, the service reverts with `No compatible resolution entrypoint on target`.

- Breaking change note: The older compatibility shim `resolveByArbitrator` and direct template-level `arbitrator` storage were removed from templates (NDA & Rent). Update any UI/integrations to follow the ArbitrationService → Arbitrator flow.

Flow (prod / local):
1. Party reports a breach in `NDATemplate`.
2. A dispute is created and the configured arbitrator is notified (owner‑controlled in this repo).
3. The arbitrator resolves the dispute by instructing the `ArbitrationService` to apply the resolution to the NDA; templates only accept the configured service as an authorized caller.
4. `NDATemplate` applies the resolution: enforcement may be deferred by an appeal window or applied immediately; fund distribution uses a pull‑payment ledger.

### NDA Contract Deployment & Arbitration Flow Diagram

```
 (Deployment Phase)
 ┌──────────────┐        creates        ┌────────────────────┐
 │ Deployer /   │ ───────────────────▶  │ ContractFactory    │
 │ Frontend     │                      │ (creates templates)│
 └──────────────┘                       └─────────┬──────────┘
											 │ createNDA()
											 ▼
 ┌──────────────────────────────────────────────────────────┐
 │                     NDATemplate                          │
 │  - deposits(A,B)                                         │
 │  - reportBreach(offender, requested, evidenceHash)       │
 │  - stores case state                                     │
 │  - receives resolution (approve, penalty, beneficiary)   │
 └──────────┬───────────────────────────────┬───────────────┘
						│
						│ reportBreach(offender, requested, evidenceHash)
						▼
	 ┌──────────────────┐
	 │ Arbitrator        │
	 │ (owner / manual)  │
	 └─────────┬─────────┘
						 │ resolve() call (owner)
						 ▼
			NDATemplate.applyResolution()
						 │
						 ▼
		 Funds distribution + case closed
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
- `ContractFactory` is used to deploy templates and initialize admin/parties.

## Frontend

ABIs are copied into `front/src/utils/contracts`. The V7 UI integrates with:

- **AI Arbitration Flow**: Create case → Trigger Chainlink Functions → AI decision → Automatic resolution
- **Deposit Capping**: When requested amount exceeds available deposits, system automatically caps to available amount
- **Evidence Encryption**: Client-side encryption to admin public key with keccak256 digest storage on-chain
- **Real-time Updates**: Event listening for `DisputeAppliedCapped` and `ResolutionApplied` events

### E2E Testing

Run the complete arbitration flow test:
```bash
cd front
npm test -- tests/e2e/template.rent.e2e.spec.ts
```

The E2E test validates:
- Contract deployment and signing
- Dispute creation with bond deposits
- AI arbitration via ArbitrationContractV2
- Deposit capping when requested > available
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

- New contracts store off-chain evidence as a `bytes32` digest (keccak256 of the off-chain payload) instead of relying on raw string CIDs or URIs on-chain. This reduces gas and standardizes verification.
- Smart-contract entrypoints:
	- `reportDispute(...)` accepts a `bytes32 evidenceDigest` only; the contract no longer stores or references raw off-chain URIs.

If you maintain integrations or UIs, update your contract ABIs and prefer providing the digest precomputed by the frontend (see `front/src/services/contractService.js`).

## Evidence Submission (submitEvidence vs submitEvidenceWithDigest)

Two related evidence anchoring entrypoints exist on the rent template (and may be mirrored on future templates):

- `submitEvidence(caseId, cid)`
	- Stores ONLY `cidDigest = keccak256(utf8Bytes(cid))`.
	- Emits `EvidenceSubmitted(caseId, cidDigest, submitter, cid)`.
	- Lowest gas cost (single SSTORE for the duplicate-prevention bitmap/mapping).
	- Suitable when the off-chain object is content-addressed (e.g., IPFS CID already binds content) and you only need duplicate prevention + a stable reference.

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
2. Retrieve the off-chain object (Helia/IPFS, HTTPS, etc.).
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
