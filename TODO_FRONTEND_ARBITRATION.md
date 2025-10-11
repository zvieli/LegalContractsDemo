# TODO: Frontend Integration & Arbitation UX (ArbiTrust V7)

This file records the detailed TODO list for the frontend work and the ArbiTrust V7 integration tasks (ArbitrationExplain, health/fallback UX, admin tools, tests, infra checks and security).

PRIORITY: High → Medium → Low

---

## HIGH (complete first)

1. ArbitrationExplain / ArbitrationResultViewer (implement)
   - Create `front/src/components/Arbitration/ArbitrationExplain.jsx`.
   - Health check: GET `/api/v7/arbitration/ollama/health`.
   - Fetch merged result: GET `/api/v7/arbitration/explain/:disputeId` (or POST alternative).
   - Display: decision, confidence, reimbursement, source, merged_rationale (summary and full toggle), LLM rationale (truncated / full toggle), NLP matched keywords and provenance, download JSON button.
   - Fallback: if Ollama down, show option to use `/api/v7/arbitration/simulate`.

2. Integrate merged rationale into existing flows
   - Wire ResolveModal / ArbitrationV7 to show the `ArbitrationExplain` output inline or in the modal.

## MEDIUM (operational UX & admin)

3. Health & fallback UX
   - Health check before calling arbitration endpoint.
   - Auto-fallback or user-choose to call `/api/v7/arbitration/simulate`.
   - UI indicator of Ollama status.

4. Admin / Dev Tools page
   - IPFS status/restart (call `/api/v7/debug/ipfs/restart`)
   - CCIP test/start endpoints (`/api/v7/ccip/test`, `/api/v7/ccip/start`)
   - Toggle or guidance for ARBITRATOR_DEBUG (download debug JSON files)

5. Prevent risky defaults
   - Hide/disable client-side encryption option in production builds.
   - Show explicit warnings if user enables encryption in non-dev.

6. Contracts / addresses sync
   - UI/settings to switch deployment env/load addresses from deployments JSON or .env
   - Wallet network validation and user-facing error

7. IPFS / Helia checks & CORS handling
   - Show IPFS daemon status and recommend server proxy to avoid CORS

## LOW / OPTIONAL

8. Persist raw LLM debug files (atomic writes + rotation)
9. Add smoke tests & CI integrations for health, submit-evidence and arbitration explain
10. Security/privacy checklist (no admin private keys in frontend, limit metadata)

## EDGE CASES / Tests

11. Merge heuristics unit tests (DRAW behavior, overrides)
12. Logging gating behind ARBITRATOR_DEBUG

---

See code comments and ticket descriptions for acceptance criteria and commands to run.
