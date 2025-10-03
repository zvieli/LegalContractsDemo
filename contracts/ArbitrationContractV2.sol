// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/dev/v1_X/FunctionsClient.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";

interface IArbitrationService {
    function applyResolutionToTarget(address targetContract, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external payable;
}

/// @title ArbitrationContractV2 - Chainlink Functions Client for AI-Powered Arbitration
/// @notice This contract serves as the Chainlink client that receives arbitration decisions
/// and forwards them to the ArbitrationService dispatcher. Implements security mitigations
/// per V7 specification.
contract ArbitrationContractV2 is FunctionsClient, ConfirmedOwner {
    using FunctionsRequest for FunctionsRequest.Request;
    
    address public service; // ArbitrationService address
    bytes32 public donId; // DON ID for Chainlink Functions
    uint64 public subscriptionId; // Chainlink Functions subscription ID
    uint32 public gasLimit; // Gas limit for Functions requests
    string public sourceCode; // JavaScript code for the LLM arbitration function
    bool public testMode; // For testing - bypasses Chainlink Functions
    
    // Mitigation 4.2: Track processed requests to prevent replay attacks
    mapping(bytes32 => bool) public processedRequests;
    mapping(bytes32 => ArbitrationRequest) public pendingRequests;
    
    struct ArbitrationRequest {
        address target;
        uint256 caseId;
        address requester;
        uint256 timestamp;
    }

    event ArbitrationRequested(address indexed requester, address indexed target, uint256 indexed caseId, bytes32 requestId);
    event ArbitrationFulfilled(bytes32 requestId, bool approve, uint256 appliedAmount, address beneficiary);
    event RequestProcessed(bytes32 indexed requestId, address indexed target, uint256 indexed caseId);

    constructor(address _service, address router) FunctionsClient(router) ConfirmedOwner(msg.sender) {
        service = _service;
        gasLimit = 300000; // Default gas limit
    }

    /// @notice Set the DON ID for Chainlink Functions
    function setDonId(bytes32 _donId) external onlyOwner {
        donId = _donId;
    }

    /// @notice Set the subscription ID for Chainlink Functions
    function setSubscriptionId(uint64 _subscriptionId) external onlyOwner {
        subscriptionId = _subscriptionId;
    }

    /// @notice Set the gas limit for Functions requests
    function setGasLimit(uint32 _gasLimit) external onlyOwner {
        gasLimit = _gasLimit;
    }

    /// @notice Set the JavaScript source code for the LLM arbitration function
    function setSourceCode(string calldata _sourceCode) external onlyOwner {
        sourceCode = _sourceCode;
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
    function requestArbitration(address target, uint256 caseId, bytes calldata metadata) external returns (bytes32) {
        require(target != address(0), "Invalid target");
        
        bytes32 requestId;
        
        if (testMode) {
            // In test mode, generate a mock request ID and emit event
            requestId = keccak256(abi.encodePacked(msg.sender, target, caseId, block.timestamp, metadata));
        } else {
            // Production mode - use Chainlink Functions
            require(donId != bytes32(0), "DON ID not set");
            require(subscriptionId != 0, "Subscription ID not set");
            require(bytes(sourceCode).length > 0, "Source code not set");
            
            // Create Functions request
            FunctionsRequest.Request memory req;
            req.initializeRequestForInlineJavaScript(sourceCode);
            
            // Set arguments: [target, caseId, metadata]
            string[] memory args = new string[](3);
            args[0] = addressToString(target);
            args[1] = uint256ToString(caseId);
            args[2] = string(metadata);
            req.setArgs(args);
            
            // Send the request
            requestId = _sendRequest(
                req.encodeCBOR(),
                subscriptionId,
                gasLimit,
                donId
            );
        }
        
        // Store pending request
        pendingRequests[requestId] = ArbitrationRequest({
            target: target,
            caseId: caseId,
            requester: msg.sender,
            timestamp: block.timestamp
        });
        
        emit ArbitrationRequested(msg.sender, target, caseId, requestId);
        return requestId;
    }

    /// @notice Chainlink Functions callback - called when the LLM arbitration completes
    /// @param requestId The request ID
    /// @param response The arbitration response from the LLM
    /// @param err Any error from the Functions execution
    function _fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
        require(pendingRequests[requestId].target != address(0), "Request not found");
        require(!processedRequests[requestId], "Request already processed");
        
        ArbitrationRequest memory request = pendingRequests[requestId];
        processedRequests[requestId] = true;
        
        if (err.length > 0) {
            // Handle error case - could emit error event or use default resolution
            emit RequestProcessed(requestId, request.target, request.caseId);
            return;
        }
        
        require(response.length > 0, "Empty response");
        
        // Decode response - expecting JSON encoded arbitration decision
        // Format: {"approve": true, "appliedAmount": "1000000000000000000", "beneficiary": "0x..."}
        (bool approve, uint256 appliedAmount, address beneficiary) = parseArbitrationResponse(response);
        
        require(beneficiary != address(0), "Invalid beneficiary");
        
        // Forward the decision to the ArbitrationService dispatcher
        IArbitrationService(service).applyResolutionToTarget(
            request.target, 
            request.caseId, 
            approve, 
            appliedAmount, 
            beneficiary
        );

        emit ArbitrationFulfilled(requestId, approve, appliedAmount, beneficiary);
        emit RequestProcessed(requestId, request.target, request.caseId);
        
        // Clean up
        delete pendingRequests[requestId];
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
        _fulfillRequest(requestId, response, "");
    }

    /// @notice Fallback to receive ETH
    receive() external payable {}
}
