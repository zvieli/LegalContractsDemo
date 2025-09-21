PR Title: feat(ipfs): export normalizeGatewayUrl and normalize configured gateways

Summary
- Centralized IPFS CID URL helper at `front/src/utils/ipfs.js`.
  - Exports `buildCidUrl(cid)` and `normalizeGatewayUrl(url)`.
  - Handles precedence: Vite import-time var (test shim for Node tests) → `REACT_APP_PIN_SERVER_URL` → runtime `localStorage.PIN_SERVER_URL` → fallback `https://ipfs.io`.
  - Normalizes gateway URLs (trim + remove trailing slashes) to avoid double-slash issues.
- Updated UI components to use the helper:
  - `front/src/components/ContractModal/ContractModal.jsx`
  - `front/src/components/ResolveModal/ResolveModal.jsx`
- Added unit tests: `test/ipfsUtil.test.cjs` (covers env precedence and normalization).
- Consolidated `front/.env`; removed duplicate `front/.env.local`.

Test / CI summary
- Local test run: full test suite passed — "95 passing".
- Frontend build executed locally and completed without fatal errors.

Notes for reviewers
- Node test shim: tests use `global.__VITE_PIN_SERVER_URL__` to simulate `import.meta.env` during Node test runs.
- Helper checks both `window.localStorage` and `globalThis.localStorage` for runtime overrides so tests and Node scripts can mock it.
- `normalizeGatewayUrl` exported for reuse and unit-testing.

How to test locally
- From repo root:
  - `npm test`
- Frontend build:
  - `cd front; npm run build`

---

If you'd like, I can create the PR automatically from this branch — install the GitHub CLI (`gh`) and tell me and I'll run it for you. Alternatively, open:
https://github.com/zvieli/LegalContractsDemo/compare/feat/ipfs-normalize-helper?expand=1
and paste the title/body above.
