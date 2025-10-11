# Repo-specific Copilot instructions for contributors

This repository implements ArbiTrust: Solidity templates (NDA, Rent) + a V7 Node.js backend (Ollama LLM arbitration) and a Vite React frontend. Use these concise pointers to be immediately productive.

- Big picture
  - Smart contracts are in `contracts/` and are intended to be created via `ContractFactory` (see `test/` and `scripts/deploy.js`). `ArbitrationService` is the owner-controlled dispatcher that applies resolutions to template contracts.
  - V7 backend is in `server/` (primary files: `server/index.js`, `server/modules/ollamaLLMArbitrator.js`, `server/modules/llmArbitrationSimulator.js`). It receives dispute payloads, validates evidence, calls Ollama (or simulates), and returns a JSON decision consumed by `ArbitrationService` in tests and workflows.
  - Frontend is in `front/` (Vite + React). ABIs and generated JSON are copied into `front/src/utils/contracts` by `scripts/deploy.js` and prebuild step `prebuild` in `front/package.json`.

- Key developer workflows & commands (project root unless noted)
  - Install deps: `npm install`
  - Compile contracts and build artifacts: `npm run compile`
  - Start a local Hardhat node: `npx hardhat node`
  - Deploy to localhost and copy ABIs for frontend: `npx hardhat run scripts/deploy.js --network localhost`
  - Run unit tests: `npm test` (runs Hardhat tests)
  - Run server (V7) locally: `cd server && npm install && npm run start:v7` (also `server/.env.example` exists)
  - Run frontend dev: `cd front && npm install && npm run dev` (prebuild copies ABIs automatically)
  - E2E frontend tests: from `front/`: `npm test -- tests/e2e/template.rent.e2e.spec.ts` or `npm run e2e` uses Playwright projects.

- Project-specific patterns and gotchas
  - ArbitrationService flow: templates do not store an `arbitrator` address; instead use `ArbitrationService` as the central caller. To apply a decision in tests/userspace, call `arbitrationService.applyResolutionToTarget(target, caseId, approved, amount, beneficiary)` (see `test/*` for examples).
  - Evidence on-chain: only bytes32 digests are stored (keccak256). Frontend utilities compute both `cidDigest` and `contentDigest` in `front/src/utils/evidenceCanonical.js` (and related helpers in `front/src/utils/evidence.js`). Use canonicalization before hashing.
  - Submit evidence fallback: frontend will try `submitEvidenceWithDigest` and fall back to `submitEvidence` when extended entrypoints are missing (see tests and `front/README.md`).
  - ContractFactory is the canonical deployment mechanism. Prefer wiring via the factory and setting default arbitration service via `factory.setDefaultArbitrationService(arbitrationAddress, requiredDeposit)`.
  - Low-level ABI calls: `ArbitrationService` attempts multiple resolution entrypoints with low-level `call`. If your target contract changes its API, update the service mappings (see `ArbitrationService.sol`).

- Integration points & external deps
  - Ollama LLM local or hosted — health endpoint: `GET /api/v7/arbitration/ollama/health` (server defaults to `http://localhost:8000` in `.env`)
  - IPFS/Helia evidence storage — `server/modules/evidenceValidator.js` and `front` utilities show how digests are computed/validated.
  - Chainlink Functions (optional) — wiring exists in `scripts/` and docs; environment variables for CCIP/Chainlink are present in root `.env` config instructions.

- Examples to copy when editing code
  - Apply resolution from scripts/tests: see `test/V7BackendCCIPFullFlow.test.js` lines around applyResolutionToTarget usage for correct param order and signer handling.
  - Evidence digest usage: look at `test/ArbitrationService.e2e.test.js` for canonical digest computation and `rent` flow examples.

- Files to read first (priority)
  1. `README.md` (root) — architecture & quickstart
  2. `server/README.md` — backend modules and API
  3. `contracts/ArbitrationService.sol` — core wiring & low-level call behavior
  4. `scripts/deploy.js` — unified deployment and ABI copying
  5. `front/README.md` & `front/src/utils/evidence.js` — frontend evidence & build notes
  6. `test/` — many example usage patterns for contract wiring, arbitration application and E2E scenarios

- Tone & style
  - Follow the repository's clear, example-driven style: prefer copying adjacent tests/snippets for behavior, keep ABIs and JSON artifacts in sync with `scripts/deploy.js`, and keep admin-only helpers in `tools/admin/` (do not import them into `front/`).

If anything here is unclear or you'd like me to expand on specific areas (e.g., exact `ArbitrationService` ABI shapes, `server` endpoints examples, or frontend evidence canonicalization), tell me which section to iterate on.