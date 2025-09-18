// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockArbTargetB {
    // Simulate Rent-style resolveDisputeFinal(uint256 caseId, bool approved, uint256 appliedPenalty, address beneficiary, string memory a, string memory b)
    event CalledResolveDisputeFinal(uint256 indexed caseId, bool approved, uint256 appliedPenalty, address beneficiary, string a, string b);

    function resolveDisputeFinal(uint256 caseId, bool approved, uint256 appliedPenalty, address beneficiary, string memory a, string memory b) external returns (bool) {
        emit CalledResolveDisputeFinal(caseId, approved, appliedPenalty, beneficiary, a, b);
        return true;
    }
}
