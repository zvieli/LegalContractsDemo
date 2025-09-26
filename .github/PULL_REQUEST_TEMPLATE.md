# Pull Request: Restore evidence flow and add initialEvidenceDigest

## Summary
This PR restores previously removed evidence-related tooling and adds support for an optional `initialEvidenceDigest` at contract creation.

What changed:
- `contracts/Rent/TemplateRentContract.sol`: added `bytes32 public initialEvidenceDigest` and constructor param.
- `contracts/ContractFactory.sol`: updated `_RentDeployer` and added overload allowing `initialEvidenceDigest` to be provided on create.
- `front/src/services/contractService.js`: updated to support computing/forwarding `initialEvidenceDigest` to the factory overload.
- Restored evidence/admin tooling under `tools/` and `front/tools/admin/` where applicable.
- Updated unit tests and added smoke script demonstrating the new flow.
- Copied current ABIs to `front/public/utils/contracts` via `scripts/deploy.js`.

## Why
Implements Option A (off-chain encrypted evidence + on-chain digest). The digest is kept on-chain to enable cryptographic proof without storing ciphertext on-chain.

## Compatibility
- Backwards compatible: existing factory overloads preserved and forward `bytes32(0)` for calls that don't supply a digest.
- Consumers must update any direct `TemplateRentContract` deploy call/constructor invocations to include the extra `bytes32` argument (pass `bytes32(0)` to maintain previous behavior).

## Testing
- Unit tests for the evidence flow and admin decrypt helper pass locally.
- Smoke script `scripts/smoke-create-rent.js` demonstrates creating a rent contract supplying `initialEvidenceDigest`.

## Release notes / actions after merge
(See the RELEASE_NOTES.md in PR body or repo root.)

## Checklist
- [ ] Confirm ABI artifacts are updated in CI and published to frontend assets
- [ ] Run E2E smoke: start `vite` and `tools/evidence-server.js` and verify UI flow
- [ ] Update any external automation/scripts that deploy `TemplateRentContract` directly

Please review and merge when happy.
