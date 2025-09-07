#!/usr/bin/env bash
# Run local Cloudflare Worker (AI endpoint) in dev mode with wrangler.
# Usage: npm run ai:dev
set -euo pipefail
cd server
wrangler dev
