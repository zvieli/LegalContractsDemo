<div align="center">

# LegalContractsDemo

Arbitration-driven legal contracts (NDA & Rent). This repository provides smart-contract templates that rely on on‑chain arbitrator contracts for dispute resolution. All oracle and AI components have been removed.

</div>

## Recent Changes (September 2025)

- Removed on‑chain party voting from `NDATemplate` (the `voteOnBreach` method and vote state were deleted).
- Removed AI and external oracle integrations (Chainlink Functions, AI router scripts, server AI endpoints, and related tests) from the repository.
- BREAKING CHANGE: Integrators and UI components that relied on voting or AI must be updated to use arbitrator‑based workflows.

## Overview

This repo demonstrates how to encode dispute resolution into smart contracts and resolve disputes using on‑chain arbitrator contracts (owner‑controlled or similar).

What you get:
- `NDATemplate` contract with deposits, breach reporting and arbitrator hooks
- An owner‑controlled `Arbitrator` implementation used in tests and reference deployments
- Hardhat tests and scripts to deploy/configure

## Architecture

- Contracts:
	- `NDATemplate.sol` — NDA between two parties; holds deposits; exposes `reportBreach` and service-only resolution entrypoints. Resolutions are applied via an `ArbitrationService` rather than a direct `resolveByArbitrator` call.
	- `TemplateRentContract.sol` — Rent contract between landlord and tenant; supports dispute reporting, arbitration, and deposit management.
	- `Arbitrator.sol` — owner‑controlled arbitrator used as a simple reference implementation in tests.

Off‑chain components:
- This repository no longer includes AI or Chainlink/Functions components. Any required off‑chain decision logic must be implemented and integrated separately.

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
## Deployment notes (automated wiring)
----------------------------------

The `scripts/deploy.js` script now deploys `ContractFactory`, mocks, and `ArbitrationService`, and performs a best-effort wiring step: after `ArbitrationService` is deployed the script calls `arbitrationService.setFactory(factoryAddress)` so the deployed `ContractFactory` is registered as the trusted factory in the service. This makes the factory-authorized arbitration flow work out-of-the-box for local deploys used by the smoke test and frontend.

If you want to change this behavior (for example to transfer ownership of the service to an `Arbitrator` contract instead), update `scripts/deploy.js` accordingly or perform the transfer manually on-chain.

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

This repository no longer requires Chainlink Functions or AI-related environment variables. For local tests and deployments you generally only need standard Ethereum RPC endpoints (e.g., `HARDHAT_URL`) when targeting external nodes.

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

ABIs are copied into `front/src/utils/contracts`. The UI should now use arbitrator-based flows (create case → notify arbitrator → read resolution) and must not rely on voting or AI features.

## Tests

Hardhat tests cover NDA flows, the owner arbitrator, and rent contract workflows.

Run:
```
npm test
```

## Troubleshooting

- If tests fail due to configuration, ensure dependencies are installed and run `npm run compile`.
- Secrets and external integrations are no longer part of this repo; nothing to configure for Chainlink or AI.

## Security

- Never commit real secrets. `.env` is git-ignored.
- The NDA contract clamps penalties to an offender’s available deposit to avoid overdrafts.

## License

This is a demo. Add your preferred license file if you plan to distribute.
