// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IArbitratorFactory {
    function createDisputeForCase(address _ndaContract, uint256 _ndaCaseId, bytes calldata _evidence) external returns (uint256);
}

contract ArbitrationService {
    address public owner;
    // Optional authorized factory address. When set, calls to applyResolutionToTarget
    // are allowed only from the owner (arbitrator) or from this factory address.
    address public factory;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Set the trusted factory address that is allowed to request resolutions
    /// @dev Only callable by current owner (initial deployer). Set to zero to unset.
    function setFactory(address _factory) external onlyOwner {
        factory = _factory;
    }

    /// @notice Create a dispute on an Arbitrator factory for a target contract/case.
    /// @param arbitratorFactory address of the Arbitrator factory contract
    /// @param targetContract address of the NDA / Rent contract
    /// @param targetCaseId id of the dispute on the target contract
    /// @param evidence arbitrary calldata with evidence (may be empty)
    function createDisputeOnFactory(address arbitratorFactory, address targetContract, uint256 targetCaseId, bytes calldata evidence) external returns (uint256) {
        require(arbitratorFactory != address(0), "bad factory");
        require(targetContract != address(0), "bad target");
        return IArbitratorFactory(arbitratorFactory).createDisputeForCase(targetContract, targetCaseId, evidence);
    }

    /// @notice Apply a resolution to a target contract. This will attempt common
    /// service entrypoints used by templates (`serviceResolve` for NDA and
    /// `resolveDisputeFinal` for Rent). The function uses low-level calls so it
    /// can support multiple target ABI shapes without hard dependencies.
    function applyResolutionToTarget(address targetContract, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external {
        // Allow only the owner (previous behavior) or the configured factory to call this entrypoint.
        require(msg.sender == owner || (factory != address(0) && msg.sender == factory), "Only owner or factory");
        require(targetContract != address(0), "bad target");

        // Try NDA-style serviceResolve(uint256,bool,uint256,address)
        (bool ok, ) = targetContract.call(abi.encodeWithSignature("serviceResolve(uint256,bool,uint256,address)", caseId, approve, appliedAmount, beneficiary));
        if (ok) return;

        // Try Rent-style resolveDisputeFinal(uint256,bool,uint256,address,string,string)
        (ok, ) = targetContract.call(abi.encodeWithSignature("resolveDisputeFinal(uint256,bool,uint256,address,string,string)", caseId, approve, appliedAmount, beneficiary, "", ""));
        if (ok) return;

        // As a last resort, try a minimal enforcement entrypoint serviceEnforce(address,uint256,address)
        // which some templates may expose for direct enforcement. In that case,
        // the targetContract is expected to interpret the first param as the guilty party;
        // since we don't know this here, skip this attempt.
        revert("No compatible resolution entrypoint on target");
    }

    /// @notice Transfer ownership of the service.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }
}
