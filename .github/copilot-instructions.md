## Purpose

Short, focused guidance for an AI coding agent working in this repo. Include the big-picture architecture, common developer workflows (build/test/debug), project-specific patterns, and high-value file references so an LLM can be immediately productive.

## Big picture

- Smart contracts live under `contracts/`. Major templates: `NDATemplate.sol` (NDA flow) and `TemplateRentContract.sol` (rent flow).
- Arbitration is centralized through `ArbitrationService.sol` and an owner-controlled `Arbitrator.sol`. Templates are designed to be created via `ContractFactory.sol` so arbitration wiring is immutably set at creation.
- Frontend under `front/` (Vite + React). ABIs copied to `front/src/utils/contracts` by `scripts/copy-abi.js` and the deploy scripts.
- Evidence is stored off-chain; contracts store a bytes32 keccak256 digest only (see README and `front/src/utils/evidence.js`). Admin-side decryption tools are in `tools/admin/` and must run in a trusted environment.

## Key files to inspect first

- `hardhat.config.cjs` — compiler, networks, gas reporter, and etherscan wiring.
- `scripts/deploy.js` — automated local wiring: deploys `ContractFactory`, `ArbitrationService`, sets factory in the service and copies ABIs.
- `scripts/copy-abi.js` — copy ABI/artifact conventions used by the frontend.
- `start-all.ps1` — convenience script that starts Hardhat node, runs deploy, serves the front-end, and runs tests; useful to replicate developer environment on Windows.
- `front/src/services/contractService.js` and `front/src/utils/evidence.js` — frontend patterns for computing evidence digests and calling contracts.
- `contracts/ArbitrationService.sol` — important: it tries multiple resolution entrypoints via low-level call and is the authorized caller on templates.

## Developer workflows (concrete)

- Local dev (typical):
  1. Start local Hardhat node.
  2. Deploy with `scripts/deploy.js` (copies ABIs into `front/`).
  3. Run frontend (`front/`) and run tests.
 4. `start-all.ps1` automates these steps in separate terminals on Windows.
- Common npm scripts (root `package.json`): `npm run node`, `npm run deploy:localhost`, `npm run compile`, `npm test`, `npm run copy-abi`, `npm run build:all`.
- Tests: Hardhat tests are `npm test` (runs `npx hardhat test`). Playwright and Vitest lives in `front/` with their own scripts.

## Project-specific conventions & patterns

- Evidence digest only: templates accept a `bytes32` evidenceDigest. Frontend computes the digest (keccak256). Do not expect raw CIDs or URIs on-chain.
- Arbitration flow: templates do NOT store an `arbitrator` or use voter-based flows (voting/AI removed). Resolutions must be applied via the `ArbitrationService` (it is the authorized caller on templates).
- ABI/Artifact syncing: the deploy process and `scripts/copy-abi.js` place compiled artifacts under `front/src/utils/contracts`. Any code changes to contracts should be followed by `npm run compile` + `npm run copy-abi` (or run `npm run build:all`).
- Admin tooling and secrets: admin decryptors are intentionally out-of-band under `tools/admin/`. Never import or bundle those into `front/`.

## Integration points & external deps

- RPC endpoints: `hardhat` local node at `http://127.0.0.1:8545`. Remote networks use env vars in `hardhat.config.cjs` (e.g., `RPC_URL`, `PRIVATE_KEY`).
- Etherscan verification controlled by `ETHERSCAN_API_KEY` env var.
- Evidence storage is off-chain (S3/HTTPS/Helia) — contracts only keep keccak256 digest.

## Testing & debugging tips

- If MetaMask shows RPC "circuit breaker" errors during local dev, the frontend falls back to `http://127.0.0.1:8545` for certain read-only calls; ensure the local Hardhat node chainId (31337) matches MetaMask.
- Use `start-all.ps1` to open separate windows: Hardhat node, deploy, frontend, and tests — this reduces race conditions and exposes logs.
- For gas numbers, run tests with `REPORT_GAS=true npm test`.

## What changed recently (helpful cues for edits)

- AI and Chainlink Functions were removed; any references to voting or AI router code are obsolete. Focus changes around arbitration-based flow and `ArbitrationService` semantics.

## Examples (where to implement/patch)

- When adding a new template contract, ensure it accepts `arbitrationService` as an immutable or constructor-set address and that `ArbitrationService.applyResolutionToTarget` will be able to call the template's resolution entrypoint.
- When updating frontend evidence flow, update `front/src/utils/evidence.js` and keep `tools/admin/` in sync for decrypt helpers. The UI should call contract entrypoints with a `bytes32` digest, not the raw ciphertext.

## Quick checklist for PRs

- Update ABIs (`npm run compile && npm run copy-abi`) and verify `front/src/utils/contracts` contains expected artifacts.
- Update README snippets if you add or change deployment wiring.
- Run unit tests (`npm test`) and, if touching UI, run `front` tests (`npm --prefix front test`).

---

If anything in this file is unclear or you want more detail on a workflow (example: CI, external test accounts, or evidence-hosting helper), tell me which area and I will expand the section with exact files and command examples.
# Copilot Instructions

## Project Context
- This repository contains a decentralized rental contracts system.
- The frontend is in React + Playwright for E2E tests.
- Contracts are written in Solidity and deployed with Hardhat.
- E2E tests (`front/tests/e2e/template.rent.e2e.spec.ts`) must interact with the real UI and trigger on-chain transactions.

## Rules for Copilot
1. When modifying Playwright specs:
   - Always use **real UI selectors** from the components under `front/src/pages/`.
   - Do not invent fake selectors or mocks.
   - Prefer `getByRole`, `getByLabel`, or `getByText` over raw CSS selectors when possible.

2. When orchestrating scenarios:
   - Each `CASE` in the test should run a **full flow**: create rent contract via UI, perform payments, report evidence/disputes, and verify resolution.
   - Use real Hardhat wallets (from `hardhat.config.js` / WALLETS.txt) and treat wallet #0 as the admin.
   - Transactions should go **on-chain** via the deployed contracts, not mocked calls.

3. When generating helper functions:
   - If fetching contract ABI or addresses, read them from `/front/src/services/contractService.js` or `artifacts/` instead of hardcoding.
   - Handle async with proper `await page.waitFor...` to sync with UI actions.
   - Ensure `waitForTx` waits for chain confirmations before proceeding.

4. When writing files:
   - Record results in `evidence_storage/e2e_cases.json` and logs in `evidence_storage/e2e_cases_verbose.log`.
   - JSON should contain the contract address, case name, involved parties, and transaction hashes.

5. General coding style:
   - TypeScript strict mode compliant.
   - Avoid `require`, use `import`.
   - Prefer named imports from `ethers` (v6 API).

## Goal
- Achieve **true end-to-end tests** where every flow in `CASES` validates the actual system (frontend + backend + blockchain).
- Tests should be deterministic and repeatable, not flaky.
- Ensure all interactions mimic real user behavior as closely as possible.
- Maintain high code quality and readability for future maintainers.