Cloudflare Worker AI endpoint (minimal)

This is an example of a tiny API you can deploy to Cloudflare Workers that returns a decision JSON for our Chainlink Functions script.

High-level:
- Expects POST with JSON: { chainId, nda, caseId, reporter, offender, requestedPenaltyWei, evidenceHash }
- Optionally checks header Authorization: Bearer <AI_API_KEY>
- Returns JSON: { approve: boolean, penaltyWei: string, beneficiary: address, guilty: address }

Quick sketch (TypeScript bindings optional):

```js
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    // Optional API key check
    const auth = request.headers.get('authorization') || '';
    const expected = env.AI_API_KEY ? `Bearer ${env.AI_API_KEY}` : null;
    if (expected && auth !== expected) return new Response('Unauthorized', { status: 401 });

    const body = await request.json();
    // Baseline: approve true, half of requested
    const requested = BigInt(body.requestedPenaltyWei || 0);
    const half = requested > 1n ? requested / 2n : 0n;

    const decision = {
      approve: true,
      penaltyWei: half.toString(),
      beneficiary: body.reporter,
      guilty: body.offender,
    };

    return new Response(JSON.stringify(decision), {
      headers: { 'content-type': 'application/json' },
    });
  }
};
```

Deploy steps (PowerShell):

1) Install wrangler (one time):
  npm install -g wrangler

2) Authenticate:
  wrangler login

3) From server/ folder, set secrets (don’t commit secrets to git):
   - Required for REST Workers AI:
     wrangler secret put CF_ACCOUNT_ID    # your Cloudflare account ID
     wrangler secret put CF_API_TOKEN     # API token with Workers AI permission
   - API auth for this endpoint (optional but recommended):
     wrangler secret put AI_API_KEY

4) Deploy:
  wrangler deploy

5) Copy your Worker URL (e.g., https://<your-worker>.workers.dev) into project .env:
  - AI_ENDPOINT_URL=https://<your-worker>.workers.dev
  - AI_API_KEY=<the value you set in wrangler secret>

6) Configure the oracle (reads .env):
  npm run functions:config

For production, set AI_ENDPOINT_URL and AI_API_KEY also as DON secrets in Chainlink Functions so the off-chain runtime can access them securely.

Notes:
- This Worker uses the Cloudflare REST API for Workers AI with model `@cf/meta/llama-3-8b-instruct` by default. You can override via WORKERS_AI_MODEL var.
- Alternatively, you can bind the Workers AI service directly in wrangler.toml (the `[ai]` binding) and call `env.AI` in code; the current example uses REST to avoid requiring special bindings.
