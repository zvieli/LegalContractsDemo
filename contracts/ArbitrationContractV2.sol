// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IArbitrationService {
    function applyResolutionToTarget(address targetContract, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external payable;
}

/// @title ArbitrationContractV2 - Chainlink Functions Client for AI-Powered Arbitration
/// @notice This contract serves as the Chainlink client that receives arbitration decisions
/// and forwards them to the ArbitrationService dispatcher. Implements security mitigations
/// per V7 specification.
contract ArbitrationContractV2 {
    address public owner;
    address public oracle; // authorized oracle/fulfiller (e.g., Chainlink Functions runtime)
    address public service; // ArbitrationService address
    
    // Mitigation 4.2: Track processed requests to prevent replay attacks
    mapping(bytes32 => bool) public processedRequests;

    event ArbitrationRequested(address indexed requester, address indexed target, uint256 indexed caseId, bytes32 requestHash);
    event ArbitrationFulfilled(bytes32 requestHash, bool approve, uint256 appliedAmount, address beneficiary);
    event RequestProcessed(bytes32 indexed requestHash, address indexed target, uint256 indexed caseId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    constructor(address _service) {
        owner = msg.sender;
        service = _service;
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    function setService(address _service) external onlyOwner {
        service = _service;
    }

    /// @notice Emit an event describing the arbitration request. Off-chain oracle watches this.
    /// @param target The target contract address
    /// @param caseId The dispute case ID
    /// @param metadata Additional metadata for the arbitration request
    /// @return requestHash The unique hash identifying this request
    function requestArbitration(address target, uint256 caseId, bytes calldata metadata) external returns (bytes32) {
        require(target != address(0), "Invalid target");
        require(oracle != address(0), "Oracle not configured");
        
        bytes32 requestHash = keccak256(abi.encodePacked(msg.sender, target, caseId, block.timestamp, metadata));
        require(!processedRequests[requestHash], "Request already exists");
        
        emit ArbitrationRequested(msg.sender, target, caseId, requestHash);
        return requestHash;
    }

    /// @notice Called by the authorized oracle runtime to deliver the arbitration decision.
    /// @param response The encoded arbitration response (bool approve, uint256 appliedAmount, address beneficiary, string classification, string rationale)
    /// @param target The target contract to apply resolution to
    /// @param caseId The dispute case ID
    function fulfillArbitration(
        bytes calldata response, 
        bytes calldata /*err*/, 
        address target, 
        uint256 caseId
    ) external onlyOracle payable {
        require(target != address(0), "Invalid target");
        require(response.length > 0, "Empty response");
        
        // Generate request hash for this fulfillment
        bytes32 requestHash = keccak256(abi.encodePacked(target, caseId, response));
        require(!processedRequests[requestHash], "Request already processed");
        processedRequests[requestHash] = true;
        
        // Decode response - expecting ABI encoded (bool, uint256, address, string, string)
        (bool approve, uint256 appliedAmount, address beneficiary, , ) = abi.decode(
            response, 
            (bool, uint256, address, string, string)
        );
        
        require(beneficiary != address(0), "Invalid beneficiary");
        
        // Forward the decision to the ArbitrationService dispatcher
        // Forward any ETH sent by the oracle to help top-up deposits
        IArbitrationService(service).applyResolutionToTarget{value: msg.value}(
            target, 
            caseId, 
            approve, 
            appliedAmount, 
            beneficiary
        );

        emit ArbitrationFulfilled(requestHash, approve, appliedAmount, beneficiary);
        emit RequestProcessed(requestHash, target, caseId);
    }

    /// @notice Emergency function to mark a request as processed (owner only)
    /// @param requestHash The request hash to mark as processed
    function markRequestProcessed(bytes32 requestHash) external onlyOwner {
        processedRequests[requestHash] = true;
    }

    /// @notice Check if a request has been processed
    /// @param requestHash The request hash to check
    /// @return Whether the request has been processed
    function isRequestProcessed(bytes32 requestHash) external view returns (bool) {
        return processedRequests[requestHash];
    }

    /// @notice Transfer ownership to a new owner
    /// @param newOwner The new owner address
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner");
        owner = newOwner;
    }

    /// @notice Allow owner to withdraw any ETH sent to this contract
    function withdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    /// @notice Fallback to receive ETH
    receive() external payable {}
}
