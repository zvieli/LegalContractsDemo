
<!-- .github/copilot-instructions.md - guidance for AI coding agents working on this repo -->

# Copilot Instructions for LegalContractsDemo

This repository demonstrates arbitration-driven legal contracts (NDA & Rent) using Solidity. All AI, oracle, and on-chain voting code has been removed—dispute resolution is now strictly via an owner-controlled `Arbitrator` and `ArbitrationService`.

## Key Architecture & Patterns

- **Templates & Arbitration:**
  - `NDATemplate.sol` and `TemplateRentContract.sol` are deployed via `ContractFactory`, which sets an immutable `arbitrationService` and required deposit at creation.
  - Disputes are reported via `reportBreach` (NDA) or similar entrypoints. Case state is stored in the template.
  - Only the configured `ArbitrationService` can apply resolutions to templates, using low-level `call` to recognized entrypoints (e.g., `serviceResolve(...)`, `resolveDisputeFinal(...)`).
  - Templates do **not** couple to arbitrator ABIs; they check `msg.sender` for the service address.

- **ArbitrationService Wiring:**
  - Deploy `ArbitrationService` and (optionally) an `Arbitrator`.
  - Register the factory with the service (`arbitrationService.setFactory(factoryAddress)`) or transfer service ownership to the arbitrator for production.
  - Always use `ContractFactory` for new templates to ensure correct wiring.

- **Pull-Payment Pattern:**
  - Resolutions credit balances; users must withdraw funds (no Ether is pushed on resolution).

- **ABI Compatibility:**
  - `ArbitrationService.applyResolutionToTarget` attempts several known entrypoints on targets. If none match, it reverts with `No compatible resolution entrypoint on target`.
  - When adding new templates, ensure a compatible resolution function exists or update the service.

## Developer Workflows

- **Install:** `npm install`
- **Compile:** `npm run compile`
- **Test:** `npm test` or `npx hardhat test` (see `test/` for NDA, Rent, Arbitrator flows)
- **Deploy local:** `npx hardhat run scripts/deploy.js --network localhost` (wires factory & service, copies ABIs for frontend)
- **Smoke test:** `npx hardhat run scripts/smokeTest.js --network localhost`
- **Frontend ABI check:** `node scripts/checkFrontendContracts.js`

## Where to Find Patterns & Specs

- **Behavioral expectations:**
  - Tests in `test/` are the spec (e.g., `NDA.test.js`, `ArbitrationService.test.js`).
  - `scripts/deploy.js` shows intended wiring and registration.
- **Frontend:**
  - ABIs are copied to `front/src/utils/contracts`. The UI must use the arbitration flow (no voting/AI).

## Edge Cases & Gotchas

- Voting, AI, and oracles are **removed**—do not reintroduce or search for them.
- Templates only accept resolutions from the configured `ArbitrationService`.
- Penalties are clamped to available deposits to prevent overdrafts.
- Frontend may fall back to direct JSON-RPC reads when using a local node.

## PR Checklist

1. Add/update tests in `test/` for all logic changes (cover happy path & edge cases).
2. Run `npm run compile` and `npm test` before submitting.
3. If deployment/wiring changes, update `scripts/deploy.js` and `scripts/checkFrontendContracts.js` as needed.
4. Update frontend ABIs if contract ABIs/names change.

  If anything here is unclear or you want the instructions expanded with specific examples (e.g., sample `applyResolution` calldata), tell me which area to expand and I'll iterate.
