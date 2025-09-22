#!/bin/sh
# Simple entrypoint to ensure required secrets are present in the container runtime
set -e
if [ -z "${PIN_SERVER_AES_KEY}" ]; then
  echo "ERROR: PIN_SERVER_AES_KEY must be set as a runtime secret. Exiting." >&2
  exit 1
fi
if [ -z "${ADMIN_PRIVATE_KEY}" ] && [ -z "${PIN_SERVER_ADMIN_ADDRESS}" ]; then
  echo "ERROR: ADMIN_PRIVATE_KEY or PIN_SERVER_ADMIN_ADDRESS must be set as a runtime secret. Exiting." >&2
  exit 1
fi
exec "$@"
