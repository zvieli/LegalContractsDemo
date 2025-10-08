# Copilot Instructions for LegalContractsDemo

## Project Overview
- **ArbiTrust V7**: Smart contract templates (NDA, Rent) with AI-powered arbitration using Chainlink CCIP Oracle integration and Ollama LLM.
- **V7 Release**: Unified Node.js backend (no Python required), direct Ollama integration, CCIP Oracle automation, simulation fallback, and Merkle evidence batching for gas savings.

## Architecture & Key Components
- **Smart Contracts** (`contracts/`):
  - `ArbitrationService.sol`: Central dispatcher with CCIP receiver capabilities for Oracle decisions.
  - `NDATemplate.sol`, `TemplateRentContract.sol`: Contract templates with CCIP arbitration integration.
  - `contracts/ccip/`: CCIP Oracle infrastructure (Sender, Receiver, Types).
- **Backend** (`server/`):
  - `index.js`, `start-v7.js`: Unified backend with Ollama LLM and CCIP event handling.
  - `modules/ollamaLLMArbitrator.js`, `modules/llmArbitrationSimulator.js`: Arbitration logic.
  - `ccip/ccipEventListener.js`, `ccip/ccipResponseHandler.js`: CCIP Oracle integration.
  - API endpoints: `/api/v7/arbitration/ollama`, `/api/v7/arbitration/simulate`.
- **Frontend** (`front/`):
  - Uses injected wallet (MetaMask) for on-chain ops, falls back to localhost JSON-RPC for dev.
  - Evidence helpers: `src/services/contractService.js`, `src/utils/evidence.js`.
  - Only submits evidence digests (keccak256); encryption to admin key is optional and handled client-side.
- **Tools** (`tools/`):
  - Admin decryption helpers in `tools/admin/` (never bundle in frontend).

## CCIP Oracle Integration (V7 Feature)
- **Automatic Arbitration**: Breach reports trigger CCIP Oracle requests automatically
- **Cross-Chain Oracle**: Chainlink CCIP for decentralized arbitration decisions
- **LLM Processing**: Ollama analyzes evidence and generates decisions
- **Zero-Cost Educational**: Uses CCIP Local Simulator for cost-free learning
- **Integration Points**:
  - `configureCCIP()` in templates enables Oracle arbitration
  - `CCIPEventListener` processes requests with LLM arbitrator
  - `ArbitrationService.receiveCCIPDecision()` applies Oracle decisions
  - Fallback to traditional arbitration if CCIP unavailable

## Developer Workflows
- **Build & Deploy**:
  - Install dependencies: `npm install` (in root, `server/`, `front/` as needed).
  - Deploy CCIP infrastructure: `npx hardhat run tasks/ccip/deploy-ccip-arbitration.js`.
  - Deploy contracts: Use unified `scripts/deploy.js`.
  - Start V7 backend with CCIP: `npm run start:v7` in `server/`.
- **Testing**:
  - Hardhat tests: `npx hardhat test` (contract tests).
  - E2E tests: `npm run e2e` in `front/` (uses custom MetaMask helper, Windows compatible).
  - CCIP Oracle testing: Report dispute → automatic Oracle arbitration → LLM decision.
  - Playwright for frontend E2E.
- **Evidence Workflow**:
  - Prepare evidence with `prepareEvidencePayload` (frontend).
  - For encrypted evidence, upload ciphertext off-chain and submit digest to contract.
  - CCIP Oracle automatically processes evidence and makes decisions.
  - Admins decrypt using CLI/tools in `tools/admin/`.

## Conventions & Patterns
- **No admin keys in frontend**; only public keys for encryption.
- **Evidence digests**: Always keccak256, use `ethers.ZeroHash` for empty evidence.
- **CCIP Integration**: Hybrid approach - existing functionality + Oracle capabilities.
- **Fallbacks**: Oracle arbitration falls back to traditional arbitration if CCIP unavailable.
- **Environment variables**: Use `.env.example` as template for `.env` in all major components.
- **MetaMask E2E**: Custom helper for Windows, environment-driven setup.

## Integration Points
- **Chainlink CCIP**: Cross-chain Oracle infrastructure for automated arbitration.
- **CCIP Local Simulator**: Educational zero-cost implementation.
- **Ollama LLM**: Backend integrates directly for evidence analysis and decision making.
- **IPFS/Helia**: Evidence storage and digest validation (see backend modules).

## Key Files & Directories
- `contracts/`: Solidity contracts including CCIP Oracle infrastructure
- `contracts/ccip/`: CCIP arbitration contracts (Sender, Receiver, Types)
- `server/`: Node.js backend with CCIP event handling
- `server/ccip/`: CCIP Oracle integration modules
- `front/`: Frontend with CCIP-aware evidence helpers
- `tools/`: Admin/legacy tools
- `scripts/`: Deployment and utility scripts
- `tasks/ccip/`: CCIP deployment and management tasks

## CCIP Oracle Workflow
1. **Dispute Creation**: User reports breach/dispute in contract
2. **Automatic Trigger**: Contract calls `_triggerCCIPArbitration()` if CCIP enabled
3. **Oracle Request**: CCIP sends arbitration request to Oracle network
4. **LLM Processing**: `CCIPEventListener` detects request, processes with Ollama LLM
5. **Decision Generation**: LLM analyzes evidence and generates verdict
6. **Decision Application**: Oracle sends decision to `ArbitrationService.receiveCCIPDecision()`
7. **Contract Resolution**: ArbitrationService applies decision to original contract

---

**If any section is unclear or missing important project-specific details, please specify so I can refine these instructions.**