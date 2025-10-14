# Copilot Instructions for LegalContractsDemo

## Project Overview
- **Purpose:** Arbitration-driven smart contract templates (NDA & Rent) with AI-powered dispute resolution via Chainlink Functions and Ollama LLM.
- **Major Components:**
  - `contracts/`: Solidity contracts (NDATemplate, Rent, ArbitrationService, ContractFactory, etc.)
  - `front/`: Vite + React frontend for contract interaction, evidence submission, dispute history, and LLM decision display
  - `server/`: Node.js backend for LLM arbitration, evidence validation, and REST API endpoints
  - `tools/`: AI arbitration tools, admin decryption helpers, Chainlink integration scripts
  - `scripts/`: Deployment, monitoring, and utility scripts
  - `docs/`: Specifications, optimization guides, and migration history

## Architecture & Data Flow
- **Dispute Flow:**
  1. Breach reported in NDATemplate
  2. Dispute created; arbitrator notified
  3. Arbitrator resolves via ArbitrationService (low-level ABI calls)
  4. Resolution applied to contract; funds distributed
- **Evidence:** Canonicalized, hashed, and stored off-chain (IPFS/Helia); only digests on-chain
- **Arbitration:** LLM backend (Ollama) or simulation fallback; JSON decisions returned to contracts
- **Frontend:** ABIs auto-copied from deployments; role-based UI; evidence verification via IPFS

## Developer Workflows
- **Install:** `npm install`
- **Compile Contracts:** `npm run compile` or `npx hardhat compile`
- **Deploy Contracts:** `node scripts/deploy.js` (unified deployment)
- **Start All Services:** `./scripts/start-all.ps1` (Windows) or run server/frontend separately
- **Run Tests:** `npm test` (Hardhat, frontend, backend)
- **E2E Frontend Test:** `cd front && npm test -- tests/e2e/template.rent.e2e.spec.ts`
- **Local Node:** `npx hardhat node`
- **Smoke Test:** `npx hardhat run scripts/smokeTest.js --network localhost`

## Key Conventions & Patterns
- **Contract Deployment:** Use `ContractFactory` for all template deployments; arbitration service set immutably at creation
- **ArbitrationService:** Centralized, owner-controlled; applies resolutions via low-level ABI calls to templates
- **Frontend ABIs:** Auto-copied to `front/src/utils/contracts` after deployment
- **Evidence Encryption:** Encrypt client-side to admin public key; store only digest on-chain
- **Admin Tools:** Decryption helpers in `tools/admin/`; never bundle private keys in frontend
- **Event Listening:** Frontend listens for `DisputeAppliedCapped` and `ResolutionApplied` events

## Integration Points
- **Chainlink Functions:** Automated arbitration triggers
- **Ollama LLM:** Native integration for dispute resolution
- **IPFS/Helia:** Off-chain evidence storage and verification
- **REST API:** Backend endpoints for arbitration, evidence, and health checks

## Troubleshooting
- If tests fail, ensure all dependencies are installed and contracts are compiled
- Secrets and external integrations are managed via `.env` (see `.env.example`)
- For admin decryption, use CLI tools in `tools/admin/` only in trusted environments

## References
- See `README.md` (root, front/, server/, scripts/, tools/) and `docs/` for specs and guides
- Key contracts: `contracts/ArbitrationService.sol`, `contracts/ContractFactory.sol`, `contracts/NDA/`, `contracts/Rent/`
- Main deployment: `scripts/deploy.js`
- Frontend logic: `front/src/ArbitrationView.jsx`, `front/src/LLMDecisionView.jsx`, `front/src/WalletConnector.jsx`
- Backend logic: `server/modules/`, `server/routes/`

---
*Update this file as architecture or workflows evolve. For unclear or missing sections, ask maintainers for clarification.*
