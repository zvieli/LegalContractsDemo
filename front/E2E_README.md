Playwright E2E (smoke)

Prerequisites
- Node.js and npm
- From the repository root install frontend deps: `cd front && npm install`

Run dev server and tests
1. Start the Vite dev server:
   ```powershell
   cd front; npm run dev
   ```
2. In another terminal run Playwright tests (will use Chromium headless):
   ```powershell
   cd front; npm run e2e
   ```

Notes
- The test is a light smoke test and uses permissive selectors; update `front/tests/e2e/resolve.spec.js` to match your app's exact selectors (data-testid attributes are recommended).
