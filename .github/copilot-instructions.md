Purpose
-------
This file gives short, concrete guidance for AI coding agents working in ArbiTrust so they become productive quickly. It focuses on the repo's architecture, dev workflows, conventions, and important file locations you should read and update when making changes.

High level architecture (read these files together)
- Smart contracts: `contracts/NDATemplate.sol`, `contracts/TemplateRentContract.sol`, `contracts/Arbitrator.sol`, `contracts/ArbitrationService.sol`, `contracts/ContractFactory.sol` — templates are intended to be created via `ContractFactory` and accept resolutions only from a configured `ArbitrationService`.
- Off-chain UI: `front/` (Vite app). The frontend expects ABIs and deployment metadata under `front/public/utils/contracts` (created by `scripts/deploy.js`).
- Deploy & wiring script: `scripts/deploy.js` — deploys ContractFactory, optionally mocks and ArbitrationService, copies ABIs to the frontend, and writes `MockContracts.json` / `ContractFactory.json` for the UI.
- Admin tooling: `tools/admin/` — admin-only decryption and CLI helpers. These must remain server/CLI-only (never bundled into `front`).

Key design notes an agent must respect
- Evidence is stored on-chain as a bytes32 digest (keccak256 of the off‑chain payload). The frontend computes this digest; see `front/src/utils/evidence.js` and `front/src/services/contractService.js` for examples.
- Templates no longer use party voting or Chainlink/AI. Integrations must use the Arbitrator -> ArbitrationService -> Template flow.
- The `ArbitrationService.applyResolutionToTarget` uses low-level calls and tries multiple common entrypoints. Do not assume a single ABI entrypoint on target templates.
- ContractFactory is the intended deployment entrypoint for templates. Avoid manual per-template wiring unless necessary.

Common developer workflows & exact commands
- Install deps: `npm install` (repo root)
- Compile: `npm run compile` (runs `npx hardhat compile`)
- Start local node: `npx hardhat node` or `npm run node`
- Deploy to local and copy ABIs: `npx hardhat run scripts/deploy.js --network localhost` or `npm run deploy:localhost` (this writes ABIs and `MockContracts.json` to `front/public/utils/contracts`)
- Start frontend dev server: `cd front; npm run dev` or run the repo-level helper `.\start-all.ps1` (PowerShell) to open Hardhat, deploy, frontend and tests in separate windows
- Tests: `npm test` (Hardhat tests). For gas reporting: `REPORT_GAS=true npm test` or `npm run test:gas`.
- End-to-end / UI tests: `npm run test:playwright`; frontend unit tests: `npm run test:vitest` (if used).

Important environment flags (used by `scripts/deploy.js`)
- DEPLOY_MOCKS=true — force deploy MockPriceFeed (otherwise auto-enabled on localhost when needed)
- DEPLOY_ARBITRATION=true — force deploy ArbitrationService (otherwise auto-enabled locally when the frontend lacks an ArbitrationService address)
- PRIVATE_KEY, RPC_URL (named `RPC_URL` in hardhat.config) — used for network deployments
- REPORT_GAS=true — enable gas reporter in tests

Project-specific conventions you must follow
- Evidence flow: frontend computes `digest = keccak256(payload or ciphertext)` and submits `bytes32` to contracts; admin tools decrypt ciphertext off‑chain using `tools/admin/`.
- ABIs & deployment JSON format: `scripts/deploy.js` writes `ContractFactory.json` (deployment metadata) and `MockContracts.json` into `front/public/utils/contracts`. The frontend loads those exact files at runtime.
- ABI file names produced: `{ContractName}ABI.json` in `front/public/utils/contracts` (contains `{ abi, contractName, bytecode }`). When updating contract interfaces, ensure `npx hardhat compile` and re-run deploy script to refresh frontend assets.
- Skip editing or bundling anything from `tools/admin/` into the front-end. Admin private keys must never be committed.

Integration & cross-component touchpoints (where to look)
- `scripts/deploy.js` — wiring, ABI copy logic, and defaults (primary place to change how frontend assets are produced)
- `front/src/utils/evidence.js` and `front/src/services/contractService.js` — how evidence digests and RPC fallbacks are implemented
- `start-all.ps1` — convenient local dev launcher that sequences Hardhat node, deploy, frontend and tests (PowerShell-specific)
- `front/public/utils/contracts/MockContracts.json` and `ContractFactory.json` — runtime config the UI expects

Quick examples (copy/paste safe)
- Local deploy + UI ABI copy: `npm run deploy:localhost`  (or `npx hardhat run scripts/deploy.js --network localhost`)
- Start everything on Windows PowerShell: `.\start-all.ps1`
- Run tests with gas report: `REPORT_GAS=true npm test`

Files to read first (high ROI)
- `README.md` — project overview and quickstart
- `scripts/deploy.js` — most of the repo wiring logic
- `hardhat.config.cjs` — compiler, network and env expectations
- `front/src/utils/evidence.js`, `front/src/services/contractService.js` — frontend evidence + RPC behaviors
- `contracts/` directory — read templates and ArbitrationService to understand entrypoints

If you modify contracts
- Update Solidity, run `npx hardhat compile`, then run `npm run deploy:localhost` (or `scripts/deploy.js`) to regenerate ABIs used by the frontend.
- If you change a template's resolution entrypoint, also update `ArbitrationService` behavior and `scripts/deploy.js` ABI-copy/compatibility assumptions.

When you are unsure
- Search for 'ArbitrationService', 'ContractFactory', 'MockContracts.json' and 'prepareEvidencePayload' to quickly find the wiring points.
- If frontend can't find ABIs or `MISSING_ARBITRATION_SERVICE` appears in `MockContracts.json`, re-run the deploy script locally (it writes a sentinel when the service is missing).

Feedback
- I added this based on the repository's README, `scripts/deploy.js`, `start-all.ps1`, and frontend helpers. Tell me any missing or unclear areas and I'll iterate (for example, add short examples for evidence encryption/decryption or list common failing test errors and fixes).
