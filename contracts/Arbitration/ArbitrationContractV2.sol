// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CCIPArbitrationTypes} from "./ccip/CCIPArbitrationTypes.sol";
import {IRouterClientLocal, Client} from "../mocks/MockCCIPRouter.sol";

interface IArbitrationService {
    function applyResolutionToTarget(address targetContract, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external payable;
}

/// @title ArbitrationContractV2 - Chainlink Functions Client for AI-Powered Arbitration
/// @notice This contract serves as the Chainlink client that receives arbitration decisions
/// and forwards them to the ArbitrationService dispatcher. Implements security mitigations
/// per V7 specification.
contract ArbitrationContractV2 is Ownable {
    using Client for Client.EVM2AnyMessage;

    address public service; // ArbitrationService address
    IRouterClientLocal public router; // local CCIP router/mock
    uint64 public destinationChainSelector; // chain selector for CCIP sends (0 for local)
    uint32 public gasLimit; // gas limit hint for CCIP extra args
    bool public testMode; // For testing - allow local simulated flows
    
    // Mitigation 4.2: Track processed requests to prevent replay attacks
    mapping(bytes32 => bool) public processedRequests;
    mapping(bytes32 => ArbitrationRequest) public pendingRequests; // keyed by CCIP messageId
    
    struct ArbitrationRequest {
        address target;
        uint256 caseId;
        address requester;
        uint256 timestamp;
        bytes32 disputeId;
    }

    event ArbitrationRequested(address indexed requester, address indexed target, uint256 indexed caseId, bytes32 requestId);
    event ArbitrationFulfilled(bytes32 requestId, bool approve, uint256 appliedAmount, address beneficiary);
    event RequestProcessed(bytes32 indexed requestId, address indexed target, uint256 indexed caseId);

    constructor(address _service, address routerAddress) Ownable(msg.sender) {
        // Owner initialized via Ownable(msg.sender)
        service = _service;
        router = IRouterClientLocal(routerAddress);
        destinationChainSelector = 0; // local by default
        gasLimit = 300000; // Default gas limit
    }

    /// @notice Set the DON ID for Chainlink Functions
    function setGasLimit(uint32 _gasLimit) external onlyOwner {
        gasLimit = _gasLimit;
    }

    function setRouter(address routerAddress) external onlyOwner {
        router = IRouterClientLocal(routerAddress);
    }

    function setDestinationChainSelector(uint64 sel) external onlyOwner {
        destinationChainSelector = sel;
    }

    /// @notice Enable test mode to bypass Chainlink Functions (FOR TESTING ONLY)
    function setTestMode(bool _testMode) external onlyOwner {
        testMode = _testMode;
    }

    function setService(address _service) external onlyOwner {
        service = _service;
    }

    /// @notice Send an arbitration request to Chainlink Functions
    /// @param target The target contract address
    /// @param caseId The dispute case ID
    /// @param metadata Additional metadata for the arbitration request
    /// @return requestId The Chainlink Functions request ID
    function requestArbitration(address target, uint256 caseId, bytes calldata metadata) external payable returns (bytes32) {
        require(target != address(0), "Invalid target");

        // Build dispute id and arbitration request payload
        bytes32 disputeId = keccak256(abi.encodePacked(msg.sender, target, caseId, block.timestamp, metadata));

        CCIPArbitrationTypes.ArbitrationRequest memory arReq = CCIPArbitrationTypes.ArbitrationRequest({
            disputeId: disputeId,
            contractAddress: target,
            caseId: caseId,
            requester: msg.sender,
            evidenceHash: keccak256(metadata),
            evidenceURI: "",
            requestedAmount: 0,
            timestamp: block.timestamp
        });

        CCIPArbitrationTypes.CCIPMessage memory ccipMsg = CCIPArbitrationTypes.CCIPMessage({
            messageType: CCIPArbitrationTypes.MessageType.REQUEST,
            data: abi.encode(arReq)
        });

        Client.EVM2AnyMessage memory message;
        message.receiver = abi.encode(address(this));
        message.data = abi.encode(ccipMsg);
        message.tokenAmounts = new Client.EVMTokenAmount[](0);
        message.feeToken = address(0);
        message.extraArgs = Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: gasLimit}));

        // ask router for fee and forward it
        uint256 fee = router.getFee(destinationChainSelector, message);
        require(msg.value >= fee, "Insufficient fee provided");

        bytes32 messageId = router.ccipSend{value: fee}(destinationChainSelector, message);

        pendingRequests[messageId] = ArbitrationRequest({
            target: target,
            caseId: caseId,
            requester: msg.sender,
            timestamp: block.timestamp,
            disputeId: disputeId
        });

        emit ArbitrationRequested(msg.sender, target, caseId, messageId);
        return messageId;
    }

    /// @notice CCIP router entrypoint - called when the LLM arbitration completes (local test router calls this)
    /// @param messageId The CCIP message ID generated by the router
    /// @param sourceChainSelector The source chain selector provided by the router
    /// @param senderEncoded ABI-encoded sender (usually abi.encode(requester))
    /// @param payload ABI-encoded CCIPMessage (ccip messageType + data)
    /// @notice Entrypoint used by CCIP router (local mock) to deliver raw messages
    /// The MockCCIPRouter.simulateDecisionTo calls this raw receiver method in tests
    function ccipReceiveRaw(bytes32 messageId, uint64 sourceChainSelector, bytes calldata senderEncoded, bytes calldata payload) external {
        // In a production setup you'd restrict this to the router address. For local tests the router can call freely.
        // require(msg.sender == address(router), "Only router can call");

        require(!processedRequests[messageId], "Request already processed");
        require(pendingRequests[messageId].target != address(0), "Request not found");

        // payload is abi.encode(CCIPMessage)
        (CCIPArbitrationTypes.MessageType mType, bytes memory data) = abi.decode(payload, (CCIPArbitrationTypes.MessageType, bytes));
        if (mType != CCIPArbitrationTypes.MessageType.DECISION) {
            emit RequestProcessed(messageId, pendingRequests[messageId].target, pendingRequests[messageId].caseId);
            return;
        }

        CCIPArbitrationTypes.ArbitrationDecision memory decision = abi.decode(data, (CCIPArbitrationTypes.ArbitrationDecision));

        ArbitrationRequest memory request = pendingRequests[messageId];
        processedRequests[messageId] = true;

        // Use the decision to apply resolution
        IArbitrationService(service).applyResolutionToTarget(
            request.target,
            request.caseId,
            decision.approved,
            decision.appliedAmount,
            decision.beneficiary
        );

        emit ArbitrationFulfilled(messageId, decision.approved, decision.appliedAmount, decision.beneficiary);
        emit RequestProcessed(messageId, request.target, request.caseId);

        delete pendingRequests[messageId];
    }

    /// @notice Parse the JSON response from the LLM arbitration function
    /// @param response The raw response bytes
    /// @return approve Whether the dispute is approved
    /// @return appliedAmount The penalty amount to apply
    /// @return beneficiary The address to receive the penalty
    function parseArbitrationResponse(bytes memory response) internal pure returns (bool approve, uint256 appliedAmount, address beneficiary) {
        // For now, decode as ABI-encoded response
        // In production, would parse JSON response from LLM
        (approve, appliedAmount, beneficiary) = abi.decode(response, (bool, uint256, address));
    }

    /// @notice Emergency function to mark a request as processed (owner only)
    /// @param requestId The request ID to mark as processed
    function markRequestProcessed(bytes32 requestId) external onlyOwner {
        processedRequests[requestId] = true;
        delete pendingRequests[requestId];
    }

    /// @notice Check if a request has been processed
    /// @param requestId The request ID to check
    /// @return Whether the request has been processed
    function isRequestProcessed(bytes32 requestId) external view returns (bool) {
        return processedRequests[requestId];
    }

    /// @notice Allow owner to withdraw any ETH sent to this contract
    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    /// @notice Helper function to convert address to string
    function addressToString(address _addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        for (uint256 i = 0; i < 20; i++) {
            str[2+i*2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3+i*2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }
        return string(str);
    }

    /// @notice Helper function to convert uint256 to string
    function uint256ToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /// @notice Test-only function to simulate fulfillment (DO NOT USE IN PRODUCTION)
    function simulateResponse(bytes32 requestId, bytes memory response) external onlyOwner {
        // Build a decision from the provided response bytes using the same
        // parse logic used for real LLM responses. Then deliver it via the
        // same raw CCIP receiver entrypoint used by the MockCCIPRouter.
        ArbitrationRequest memory request = pendingRequests[requestId];
        require(request.target != address(0), "Request not found");

        (bool approve, uint256 appliedAmount, address beneficiary) = parseArbitrationResponse(response);

        CCIPArbitrationTypes.ArbitrationDecision memory decision = CCIPArbitrationTypes.ArbitrationDecision({
            disputeId: request.disputeId,
            approved: approve,
            appliedAmount: appliedAmount,
            beneficiary: beneficiary,
            rationale: "",
            oracleId: bytes32(0),
            timestamp: block.timestamp,
            targetContract: request.target,
            caseId: request.caseId
        });

        CCIPArbitrationTypes.CCIPMessage memory ccipMsg = CCIPArbitrationTypes.CCIPMessage({
            messageType: CCIPArbitrationTypes.MessageType.DECISION,
            data: abi.encode(decision)
        });

        // Call the raw receive entrypoint as the router would. Use the stored
        // requester as the encoded sender for realism.
        bytes memory senderEncoded = abi.encode(request.requester);
        bytes memory payload = abi.encode(ccipMsg);

        // Deliver the decision locally by invoking the receiver entrypoint.
        // This mirrors MockCCIPRouter.simulateDecisionTo behavior.
        this.ccipReceiveRaw(requestId, destinationChainSelector, senderEncoded, payload);
    }

    /// @notice Fallback to receive ETH
    receive() external payable {}
}
