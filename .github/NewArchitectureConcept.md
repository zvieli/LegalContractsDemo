# Copilot Instructions – New Architecture Concept

## Architecture Concept
We are building a **Dispute & Appeal System** with the following updated architecture:

1. **On-chain Layer (Smart Contracts)**  
   - Handles disputes, appeals, fees, and deadlines.  
   - Stores only references (URIs) to evidence metadata.  
   - Example: `RentDisputeManager` contract that tracks disputes and whether they have been appealed.  

2. **Off-chain Evidence Service (Backend)**  
   - Runs on our own infrastructure.  
   - Stores uploaded evidence (documents, images, etc.) locally.  
   - Publishes metadata and files to **local IPFS node** (not external services, no paid pinning).  
   - Provides REST endpoints to submit/retrieve evidence and metadata URIs.  

3. **Client Application (Frontend)**  
   - User-facing app for disputes and appeal status.  
   - When user submits appeal:  
     - Uploads evidence to backend.  
     - Backend adds it to **local IPFS node**.  
     - Backend responds with IPFS URI.  
     - Frontend calls smart contract `appealDispute(disputeId, uri, {value: appealFee})`.  
   - Displays transaction status, errors, and dispute updates.  

## Flow Summary
1. User selects dispute → clicks **Submit Appeal**.  
2. Frontend uploads evidence → backend → local IPFS node → returns URI.  
3. Frontend calls smart contract with disputeId, URI, and fee.  
4. Smart contract validates and updates state.  
5. Frontend refreshes and shows updated appeal status.  

## Refactor Instructions
- **Remove all legacy code** related to:  
  - External IPFS pinning services (Pinata, Web3.Storage, Infura, etc.).  
  - Old APIs or helpers that no longer fit the new flow.  
  - Unused endpoints, mocks, or redundant abstractions.  
- Ensure the codebase reflects only the **new local-IPFS architecture**.  
- Maintain strict separation of concerns:  
  - Contracts → state & logic only.  
  - Backend → evidence handling + local IPFS integration.  
  - Frontend → UI & blockchain interactions.  

## Copilot Guidance
- Generate and complete code in alignment with this new architecture.  
- Always assume **local IPFS node** is available at `http://localhost:5001`.  
- Prioritize clean, minimal, and consistent code.  
- Any time outdated patterns appear, **refactor or remove them**.  
