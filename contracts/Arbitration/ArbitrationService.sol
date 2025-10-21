// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// CCIP imports for Oracle decision receiving
import "./ccip/CCIPArbitrationTypes.sol";

// interface IArbitratorFactory {
//     function createDisputeForCase(address _ndaContract, uint256 _ndaCaseId, bytes calldata _evidence) external returns (uint256);
// }

contract ArbitrationService {
    address public owner;
    // Optional authorized factory address. When set, calls to applyResolutionToTarget
    // are allowed only from the owner (arbitrator) or from this factory address.
    address public factory;
    // Mitigation 4.2: prevent replay / double application by tracking processed request hashes
    mapping(bytes32 => bool) public processedRequests;
    
    // CCIP Oracle Integration
    mapping(address => bool) public authorizedCCIPReceivers; // Authorized CCIP receiver contracts
    mapping(bytes32 => bool) public processedCCIPDecisions; // Track processed CCIP decisions

    event ResolutionApplied(address indexed target, uint256 indexed caseId, bool approve, uint256 appliedAmount, address indexed beneficiary, address caller);
    
    // CCIP events
    event CCIPReceiverAuthorized(address indexed receiver, bool authorized);
    event CCIPDecisionReceived(bytes32 indexed messageId, address indexed targetContract, uint256 indexed caseId, bool approved);
    event CCIPDecisionCall(address caller, bytes32 messageId, address targetContract, uint256 caseId, address beneficiary);
    event RawDecisionEntered(address caller, bytes32 messageId);

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

    /// @notice Authorize a CCIP receiver contract to send arbitration decisions
    /// @param _receiver Address of the CCIP receiver contract
    /// @param _authorized Whether to authorize or deauthorize the receiver
    function authorizeCCIPReceiver(address _receiver, bool _authorized) external onlyOwner {
        require(_receiver != address(0), "Invalid receiver");
        authorizedCCIPReceivers[_receiver] = _authorized;
        emit CCIPReceiverAuthorized(_receiver, _authorized);
    }

    /// @notice Apply a resolution to a target contract. This will attempt common
    /// service entrypoints used by templates (`serviceResolve` for NDA and
    /// `resolveDisputeFinal` for Rent). The function uses low-level calls so it
    /// can support multiple target ABI shapes without hard dependencies.
    // Allow caller to forward ETH which will be forwarded to the target resolution call.
    function applyResolutionToTarget(address targetContract, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external payable {
        // Allow only the owner (previous behavior) or the configured factory to call this entrypoint.
        require(msg.sender == owner || (factory != address(0) && msg.sender == factory), "Only owner or factory");
        require(targetContract != address(0), "Invalid target");
        require(beneficiary != address(0), "Invalid beneficiary");

        // Mitigation 4.2: compute a request hash and ensure it wasn't processed before
    // Replay guard: use a deterministic hash of parameters (exclude timestamp so repeated identical
    // requests cannot bypass guard simply by occurring in a later block).
    bytes32 reqHash = keccak256(abi.encodePacked(targetContract, caseId, approve, appliedAmount, beneficiary, msg.sender, msg.value));
        require(!processedRequests[reqHash], "Request already processed");
        processedRequests[reqHash] = true;

        // Emit event for transparency
        emit ResolutionApplied(targetContract, caseId, approve, appliedAmount, beneficiary, msg.sender);

    // Try NDA-style serviceResolve(uint256,bool,uint256,address)
    // Forward any ETH sent to the service into the target call so arbitrators
    // can top-up debtor deposits in the same transaction when necessary.
    (bool ok, bytes memory returned) = targetContract.call{value: msg.value}(abi.encodeWithSignature("serviceResolve(uint256,bool,uint256,address)", caseId, approve, appliedAmount, beneficiary));
        if (ok) return;
        // If the target reverted with a reason, bubble it up — this indicates
        // the target recognized the entrypoint but failed (e.g. insufficient deposit).
        if (returned.length > 0) {
            assembly { revert(add(returned, 32), mload(returned)) }
        }

    // Try Rent-style resolveDisputeFinal(uint256,bool,uint256,address,string,string)
    (ok, returned) = targetContract.call{value: msg.value}(abi.encodeWithSignature("resolveDisputeFinal(uint256,bool,uint256,address,string,string)", caseId, approve, appliedAmount, beneficiary, "", ""));
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

    /// @notice Receive and apply arbitration decision from CCIP Oracle
    /// @param messageId CCIP message ID for tracking
    /// @param targetContract Address of the contract to apply decision to
    /// @param caseId Case ID in the target contract
    /// @param decision The arbitration decision received via CCIP
    function receiveCCIPDecision(
        bytes32 messageId, 
        address targetContract,
        uint256 caseId,
        CCIPArbitrationTypes.ArbitrationDecision memory decision
    ) external {
    emit CCIPDecisionCall(msg.sender, messageId, targetContract, caseId, decision.beneficiary);
        require(!processedCCIPDecisions[messageId], "Decision already processed");
        
        // Mark as processed to prevent replay
        processedCCIPDecisions[messageId] = true;
        
        // Emit event for transparency
        emit CCIPDecisionReceived(messageId, targetContract, caseId, decision.approved);
        
        // Apply the resolution to the target contract
        // Use the existing applyResolutionToTarget logic but bypass the caller check
        bool approve = decision.approved;
        uint256 appliedAmount = decision.appliedAmount;
        address beneficiary = decision.beneficiary;
        
        require(targetContract != address(0), "Invalid target");
        require(beneficiary != address(0), "Invalid beneficiary");
        
        // Create unique request hash for CCIP decisions (include messageId for uniqueness)
        bytes32 reqHash = keccak256(abi.encodePacked(
            targetContract, caseId, approve, appliedAmount, beneficiary, msg.sender, messageId
        ));
        require(!processedRequests[reqHash], "Request already processed");
        processedRequests[reqHash] = true;
        
        // Emit resolution event
        emit ResolutionApplied(targetContract, caseId, approve, appliedAmount, beneficiary, msg.sender);
        
        // Try to apply resolution using existing patterns
        _applyResolution(targetContract, caseId, approve, appliedAmount, beneficiary, "", decision.rationale);
    }

    /// @notice Alternate raw entrypoint: accept encoded arbitration decision bytes and decode inside the service
    function receiveCCIPDecisionRaw(
        bytes32 messageId,
        address targetContract,
        uint256 caseId,
        bytes calldata decisionEncoded
    ) external {
        emit RawDecisionEntered(msg.sender, messageId);
    // In local test harness allow any caller to submit decoded decisions. In production
    // this should be restricted to authorized CCIP receiver contracts.
        require(!processedCCIPDecisions[messageId], "Decision already processed");

        CCIPArbitrationTypes.ArbitrationDecision memory decision = abi.decode(decisionEncoded, (CCIPArbitrationTypes.ArbitrationDecision));

        // Mark as processed to prevent replay
        processedCCIPDecisions[messageId] = true;

        // Emit event for transparency
        emit CCIPDecisionReceived(messageId, targetContract, caseId, decision.approved);

        // Create unique request hash for CCIP decisions (include messageId for uniqueness)
        bool approve = decision.approved;
        uint256 appliedAmount = decision.appliedAmount;
        address beneficiary = decision.beneficiary;

        require(targetContract != address(0), "Invalid target");
        require(beneficiary != address(0), "Invalid beneficiary");

        bytes32 reqHash = keccak256(abi.encodePacked(
            targetContract, caseId, approve, appliedAmount, beneficiary, msg.sender, messageId
        ));
        require(!processedRequests[reqHash], "Request already processed");
        processedRequests[reqHash] = true;

        emit ResolutionApplied(targetContract, caseId, approve, appliedAmount, beneficiary, msg.sender);

        _applyResolution(targetContract, caseId, approve, appliedAmount, beneficiary, "", decision.rationale);
    }
    
    /// @notice Internal function to apply resolution with classification and rationale
    function _applyResolution(
        address targetContract,
        uint256 caseId,
        bool approve,
        uint256 appliedAmount,
        address beneficiary,
        string memory classification,
        string memory rationale
    ) internal {
        // Try NDA-style serviceResolve(uint256,bool,uint256,address)
        (bool ok, bytes memory returned) = targetContract.call(
            abi.encodeWithSignature("serviceResolve(uint256,bool,uint256,address)", 
                caseId, approve, appliedAmount, beneficiary)
        );
        if (ok) return;
        
        // If the target reverted with a reason, try the extended version with metadata
        if (returned.length > 0) {
            // Try Rent-style resolveDisputeFinal with classification and rationale
            (ok, returned) = targetContract.call(
                abi.encodeWithSignature("resolveDisputeFinal(uint256,bool,uint256,address,string,string)", 
                    caseId, approve, appliedAmount, beneficiary, classification, rationale)
            );
            if (ok) return;
            
            // If still failing, bubble up the original error
            assembly { revert(add(returned, 32), mload(returned)) }
        }
        
        // Try Rent-style resolveDisputeFinal with classification and rationale
        (ok, returned) = targetContract.call(
            abi.encodeWithSignature("resolveDisputeFinal(uint256,bool,uint256,address,string,string)", 
                caseId, approve, appliedAmount, beneficiary, classification, rationale)
        );
        if (ok) return;
        if (returned.length > 0) {
            assembly { revert(add(returned, 32), mload(returned)) }
        }
        
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
