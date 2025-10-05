# Copilot Instructions for LegalContractsDemo

## Project Overview
- **Purpose:** Smart contract templates (NDA, Rent) with AI-powered arbitration using Chainlink Functions and Ollama LLMs.
- **Major Components:**
  - Solidity contracts in `contracts/` (NDA, Rent, ArbitrationService, MerkleEvidenceManager)
  - V7 backend in `server/` (Node.js, direct Ollama LLM integration, fallback simulation)
  - Frontend in `front/` (uses contract helpers, evidence digest computation)
  - Tools in `tools/` (legacy Python arbitrator, Chainlink scripts, admin utilities)

## Architecture & Data Flow
- **Dispute Resolution:**
  - On-chain contracts emit dispute events
  - Evidence digests submitted (keccak256, optionally encrypted off-chain)
  - Backend (`server/index.js`) processes arbitration using Ollama LLM or simulation fallback
  - Chainlink Functions (`tools/chainlink_arbitrator.js`) can call AI arbitrator API (legacy)
- **Evidence Handling:**
  - Frontend computes evidence digests, never handles admin private keys
  - Encrypted evidence uploaded off-chain; digest stored on-chain
  - Admin decryption tools in `tools/admin/` (never bundle in frontend)

## Developer Workflows
- **Build & Test:**
  - Install: `npm install` in root, `front/`, and `server/`
  - Run backend: `npm run start:v7` in `server/`
  - Run frontend: `npm run dev` in `front/`
  - Run Hardhat node: `npx hardhat node`
  - Run tests: `npx hardhat test test/NDA.test.js` or `npx hardhat test test/evidence.e2e.test.js`
  - Deploy contracts: `npx hardhat run scripts/deploy.js`
- **Legacy AI Arbitrator (Python):**
  - Setup: Install Ollama, models, Python deps (see `tools/README.md`)
  - Run: `uvicorn arbitrator_api:app --host 0.0.0.0 --port 8000`

## Key Patterns & Conventions
- **Evidence:** Use `front/src/utils/evidence.js` for digest/encryption. Store only digests on-chain.
- **Security:** Never expose admin keys in frontend. Use explicit memory cleanup and error codes in Chainlink scripts.
- **Testing:** E2E tests use Playwright and modern ethers v6 API.
- **Fallbacks:** Backend arbitration falls back to simulation if LLM fails.
- **Deprecated:** Python arbitrator is legacy; use Node.js backend for new development.

## Integration Points
- **Chainlink Functions:** JS scripts in `tools/` interact with arbitrator API.
- **Ollama LLM:** Backend integrates directly for arbitration decisions.
- **Admin Tools:** Evidence decryption and management in `tools/admin/` (trusted environments only).

## Example: Evidence Digest Workflow
```js
import { prepareEvidencePayload } from 'front/src/utils/evidence';
const { digest } = await prepareEvidencePayload('evidence text');
// Submit digest to contract
```

## References
- Contracts: `contracts/`
- Backend: `server/index.js`, `server/modules/`
- Frontend: `front/src/`
- Tools: `tools/README.md`, `tools/chainlink_arbitrator.js`, `tools/arbitrator_api.py` (legacy)

---
**Feedback requested:** Please review for missing or unclear sections. Suggest improvements for agent productivity.

## Frontend Merkle Improvements (A–D)
Implemented Full Struct Mode for `MerkleEvidenceManager` batching:

### A. Real caseId Source
- `ContractModal.jsx` derives a contextual `caseId` (active dispute via contract methods, fallback to last disputeCount or address tail) and passes it to `EvidenceBatchModal`.
- Each evidence item leaf encodes: `(caseId, contentDigest, cidHash, uploader, timestamp)`.

### B. Client-side Merkle Proof Generation
- `merkleHelper.js` now exports `generateMerkleProof(leaves, index)` producing sibling path (bottom-up) consistent with contract verification logic.
- `EvidenceBatchModal.jsx` adds a Generate Proof button per stored item. Downloads JSON: `{ root, leaf, caseId, contentDigest, cidHash, uploader, timestamp, proof[] }`.

### C. Memory Optimization
- After Helia upload, raw `bytes` are removed from state (`bytes: undefined`) to reduce memory footprint for large batches.

### D. UX / Feedback Layer
- Replaced `alert()` with notification toasts via existing `NotificationContext` (types: success, error, info).
- Added status strings (`batchSubmitStatus`) and notifications for batch submission lifecycle.
- Proof generation success/failure also surfaces via toasts.

### Tree Construction & Ordering
- Leaves are full struct hashes: `keccak256(abi.encode(EvidenceItem))`.
- Pair hashing uses lexicographic ordering of the two child hashes; odd-last duplication rule preserved.
- Proofs are sibling list in leaf-to-root order; contract `verifyEvidence` recomputation matches root using same ordering.

### Developer Notes
- When integrating a canonical dispute/case ID in future contracts, replace fallback logic in `EvidenceTabContent`.
- If batch size grows large, consider streaming leaf computation and incremental Merkle layer caching for O(n) memory.
- For gas analysis, batch size limit currently guided by `MAX_BATCH_SIZE` on-chain (256).

### Future Enhancements (Not Yet Implemented)
- On-chain proof preview before submission.
- Optional manifest CID anchoring.
- Batch finalization UI (calls `finalizeBatch`).
- E2E tests for proof JSON export and verification round-trip.
