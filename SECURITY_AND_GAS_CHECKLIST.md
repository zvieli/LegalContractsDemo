# Security & Gas Checklist

This checklist captures manual checks performed for contracts in this repository.

- [ ] Confirm compiler version (>=0.8.0) and optimizer settings in Hardhat config
- [ ] Run `npx hardhat compile` and check for warnings
- [ ] Run `npx hardhat test` and analyze failing tests
- [ ] Run `npx hardhat coverage` for coverage report
- [ ] Run static analysis (Slither) and verify findings
- [ ] Check reentrancy patterns and use of pull-payments
- [ ] Verify safe handling of Ether and ERC20 transfers
- [ ] Ensure proper access control for admin functions
- [ ] Confirm no unbounded loops over user-controlled arrays
- [ ] Check events for important state changes
- [ ] Document gas-heavy public/external functions and expected costs
