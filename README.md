<div align="center">

# LegalContractsDemo

Oracle-driven legal contracts (NDA & Rent) with Chainlink Functions. NOTE: the optional AI/router layer is currently disabled in this workspace for debugging; see below to restore.

</div>

## Overview

This repo demonstrates how to encode dispute resolution into smart contracts and escalate complex cases to an off-chain AI via Chainlink Functions, then enforce the decision on-chain.


What you get:
- NDATemplate contract with deposits, breach reporting, voting, and arbitrator hooks
- Two arbitrators: a simple owner-controlled one, and an oracle-driven one
- Chainlink Functions client that forwards case context to a JS script (ai_oracle.js)
	(Former Cloudflare Worker path removed; AI server integration currently disabled in this repo state)
- Hardhat tests and scripts to deploy/configure

## Architecture

- Contracts:
		- `NDATemplate.sol` — NDA between A and B; holds deposits; exposes `reportBreach`, `resolveByArbitrator`, and `enforcePenalty`.
		- `TemplateRentContract.sol` — Rent contract between landlord and tenant; supports dispute reporting, arbitration, and deposit management.
			> **Note:** All rent contract deployments are enforced via the Factory. Direct deployment is disabled.
	- `Arbitrator.sol` — owner-based arbitrator (baseline).
	- `OracleArbitrator.sol` — generic oracle-driven arbitrator (transport-agnostic).
	- `OracleArbitratorFunctions.sol` — Chainlink Functions client variant.

- Off-chain components:
	- `chainlink/functions/ai_oracle.js` — inline JS executed by Chainlink DON. It can call your external AI endpoint using DON secrets and returns an ABI-encoded tuple `(approve, penaltyWei, beneficiary, guilty)`.
	- `server/` — AI HTTP endpoint (Node) returning JSON decision with deterministic fallback.
	 - `server/` — (removed/disabled) AI HTTP endpoint. To restore AI functionality, re-add `server/src` and set `GEMINI_API_KEY` in `.env`, or restore from the original branch.

Flow (prod):
1. Party reports breach in `NDATemplate`.
2. Party calls `OracleArbitratorFunctions.requestResolution(...)`.
3. If configured, the contract sends a real Chainlink Functions request with arguments (chainId, nda, caseId, reporter, offender, requestedPenaltyWei, evidenceHash).
4. `ai_oracle.js` runs off-chain, calls your AI endpoint (if DON secrets present), validates/coerces output, then ABI-encodes the decision.
5. The DON calls back `_fulfillRequest`, which clamps penalty to available deposit, enforces, and resolves the case.

Flow (local/test): If Functions isn’t configured, the contract produces a deterministic requestId and you can simulate fulfillment using `testFulfill` without external services.


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
 │  - receives resolution (approve, penalty, classification)│
 └──────────┬───────────────────────────────┬───────────────┘
	   │
	   │ reportBreach(offender, requested, evidenceHash)
	   ▼
  ```
		│                               │
		│ chooses one arbitrator impl   │
		│                               │
   ┌──────────────────┐        ┌───────────────────────────┐        ┌──────────────────────┐
   │ Arbitrator        │        │ OracleArbitrator          │        │ OracleArbitratorFunc │
   │ (manual/off-chain │        │ (oracle pushes decision) │        │ (Chainlink Functions) │
   └─────────┬─────────┘        └──────────┬────────────────┘        └──────────┬──────────┘
		 │ resolve() call               │ fulfillExternal()                  │ requestResolution()
		 │ (owner / votes)              │ (trusted caller)                   │  emits RequestSent
		 │                              │                                    │
		 │                              │                                    ▼
		 │                              │                          ┌──────────────────────┐
		 │                              │                          │ Chainlink Functions  │
		 │                              │                          │ Router (DON)         │
		 │                              │                          └─────────┬───────────┘
		 │                              │                                    │ executes JS source
		 │                              │                                    ▼
		 │                              │                          ┌──────────────────────┐
		 │                              │                          │ Off-chain Code + AI  │
		 │                              │                          │ (Worker / API calls) │
		 │                              │                          └─────────┬───────────┘
		 │                              │                           returns JSON
		 │                              │                                    │
		 │                              │                          encode ABI (bool,uint256,address,address,string,string)
		 │                              │                                    │
		 │                              │                                    ▼
		 │                              │                          fulfill(requestId, bytes)
		 │                              │                                    ▼
		 └──────────────────────────────┴──────────────────────────┬─────────
											    │
									     NDATemplate.applyResolution()
											    │
											    ▼
									   Funds distribution + case closed
```

> **Note:** All NDA contract deployments are enforced via the Factory. Direct deployment is disabled.
```
> **Note:** All contract deployments are enforced via the Factory. Direct deployment is disabled.
### Rent Contract Deployment & Arbitration Flow Diagram

```
 (Deployment Phase)
 ┌──────────────┐        creates        ┌────────────────────┐
 │ Deployer /   │ ───────────────────▶  │ ContractFactory    │
 │ Frontend     │                      │ (creates templates)│
 └──────────────┘                       └─────────┬──────────┘
					      │ createRent()
					      ▼
 ┌──────────────────────────────────────────────────────────┐
 │                TemplateRentContract                      │
 │  - deposits(tenant)                                      │
 │  - payRent, reportDispute, arbitration                   │
 │  - stores case state                                     │
 │  - receives resolution (approve, penalty, classification)│
 └──────────┬───────────────────────────────┬───────────────┘
	   │
	   │ reportDispute(dtype, amount, evidenceHash)
	   ▼
   ┌─────────────────────────────┐
   │ Arbitrator / OracleArbitrator│
   │ (manual or oracle/Chainlink) │
   └─────────────┬───────────────┘
		 │ resolveDispute()
		 ▼
	┌─────────────────────────────┐
	│ Resolution: approve/penalty │
	└─────────────┬───────────────┘
		 │
		 ▼
	Funds distribution + case closed

> **Note:** All rent contract deployments are enforced via the Factory. Direct deployment is disabled.



## Quickstart

Prereqs:
- Node.js and npm
- Hardhat

Install deps:
```
npm install
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

Required for Chainlink Functions config:
- `ORACLE_FUNCTIONS_ADDR` — deployed OracleArbitratorFunctions address
- `CLF_SUBSCRIPTION_ID` — Chainlink Functions subscription ID (uint64)
- `CLF_DON_ID` — DON ID (bytes32 hex)
- `CLF_GAS_LIMIT` — callback gas limit (default 300000)

AI router variables used by `chainlink/functions/ai_oracle.js`:
- `AI_ENDPOINT_URL` — your AI HTTP endpoint
- `AI_API_KEY` — Bearer token for that endpoint

Optional:
- `CLF_SOURCE` — override inline JS (otherwise `chainlink/functions/ai_oracle.js` is used)
- `ORACLE_FUNCTIONS_ROUTER` — if set, `scripts/deploy.js` can deploy the Functions oracle with this router

Configure Functions (reads `.env`):
```
npm run functions:config
```

This loads `.env`, reads the Functions source, and calls `setFunctionsConfig` on the oracle.

For production, set `AI_ENDPOINT_URL` and `AI_API_KEY` also as DON secrets via Chainlink Functions Secrets Manager so your JS can access them securely off-chain.

## Chainlink Functions client

`contracts/NDA/OracleArbitratorFunctions.sol` uses official Chainlink imports:
- `FunctionsClient` (v1_3_0)
- `FunctionsRequest` library (from the v1_0_0 subpath, per package structure)

Key method (sending a request):
```solidity
requestId = _sendRequest(req.encodeCBOR(), subscriptionId, gasLimit, donId);
```

Fulfillment handler (DON callback):
```solidity
(bool approve, uint256 penaltyWei, address beneficiary, address guilty) =
	abi.decode(response, (bool, uint256, address, address));
// clamp penalty to available deposit, enforce, resolve
```

Inline script response ABI (must match):
```
(bool approve, uint256 penaltyWei, address beneficiary, address guilty)
```

## AI router script (DON)

`chainlink/functions/ai_oracle.js`:
- Builds a baseline deterministic decision (approve, half of requested) to keep tests stable.
- If DON secrets `AI_ENDPOINT_URL` and `AI_API_KEY` exist, calls your endpoint via HTTP POST and validates/coerces the output.
- Always ABI-encodes the tuple in the expected format.

## AI Endpoint (Gemini or Heuristic)

Folder: `server/`

Key file:
- `server/src/index.js` — Endpoint that:
	- Validates input + optional Bearer auth (`AI_API_KEY`)
	- Tries Google Gemini (env: `GEMINI_API_KEY`, optional `GEMINI_MODEL`)
	- Falls back to deterministic heuristic if Gemini unavailable or invalid
	- Caps `penaltyWei` to `requestedPenaltyWei`

Secrets:
- `GEMINI_API_KEY` (Gemini REST)
- `AI_API_KEY` (optional auth gate)

Deployment: run on any Node/edge runtime (Wrangler removed). Set `AI_ENDPOINT_URL` for Chainlink Functions DON secrets.

## Deploying contracts

Scripts live under `scripts/`.

Deploy (examples):
```
npm run deploy:localhost
npm run deploy:sepolia
```

Notes:
- If `ORACLE_FUNCTIONS_ROUTER` is set in `.env`, `deploy.js` can deploy `OracleArbitratorFunctions` with that router and write addresses/ABIs to the frontend folder.

## Frontend

ABIs are copied into `front/src/utils/contracts`. The UI can call `requestResolution` on the oracle and listen to `ResolutionRequested`/`ResolutionFulfilled` to show status and results.

## Tests

Hardhat tests cover NDA flows, the oracle arbitrator, and a case-studies harness that simulates archetypal NDA breaches. The Functions path is exercised via the deterministic fallback and a test-only `testFulfill` callback.

Run:
```
npm test
```

## Troubleshooting

- Import errors for `FunctionsRequest`:
	- Use the v1_0_0 library path per Chainlink package layout: `@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol`.
- ESM `__dirname` in tests:
	- Fixed using `fileURLToPath(import.meta.url)` + `path.dirname`.
- Functions not configured:
	- Contract falls back to deterministic mode; use `testFulfill` in tests.
- Secrets handling:
	- `.env` is only for local scripts. In production, set DON secrets (AI_ENDPOINT_URL, AI_API_KEY, GEMINI_API_KEY if needed).



## Security

- Never commit real secrets. `.env` is git-ignored. Use DON secrets / your secret manager.
- Fund and monitor your Chainlink Functions subscription appropriately.
- The oracle clamps penalties to the offender’s available deposit to avoid overdrafts.

## License

This is a demo. Add your preferred license file if you plan to distribute.
