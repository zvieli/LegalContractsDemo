## Quick orientation for coding agents

This repository (ArbiTrust) implements arbitration-driven smart-contract templates (NDA & EnhancedRent) with a unified Node.js V7 backend that integrates an LLM-based arbitrator (Ollama) and a simulator fallback. Use this doc to get productive fast: where to read, how to run, and which patterns matter.

### Big picture (read first)
- Contracts: `contracts/` contains `NDATemplate`, `EnhancedRentContract`, `ArbitrationService`, `ContractFactory` and related templates. Templates are intended to be created via `ContractFactory`.
- Backend: `server/` is the unified V7 server that exposes evidence, arbitration, and admin endpoints. Key file: `server/index.js`.
- Frontend: `front/` (Vite). ABIs and generated contract JSON are copied into `front/src/utils/contracts` by `scripts/copy-abi.js`.
- Deploy & scripts: `scripts/deploy.js` is the canonical, unified deploy script. Use Hardhat for local testing and deployment.

### Essential commands (from `package.json`)
- Install: `npm install`
- Compile contracts: `npm run compile` (uses Hardhat)
- Start local Hardhat node: `npm run node` (or `npx hardhat node`)
- Deploy to localhost: `npm run deploy:localhost` (runs `scripts/deploy.js`)
- Run tests: `npm test` (Hardhat tests); e2e/frontend tests live under `front/`.
- Copy ABIs to frontend: `npm run copy-abi`
- Run development frontend: `npm run dev` (in project root or inside `front/`)
- Evidence dev server (test helper): `npm run evidence-server` (`node tools/evidence-endpoint.js`)
- Local LLM arbitrator (optional test harness): `npm run arbitrator-api` (from `tools/` - UVicorn) or `npm run arbitrator-docker`.

### Runtime / environment notes
- `.env` (copy from `.env.example`) holds keys used by Hardhat, Chainlink, and LLM wiring. Relevant names: `RPC_URL`, `PRIVATE_KEY`, `ETHERSCAN_API_KEY`, `OLLAMA_MODEL`, `ARBITRATOR_API_URL`, `FORCE_SIMULATOR`.
- The server supports a runtime override header `x-force-simulator` (any truthy value) to force simulator responses without changing env.
- Helia (local IPFS-like store) is optional: server modules attempt Helia and gracefully fall back to in-memory storage.

### Important patterns & gotchas (search these files)
- ArbitrationService design: `ArbitrationService.applyResolutionToTarget` attempts low-level `call` to common entrypoints rather than strong ABI coupling. This keeps template bytecode small. See `contracts/ArbitrationService.sol`.
- Templates no longer store direct `arbitrator` addresses; the flow is: Arbitrator (owner) -> ArbitrationService -> Template. Update UIs accordingly. See `README.md` and `contracts/`.
- Evidence digests: templates store `bytes32` digests (keccak256) of off-chain evidence, not raw CIDs/strings. Two submission methods exist: `submitEvidence(caseId, cid)` and `submitEvidenceWithDigest(caseId, cid, contentDigest)`. Prefer `submitEvidenceWithDigest` when client-side canonicalization is available. See `README.md` and frontend evidence helper `front/src/utils/evidenceCanonical.js`.
- Merkle batching: `EnhancedRentContract` supports Merkle evidence batching to reduce gas. Look for `MerkleEvidenceManager.sol` and the batch handling code in `server/`.

### Server endpoints you will likely call in tests / local dev
- POST `/api/arbitrate-batch` — server-side arbitration entrypoint (accepts merkle batch payload). Implementations will run Ollama or simulator depending on env/header. See `server/index.js`.
- POST `/api/v7/arbitration/ollama-test` — quick Ollama test with simulator fallback.
- POST `/api/evidence/upload` — evidence ingestion (Helia preferred, in-memory fallback).
- GET `/api/evidence/validate/:cid` and `/api/evidence/retrieve/:cid` — test helpers for evidence flows.
- GET `/api/dispute-history/:caseId` — dispute history used by frontend tests.

### Files to read first for changes
- `README.md` (root) — project overview and patterns (LLM verdict format, evidence workflow).
- `server/index.js` — backend wiring, simulator vs Ollama fallback logic, important headers/env usage.
- `scripts/deploy.js` — unified deploy and automatic wiring of `ContractFactory`, `ArbitrationService`, `MerkleEvidenceManager`, and `Arbitrator`.
- `hardhat.config.js` — networks and fork/dev configuration (named accounts used in tests).
- `front/src/utils/contracts` and `scripts/copy-abi.js` — how ABIs/config are shared with front.
- `tools/admin/sync-recipient-keys.js` — recipient public key sync CLI referenced by frontend.

### Quick examples for common tasks (copyable)
- Start Hardhat node and deploy locally:

  npx hardhat node
  npm run deploy:localhost

- Run a smoke test (after deploy):

  npx hardhat run scripts/smokeTest.js --network localhost

### Conventions for edits
- When touching arbitration logic, update both `server/` and any simulator hooks (`server/modules/llmArbitrationSimulator.js` or similar) so tests can force deterministic responses.
- Prefer adding unit tests under `test/` or `server/tests/` that reproduce the end-to-end flow: deploy, create dispute, submit evidence (with contentDigest), call arbitration endpoint, assert dispute history and events.

If anything in this document is unclear or you want more detail (examples of merkle batch payload shape, arbitration simulator contract signatures, or sample .env values for local testing), tell me which section and I'll expand with concrete snippets and test harnesses.
