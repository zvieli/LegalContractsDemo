// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockReporterTarget {
    address public target;
    constructor() { target = address(this); }
    event Resolved(uint256 caseId, bool approved, uint256 appliedAmount, address beneficiary);

    // mimic resolveDisputeFinal signature used by ArbitrationService
    function resolveDisputeFinal(uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary, string calldata classification, string calldata rationale) external {
        emit Resolved(caseId, approve, appliedAmount, beneficiary);
    }

    // serviceResolve style entrypoint
    function serviceResolve(uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external {
        emit Resolved(caseId, approve, appliedAmount, beneficiary);
    }
}
