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
    // Allow caller to forward ETH which will be forwarded to the target resolution call.
    function applyResolutionToTarget(address targetContract, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external payable {
        // Allow only the owner (previous behavior) or the configured factory to call this entrypoint.
        require(msg.sender == owner || (factory != address(0) && msg.sender == factory), "Only owner or factory");
        require(targetContract != address(0), "bad target");

    // Try NDA-style serviceResolve(uint256,bool,uint256,address)
    (bool ok, bytes memory returned) = targetContract.call(abi.encodeWithSignature("serviceResolve(uint256,bool,uint256,address)", caseId, approve, appliedAmount, beneficiary));
        if (ok) return;
        // If the target reverted with a reason, bubble it up — this indicates
        // the target recognized the entrypoint but failed (e.g. insufficient deposit).
        if (returned.length > 0) {
            assembly { revert(add(returned, 32), mload(returned)) }
        }

    // Try Rent-style resolveDisputeFinal(uint256,bool,uint256,address,string,string)
    (ok, returned) = targetContract.call(abi.encodeWithSignature("resolveDisputeFinal(uint256,bool,uint256,address,string,string)", caseId, approve, appliedAmount, beneficiary, "", ""));
        if (ok) return;
        if (returned.length > 0) {
            assembly { revert(add(returned, 32), mload(returned)) }
        }

        // As a last resort, try a minimal enforcement entrypoint serviceEnforce(address,uint256,address)
        // which some templates may expose for direct enforcement. In that case,
        // the targetContract is expected to interpret the first param as the guilty party;
        // since we don't know this here, skip this attempt.
        revert("No compatible resolution entrypoint on target");
    }

    /// @notice Allows owner or configured factory to forward a cancellation finalization
    /// to a target template that exposes `finalizeCancellation()` and accepts ETH.
    /// This is payable and will forward `msg.value` to the target.
    function finalizeTargetCancellation(address targetContract) external payable {
        require(msg.sender == owner || (factory != address(0) && msg.sender == factory), "Only owner or factory");
        require(targetContract != address(0), "bad target");

        (bool ok, ) = targetContract.call{value: msg.value}(abi.encodeWithSignature("finalizeCancellation()"));
        require(ok, "finalize failed");
    }

    /// @notice Allow the landlord of a target rent contract to trigger finalization
    /// via this ArbitrationService when the target has been configured to use
    /// this service as its `arbitrationService`. This is payable and will forward
    /// `msg.value` to the target's `finalizeCancellation()` call.
    function finalizeByLandlord(address targetContract) external payable {
        require(targetContract != address(0), "bad target");

        // Read the arbitrationService configured on the target (if present)
        (bool ok, bytes memory out) = targetContract.staticcall(abi.encodeWithSignature("arbitrationService()"));
        address configured = address(0);
        if (ok && out.length >= 32) {
            configured = abi.decode(out, (address));
        }
        require(configured == address(this), "service not configured on target");

        // Verify caller is the landlord of the target
        (bool got, bytes memory lo) = targetContract.staticcall(abi.encodeWithSignature("landlord()"));
        address landlordAddr = address(0);
        if (got && lo.length >= 32) {
            landlordAddr = abi.decode(lo, (address));
        }
        require(landlordAddr != address(0), "bad landlord");
        require(msg.sender == landlordAddr, "Only landlord");

        // Forward the call to finalizeCancellation on the target, passing msg.value
        (bool r, ) = targetContract.call{value: msg.value}(abi.encodeWithSignature("finalizeCancellation()"));
        require(r, "finalize failed");
    }

    /// @notice Transfer ownership of the service.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        owner = newOwner;
    }
}
