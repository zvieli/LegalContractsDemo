<div align="center">

# LegalContractsDemo

Oracle-driven legal contracts (NDA & Rent) with Chainlink Functions and an external AI router.

</div>

## Overview

This repo demonstrates how to encode dispute resolution into smart contracts and escalate complex cases to an off-chain AI via Chainlink Functions, then enforce the decision on-chain.

What you get:
- NDATemplate contract with deposits, breach reporting, voting, and arbitrator hooks
- Two arbitrators: a simple owner-controlled one, and an oracle-driven one
- Chainlink Functions client that forwards case context to a JS script (ai_oracle.js)
- Optional Cloudflare Worker acting as the AI endpoint (with secure secrets)
- Hardhat tests and scripts to deploy/configure

## Architecture

- Contracts:
	- `NDATemplate.sol` — NDA between A and B; holds deposits; exposes `reportBreach`, `resolveByArbitrator`, and `enforcePenalty`.
	- `Arbitrator.sol` — owner-based arbitrator (baseline).
	- `OracleArbitrator.sol` — generic oracle-driven arbitrator (transport-agnostic).
	- `OracleArbitratorFunctions.sol` — Chainlink Functions client variant.

- Off-chain components:
	- `chainlink/functions/ai_oracle.js` — inline JS executed by Chainlink DON. It can call your external AI endpoint using DON secrets and returns an ABI-encoded tuple `(approve, penaltyWei, beneficiary, guilty)`.
	- `server/` (optional) — Cloudflare Worker that accepts the case payload and returns a JSON decision. Includes a deterministic fallback.

Flow (prod):
1. Party reports breach in `NDATemplate`.
2. Party calls `OracleArbitratorFunctions.requestResolution(...)`.
3. If configured, the contract sends a real Chainlink Functions request with arguments (chainId, nda, caseId, reporter, offender, requestedPenaltyWei, evidenceHash).
4. `ai_oracle.js` runs off-chain, calls your AI endpoint (if DON secrets present), validates/coerces output, then ABI-encodes the decision.
5. The DON calls back `_fulfillRequest`, which clamps penalty to available deposit, enforces, and resolves the case.

Flow (local/test): If Functions isn’t configured, the contract produces a deterministic requestId and you can simulate fulfillment using `testFulfill` without external services.

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
- `AI_ENDPOINT_URL` — your AI HTTP endpoint (e.g., Cloudflare Worker)
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

## Cloudflare Worker (optional AI endpoint)

Folder: `server/`

Key files:
- `server/wrangler.toml` — Worker config (no secrets checked in)
- `server/src/index.js` — Endpoint that:
	- Validates input and Bearer auth (`AI_API_KEY`)
	- Optionally calls Cloudflare Workers AI via REST using `CF_ACCOUNT_ID` and `CF_API_TOKEN`
	- Sanitizes JSON and caps `penaltyWei` to `requestedPenaltyWei`
	- Falls back to approve/half if AI fails

Secrets (set with Wrangler, not in `.env`):
- `CF_ACCOUNT_ID`, `CF_API_TOKEN` (Workers AI REST)
- `AI_API_KEY` (for your endpoint)

See `server/worker.md` for exact deploy steps (wrangler login, secret put, deploy), and then set `AI_ENDPOINT_URL` in your `.env` and as DON secret.

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
	- `.env` is only for local scripts. In production, set DON secrets for the JS runtime (AI_ENDPOINT_URL, AI_API_KEY) and Wrangler secrets for the Worker (CF_ACCOUNT_ID, CF_API_TOKEN, AI_API_KEY).



## Security

- Never commit real secrets. `.env` is git-ignored. Use DON secrets and Wrangler secrets for production.
- Fund and monitor your Chainlink Functions subscription appropriately.
- The oracle clamps penalties to the offender’s available deposit to avoid overdrafts.

## License

This is a demo. Add your preferred license file if you plan to distribute.
