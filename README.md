# LegalContractsDemo

## Environment (.env)

Create a `.env` file in the project root (copy from `.env.example`). It is already in `.gitignore`.

Required variables for Chainlink Functions config:
- ORACLE_FUNCTIONS_ADDR — deployed OracleArbitratorFunctions address
- CLF_SUBSCRIPTION_ID — Chainlink Functions subscription ID (uint64)
- CLF_DON_ID — DON ID (bytes32 hex)
- CLF_GAS_LIMIT — callback gas limit (default 300000)

AI router variables used by `chainlink/functions/ai_oracle.js`:
- AI_ENDPOINT_URL — your AI HTTP endpoint (e.g. Cloudflare Worker)
- AI_API_KEY — bearer token for that endpoint (optional but recommended)

Then run:

```
npm run functions:config
```

This loads `.env`, reads the Functions source (default `chainlink/functions/ai_oracle.js`), and calls `setFunctionsConfig` on the oracle.

See `server/worker.md` for a minimal Cloudflare Worker endpoint template that returns the required JSON shape.

End-to-end demo of two contract templates (NDA and Rent) with an oracle-based arbitrator. Includes a Chainlink Functions variant that can route a dispute to an off-chain AI for a decision, then fulfill on-chain.

## Scripts

- Test: `npm test`
- Compile: `npm run compile`
- Hardhat node: `npm run node`
- Deploy + copy ABIs to frontend: `npm run deploy:<network>` then `npm run copy-abi`

## Contracts

- `contracts/NDA/NDATemplate.sol` — NDA with deposits, breach reporting, party voting, and arbitrator hooks
- `contracts/NDA/Arbitrator.sol` — owner-driven arbitrator
- `contracts/NDA/OracleArbitrator.sol` — generic oracle-driven arbitrator (transport agnostic)
- `contracts/NDA/OracleArbitratorFunctions.sol` — Chainlink Functions client variant

## Chainlink Functions (AI arbitrator)

`OracleArbitratorFunctions` supports two modes:

1) Local/dev mode (default in tests): derive a deterministic requestId and use `testFulfill` (owner-only) to simulate the router callback.
2) Production mode: when fully configured, it sends a real Functions request and receives the DON callback.

Configure production mode:

1. Deploy `OracleArbitratorFunctions` with the router address for your target network.
2. Ensure you have a Functions Subscription and DON for that network.
3. Configure via script (Windows PowerShell example):

```powershell
$env:CLF_SUBSCRIPTION_ID="<id>"; $env:CLF_DON_ID="0x..."; $env:ORACLE_FUNCTIONS_ADDR="0xYourOracleAddr"; npm run functions:config
```

Optional variables:

- `CLF_GAS_LIMIT` — callback gas limit (default 300000)
- `CLF_SOURCE` — inline JS; if omitted, defaults to `chainlink/functions/ai_oracle.js`

The inline script must ABI-encode `(bool approve, uint256 penaltyWei, address beneficiary, address guilty)` in the response.

## Frontend

ABIs are copied into `front/src/utils/contracts`. The UI can trigger `requestResolution` and monitor the resulting events to show the AI decision.

## Notes

- Tests cover both generic oracle and Functions variant via local simulation.
- Penalty is clamped to offender’s available deposit before enforcement.
