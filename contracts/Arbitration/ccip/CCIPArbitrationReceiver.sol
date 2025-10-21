// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Use local lightweight Client shim for editor/compile compatibility
import {Client} from "./LocalClient.sol";
import {CCIPArbitrationTypes} from "./CCIPArbitrationTypes.sol";

// Interface for CCIP Router (simplified)
interface ICCIPRouter {
    function ccipSend(
        uint64 destinationChainSelector,
        Client.EVM2AnyMessage calldata message
    ) external payable returns (bytes32);

    function getFee(
        uint64 destinationChainSelector,
        Client.EVM2AnyMessage calldata message
    ) external view returns (uint256);
}

// Interface for ArbitrationService
interface IArbitrationService {
    function applyResolutionToTarget(
        address targetContract, 
        uint256 caseId, 
        bool approve, 
        uint256 appliedAmount, 
        address beneficiary
    ) external payable;
    
    // Receiver entrypoint used for CCIP-forwarded decisions
    function receiveCCIPDecision(
        bytes32 messageId,
        address targetContract,
        uint256 caseId,
        CCIPArbitrationTypes.ArbitrationDecision memory decision
    ) external;
        // Raw entrypoint accepting ABI-encoded decision bytes (added for local compatibility)
        function receiveCCIPDecisionRaw(
            bytes32 messageId,
            address targetContract,
            uint256 caseId,
            bytes calldata decisionEncoded
        ) external;
}

/**
 * @title CCIPArbitrationReceiver
 * @notice Receives arbitration decisions via CCIP and executes them
 * @dev Simplified version without CCIPReceiver inheritance due to version conflicts
 */
contract CCIPArbitrationReceiver {
    
    // Core components
    ICCIPRouter public immutable ccipRouter;
    IArbitrationService public immutable arbitrationService;
    address public owner;
    
    // Oracle authorization
    mapping(uint64 => bool) public authorizedSourceChains;
    mapping(address => bool) public authorizedSenders;
    
    // Decision tracking
    mapping(bytes32 => CCIPArbitrationTypes.ArbitrationDecision) public executedDecisions;
    mapping(bytes32 => bool) public processedMessages;
    
    // Events
    event ArbitrationDecisionReceived(
        bytes32 indexed messageId,
        bytes32 indexed disputeId,
        uint64 indexed sourceChainSelector,
        bool approved,
        uint256 appliedAmount,
        address beneficiary,
        string rationale,
        bytes32 oracleId,
        uint256 timestamp
    );

    event ArbitrationExecuted(
        bytes32 indexed disputeId,
        address indexed targetContract,
        uint256 indexed caseId,
        bool approved,
        uint256 appliedAmount,
        address beneficiary
    );
    event ArbitrationForwardFailed(bytes32 indexed messageId, bytes reason);
    
    event SourceChainAuthorized(uint64 chainSelector, bool authorized);
    event SenderAuthorized(address sender, bool authorized);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /**
     * @notice Constructor
     * @param router CCIP Router address
     * @param _arbitrationService ArbitrationService contract address
     */
    constructor(
        address router,
        address _arbitrationService
    ) {
        require(router != address(0), "Invalid router");
        require(_arbitrationService != address(0), "Invalid arbitration service");
        
        ccipRouter = ICCIPRouter(router);
        arbitrationService = IArbitrationService(_arbitrationService);
        owner = msg.sender;
    }

    /**
     * @notice Handle incoming CCIP messages (external function for simplified version)
     * @param message CCIP message received
     */
    function ccipReceive(
        Client.Any2EVMMessage calldata message
    ) external {
        _handleMessage(message);
    }

    /**
     * @notice Alternate entrypoint that accepts raw tuple params (easier to call from test router)
     */
    function ccipReceiveRaw(
        bytes32 messageId,
        uint64 sourceChainSelector,
        bytes calldata sender,
        bytes calldata data
    ) external {
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: messageId,
            sourceChainSelector: sourceChainSelector,
            sender: sender,
            data: data
        });

        _handleMessage(message);
    }

    function _handleMessage(Client.Any2EVMMessage memory message) internal {
        // Verify source authorization
        require(
            authorizedSourceChains[message.sourceChainSelector],
            "Unauthorized source chain"
        );

        address sender = abi.decode(message.sender, (address));
        require(authorizedSenders[sender], "Unauthorized sender");

        // Prevent replay attacks
        bytes32 messageId = message.messageId;
        require(!processedMessages[messageId], "Message already processed");
        processedMessages[messageId] = true;

        // Decode CCIP message
        CCIPArbitrationTypes.CCIPMessage memory ccipMsg = 
            abi.decode(message.data, (CCIPArbitrationTypes.CCIPMessage));

        // Process based on message type
        if (ccipMsg.messageType == CCIPArbitrationTypes.MessageType.DECISION) {
            _processArbitrationDecision(messageId, message.sourceChainSelector, ccipMsg.data);
        } else if (ccipMsg.messageType == CCIPArbitrationTypes.MessageType.REQUEST) {
            // Forward to oracle processing system (off-chain)
            _processArbitrationRequest(messageId, message.sourceChainSelector, ccipMsg.data);
        }
    }

    /**
     * @notice Process arbitration decision and execute it
     * @param messageId CCIP message ID
     * @param sourceChainSelector Source chain selector
     * @param data Encoded arbitration decision
     */
    function _processArbitrationDecision(
        bytes32 messageId,
        uint64 sourceChainSelector,
        bytes memory data
    ) internal {
        
        CCIPArbitrationTypes.ArbitrationDecision memory decision = 
            abi.decode(data, (CCIPArbitrationTypes.ArbitrationDecision));

        // Store decision
        executedDecisions[messageId] = decision;

        emit ArbitrationDecisionReceived(
            messageId,
            decision.disputeId,
            sourceChainSelector,
            decision.approved,
            decision.appliedAmount,
            decision.beneficiary,
            decision.rationale,
            decision.oracleId,
            decision.timestamp
        );

        // Execute arbitration via ArbitrationService
        // Note: We need to map disputeId back to contract address and caseId
        // The decision now includes targetContract and caseId to allow on‑chain execution
        _executeArbitration(messageId, decision);
    }

    /**
     * @notice Process arbitration request (forward to off-chain oracle)
     * @param messageId CCIP message ID
     * @param sourceChainSelector Source chain selector  
     * @param data Encoded arbitration request
     */
    function _processArbitrationRequest(
        bytes32 messageId,
        uint64 sourceChainSelector,
        bytes memory data
    ) internal {
        
        CCIPArbitrationTypes.ArbitrationRequest memory request = 
            abi.decode(data, (CCIPArbitrationTypes.ArbitrationRequest));

        // Emit event for off-chain oracle to pick up
        emit CCIPArbitrationTypes.ArbitrationRequestSent(
            messageId,
            request.disputeId,
            sourceChainSelector,
            request.contractAddress,
            request.caseId
        );

        // Off-chain oracle will:
        // 1. Listen for this event
        // 2. Process arbitration using LLM
        // 3. Send decision back via CCIP
    }

    /**
     * @notice Execute arbitration decision on target contract
     * @param decision Arbitration decision to execute
     */
    function _executeArbitration(
        bytes32 messageId,
        CCIPArbitrationTypes.ArbitrationDecision memory decision
    ) internal {
        // Decision now contains targetContract and caseId
        address target = decision.targetContract;
        uint256 caseId = decision.caseId;

        emit ArbitrationExecuted(
            decision.disputeId,
            target,
            caseId,
            decision.approved,
            decision.appliedAmount,
            decision.beneficiary
        );

        // Call ArbitrationService.receiveCCIPDecisionRaw with ABI-encoded decision bytes to avoid struct encoding mismatches
        bytes memory encodedDecision = abi.encode(decision);
        // Use a low-level call so we can support services that return a small status
        // payload (e.g. 0 = failure, 1 = success) without reverting. Treat either
        // a failing call or a returned payload with leading 0 as a forward failure.
        bytes memory payload = abi.encodeWithSelector(
            bytes4(keccak256("receiveCCIPDecisionRaw(bytes32,address,uint256,bytes)")),
            messageId,
            target,
            caseId,
            encodedDecision
        );

        (bool ok, bytes memory returned) = address(arbitrationService).call(payload);

        // If the call failed (ok == false) or the service returned a leading 0 byte,
        // treat this as a forward failure and emit the event. Then attempt local fallbacks.
        bool consideredFailure = false;
        if (!ok) {
            consideredFailure = true;
        } else if (returned.length >= 1) {
            // interpret first byte: 0 == failure, non-zero == success
            if (returned[0] == 0x00) consideredFailure = true;
        }

        if (consideredFailure) {
            emit ArbitrationForwardFailed(messageId, returned);

            // As a best-effort fallback for local testing, attempt to apply the resolution
            // directly to the target using common template entrypoints. This prevents
            // stuck decisions in the local simulation when the ArbitrationService
            // forwarding fails due to ABI mismatches. Errors are swallowed so the
            // original failure event remains visible.
            (ok, returned) = target.call(
                abi.encodeWithSignature("serviceResolve(uint256,bool,uint256,address)", caseId, decision.approved, decision.appliedAmount, decision.beneficiary)
            );
            if (ok) return;
            // try extended resolveDisputeFinal
            (ok, returned) = target.call(
                abi.encodeWithSignature("resolveDisputeFinal(uint256,bool,uint256,address,string,string)", caseId, decision.approved, decision.appliedAmount, decision.beneficiary, "", decision.rationale)
            );
            return;
        }
    }

    /**
     * @notice Authorize/deauthorize source chain
     * @param chainSelector Chain selector to authorize
     * @param authorized Whether to authorize or deauthorize
     */
    function setSourceChainAuthorization(
        uint64 chainSelector,
        bool authorized
    ) external onlyOwner {
        authorizedSourceChains[chainSelector] = authorized;
        emit SourceChainAuthorized(chainSelector, authorized);
    }

    /**
     * @notice Authorize/deauthorize sender address
     * @param sender Sender address to authorize
     * @param authorized Whether to authorize or deauthorize
     */
    function setSenderAuthorization(
        address sender,
        bool authorized
    ) external onlyOwner {
        authorizedSenders[sender] = authorized;
        emit SenderAuthorized(sender, authorized);
    }

    /**
     * @notice Get arbitration decision by message ID
     * @param messageId CCIP message ID
     */
    function getDecision(bytes32 messageId) 
        external 
        view 
        returns (CCIPArbitrationTypes.ArbitrationDecision memory) 
    {
        return executedDecisions[messageId];
    }

    /**
     * @notice Check if message was processed
     * @param messageId CCIP message ID
     */
    function isMessageProcessed(bytes32 messageId) 
        external 
        view 
        returns (bool) 
    {
        return processedMessages[messageId];
    }

    /**
     * @notice Emergency function to process stuck messages manually
     * @param messageId Message ID
     * @param decision Arbitration decision
     */
    function emergencyExecuteDecision(
        bytes32 messageId,
        CCIPArbitrationTypes.ArbitrationDecision memory decision
    ) external onlyOwner {
        require(!processedMessages[messageId], "Message already processed");
        
        processedMessages[messageId] = true;
        executedDecisions[messageId] = decision;
        
        _executeArbitration(messageId, decision);
    }

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner");
        owner = newOwner;
    }
}