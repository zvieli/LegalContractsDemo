// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockArbTargetA {
    // Simulate NDA-style serviceResolve(caseId, approved, appliedPenalty, beneficiary)
    event CalledServiceResolve(uint256 indexed caseId, bool approved, uint256 appliedPenalty, address beneficiary);

    function serviceResolve(uint256 caseId, bool approved, uint256 appliedPenalty, address beneficiary) external returns (bool) {
        emit CalledServiceResolve(caseId, approved, appliedPenalty, beneficiary);
        return true;
    }
}
