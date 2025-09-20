#!/usr/bin/env bash
# Stop and remove the local go-ipfs container and network
cd "$(dirname "$0")"
docker compose down --remove-orphans || true
docker rm -f local-ipfs 2>/dev/null || true
docker network rm ipfs_default 2>/dev/null || true
echo "Cleanup complete."
