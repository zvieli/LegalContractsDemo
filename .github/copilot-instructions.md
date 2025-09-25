<!-- Copilot instructions for contributors and AI agents -->
# Quick orientation for automated coding agents

This repository implements arbitration-driven legal contract templates (NDA and Rent) with a Hardhat-based dev flow and a small React frontend. The file below highlights the essential patterns, workflows, and entry points an automated coding agent needs to be productive.

## Big picture (why & components)
- Smart contracts live in `contracts/` and are created via `ContractFactory.sol` which uses lightweight deployer helper contracts (`_RentDeployer`, `_NDADeployer`) to keep factory bytecode small.
- Arbitration flow: templates are configured with an `ArbitrationService` (preferred) instead of storing or calling a direct `Arbitrator`. The `ArbitrationService` applies resolutions to templates using low-level `call` attempts.
- Frontend expects ABIs and a small `MockContracts.json` under `front/public/utils/contracts` (deploy script writes these).

## Key files to read first
- `hardhat.config.cjs` — network config, optimizer, gas reporter, etherscan.
- `scripts/deploy.js` — canonical local deploy + ABI copy logic; sets `MockContracts.json` and `ContractFactory.json` in the frontend public folder.
- `contracts/ContractFactory.sol` — factory creation patterns, how defaults (arbitration service, required deposit) are set.
- `contracts/NDA/NDATemplate.sol` and `contracts/Rent/TemplateRentContract.sol` — actual template entrypoints (reporting, resolution application, deposit handling).
- `contracts/ArbitrationService.sol` and `contracts/Arbitrator.sol` — service + reference arbitrator implementations and the expected caller relationships.
- `front/` — frontend expects ABIs at `front/public/utils/contracts`; see `front/package.json` for dev/test commands.
- `tools/admin/README.md` — admin-only utilities for evidence decryption; sensitive code stays out of frontend bundles.

## Local developer workflows (explicit commands)
- Install: `npm install` at repo root.
- Compile & copy ABIs (build for frontend): `npm run build:all` (runs compile, copy-abi, build).
- Local node: `npm run node` (starts Hardhat node at 127.0.0.1:8545, chainId 31337).
- Deploy to localhost (auto-wires factory and optionally ArbitrationService): `npm run deploy:localhost` or `npx hardhat run scripts/deploy.js --network localhost`.
- Smoke test (exercises flows): `npx hardhat run scripts/smokeTest.js --network localhost`.
- Run full tests: `npm test` (runs Hardhat tests).

Notes on deploy behavior: `scripts/deploy.js` will auto-deploy `MockPriceFeed` and `ArbitrationService` on local networks unless `DEPLOY_MOCKS` or `DEPLOY_ARBITRATION` are explicitly set to `false`. The script writes ABI/json artifacts to `front/public/utils/contracts` and `MockContracts.json`.

## Project-specific conventions and patterns
- Evidence is stored on-chain as a `bytes32` digest (keccak256 of off-chain payload). Frontend must compute and pass the digest (see `front/src/services/contractService.js`).
- Templates accept resolutions only from the configured `ArbitrationService`. Do not expect direct `arbitrator` storage on templates.
- Solidity uses custom errors (e.g., `error ZeroTenant();`) instead of revert strings for gas savings; follow the same pattern for new contract code.
- Factory-created templates often receive immutable configuration at creation (e.g., `arbitrationService` is passed to deployer). Prefer wiring defaults using `ContractFactory.setDefaultArbitrationService(...)` instead of mutating templates individually.
- ABI copy logic in `scripts/deploy.js` skips interface/debug artifacts and writes only ABI-bearing artifacts to the frontend public dir.

## Integration & external dependencies
- Networks: `localhost` and `sepolia` configured in `hardhat.config.cjs`. RPC URLs and keys are read from `.env` (copy `.env.example`).
- Etherscan verification relies on `ETHERSCAN_API_KEY` environment variable.
- Frontend runtime expects `MockContracts.json` and `{ContractName}ABI.json` under `front/public/utils/contracts` — maintain these filenames.

## Where to update and test changes
- When changing contracts: update contracts, run `npm run compile`, then `npm run build:all` to refresh ABIs in the frontend.
- When changing deploy wiring: update `scripts/deploy.js` and run `npm run deploy:localhost` against a running `npm run node` instance.
- Tests are in `test/` (Hardhat). Run `npm test` and inspect assertions in `test/*.test.js` for expected behavior.

## Quick tips for automated edits
- If you add a public ABI-affecting change, also update `scripts/deploy.js`'s ABI-copy behavior if you introduce nonstandard artifact filenames.
- When modifying arbitration interfaces, update `ArbitrationService.applyResolutionToTarget` compatibility attempts (it uses low-level calls to match templates).
- Preserve existing custom errors and owner-only modifiers when editing contracts to remain consistent with project style.

If anything above is unclear or you want more examples (e.g., common tests to adapt when changing dispute flow), tell me which section to expand and I will iterate.
