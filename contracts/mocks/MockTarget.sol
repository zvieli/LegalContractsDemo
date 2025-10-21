// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockTarget {
    // simple storage to indicate resolution applied
    struct Resolution {
        uint256 caseId;
        bool approved;
        uint256 appliedAmount;
        address beneficiary;
        string rationale;
    }

    mapping(uint256 => Resolution) public resolutions;
    event ServiceResolved(uint256 indexed caseId, bool approved, uint256 appliedAmount, address beneficiary);

    // NDA-style
    function serviceResolve(uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external payable {
        resolutions[caseId] = Resolution(caseId, approve, appliedAmount, beneficiary, "");
        emit ServiceResolved(caseId, approve, appliedAmount, beneficiary);
    }

    // Rent-style extended
    function resolveDisputeFinal(uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary, string calldata classification, string calldata rationale) external payable {
        resolutions[caseId] = Resolution(caseId, approve, appliedAmount, beneficiary, rationale);
        emit ServiceResolved(caseId, approve, appliedAmount, beneficiary);
    }

    // helper to read a resolution
    function getResolution(uint256 caseId) external view returns (uint256, bool, uint256, address, string memory) {
        Resolution storage r = resolutions[caseId];
        return (r.caseId, r.approved, r.appliedAmount, r.beneficiary, r.rationale);
    }
}
