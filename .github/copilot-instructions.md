<!-- .github/copilot-instructions.md - guidance for AI coding agents working on this repo -->

# Copilot instructions for LegalContractsDemo

Purpose: provide concise, actionable guidance so an AI coding assistant can be immediately productive in this repository.

Key points:

- Big picture: This repository contains Solidity contract templates (NDA, Rent), an owner-controlled `Arbitrator`, and an `ArbitrationService` used to apply arbitrator resolutions to template contracts. Templates are intended to be created via `ContractFactory` so they receive an immutable `arbitrationService` address and required deposit at deployment.

- Important files and folders:
  - `contracts/NDATemplate.sol` — NDA flows: deposits, `reportBreach`, resolution entrypoints (service-only). Use this when implementing or changing dispute logic.
  - `contracts/TemplateRentContract.sol` — Rent flows and deposit management.
  - `contracts/Arbitrator.sol` and `contracts/ArbitrationService.sol` — arbitrator & service wiring and authorization patterns. `ArbitrationService.applyResolutionToTarget` attempts low-level `call` to a few common entrypoints on targets.
  - `contracts/ContractFactory.sol` — preferred deployment path for templates; sets defaults like `arbitrationService` and required deposits.
  - `scripts/` — deployment and wiring helpers. `scripts/deploy.js` performs an automated wiring step (registers the factory with the `ArbitrationService`).
  - `test/` — Hardhat tests covering NDA, Rent, Arbitrator flows. Look here for behavioral expectations and ABI call shapes.
  - `front/` — frontend app; ABIs are copied to `front/src/utils/contracts`. The frontend uses injected wallets but falls back to a local RPC for some reads when connected to localhost.
  -- Architecture and flow

  - Arbitration flow (core mental model):
    1. Templates are created by `ContractFactory` and receive an immutable `arbitrationService`.
    2. A party calls `reportBreach(...)` on a template (e.g., `NDATemplate`). This stores case state and may lock deposits.
    3. A human/owner-controlled `Arbitrator` resolves the dispute and instructs `ArbitrationService` to apply the resolution to the target template.
    4. `ArbitrationService.applyResolutionToTarget` uses low-level `call` to try known resolution entrypoints on templates; templates accept only the configured service as an authorized caller.

  - Project-specific conventions and patterns (explicit, discoverable):
    - Preferred deployment: Always use `ContractFactory` when creating templates so templates are initialized with a correct `arbitrationService` and `requiredDeposit`.
    - Templates avoid hard ABI coupling to arbitrators: they only accept calls from `ArbitrationService` (not direct arbitrator calls). See `NDATemplate` constructor and authorization checks.
    - Resolution application uses low-level `call` attempts (see `ArbitrationService.sol`). When adding new templates, ensure a compatible resolution function exists (e.g., `serviceResolve(...)` or `resolveDisputeFinal(...)`) or update the service shim.
    - Pull-payment pattern for funds distribution: templates credit balances and require withdrawals rather than pushing Ether when resolving cases.

  - Build / test / debug commands (explicit examples):
    - Install: `npm install` (repo root)
    - Compile: `npm run compile` (maps to Hardhat compile)
    - Run tests: `npm test` or `npx hardhat test`
    - Start hardhat node: `npx hardhat node` or `npm run node`
    - Deploy local test wiring: `npx hardhat run scripts/deploy.js --network localhost` (this copies ABIs for frontend and registers factory with the `ArbitrationService`)
    - Quick smoke test: `npx hardhat run scripts/smokeTest.js --network localhost`
    - Frontend check (ABI generation): `node scripts/checkFrontendContracts.js`

  - Where to look for behavioral expectations / examples:
    - Tests in `test/` are authoritative: they show how `reportBreach`, `applyResolution`, and deposit flows behave (e.g., `NDA.test.js`, `ArbitrationService.test.js`). Use them as a spec when changing logic.
    - `scripts/deploy.js` demonstrates the intended wiring steps and factory registration.

  - Edge cases and gotchas discovered in the repo:
    - Older code paths relying on `voteOnBreach` or `resolveByArbitrator` were removed. Don't search for or reintroduce voting/AI code—tests were updated accordingly.
    - `ArbitrationService` may revert with `No compatible resolution entrypoint on target` if a template doesn't expose an expected resolution function.
    - Frontend sometimes falls back to direct JSON-RPC reads to avoid injected wallet circuit-breaker errors when using a local Hardhat node (see `front/README.md`).

  - Helpful examples for code edits:
    - If adding a new template contract, add one of the recognized resolution entrypoints (examples in repo: `serviceResolve(...)` in NDA templates and `resolveDisputeFinal(...)` in Rent templates), and add tests under `test/` that exercise `ArbitrationService.applyResolutionToTarget`.
    - When changing deposit handling, update corresponding tests (search for `deposit`, `withdraw`, and `pullPayment` patterns in `test/`).

  - Minimal PR checklist for code changes (for AI to follow):
    1. Update or add tests under `test/` covering happy path and boundary cases (e.g., zero deposit, over-withdraw attempts).
   2. Run `npm run compile` and `npm test` locally; fix type or compile issues.
   3. If scaffolding/deploy behavior changed, update `scripts/deploy.js` and `node scripts/checkFrontendContracts.js` if ABIs or artifact paths changed.
   4. Update `front/src/utils/contracts` ABIs when contract ABIs or names change.

  If anything here is unclear or you want the instructions expanded with specific examples (e.g., sample `applyResolution` calldata), tell me which area to expand and I'll iterate.
