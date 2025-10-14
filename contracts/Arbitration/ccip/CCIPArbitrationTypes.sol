// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CCIPArbitrationTypes
 * @notice Types and structures for CCIP-based arbitration system
 * @dev Defines data structures for cross-chain arbitration messages
 */
library CCIPArbitrationTypes {
    
    /**
     * @notice Arbitration request structure
     * @param disputeId Unique identifier for the dispute
     * @param contractAddress Address of the contract with the dispute
     * @param caseId Case identifier within the contract
     * @param requester Address that initiated the arbitration request
     * @param evidenceHash Hash of the evidence (keccak256)
     * @param evidenceURI URI pointing to evidence data (IPFS or HTTP)
     * @param requestedAmount Amount being disputed (in wei)
     * @param timestamp When the request was created
     */
    struct ArbitrationRequest {
        bytes32 disputeId;
        address contractAddress;
        uint256 caseId;
        address requester;
        bytes32 evidenceHash;
        string evidenceURI;
        uint256 requestedAmount;
        uint256 timestamp;
    }

    /**
     * @notice Arbitration decision structure
     * @param disputeId Unique identifier for the dispute
     * @param approved Whether the claim is approved
     * @param appliedAmount Amount to be paid (0 if rejected)
     * @param beneficiary Who should receive the payment
     * @param rationale Brief explanation of the decision
     * @param oracleId Identifier of the oracle that made the decision
     * @param timestamp When the decision was made
     */
    struct ArbitrationDecision {
        bytes32 disputeId;
        bool approved;
        uint256 appliedAmount;
        address beneficiary;
        string rationale;
        bytes32 oracleId;
        uint256 timestamp;
    }

    /**
     * @notice Message types for CCIP communication
     */
    enum MessageType {
        REQUEST,    // Arbitration request
        DECISION,   // Arbitration decision
        STATUS      // Status update
    }

    /**
     * @notice CCIP message wrapper
     * @param messageType Type of message being sent
     * @param data Encoded data (ArbitrationRequest or ArbitrationDecision)
     */
    struct CCIPMessage {
        MessageType messageType;
        bytes data;
    }

    /**
     * @notice Event emitted when arbitration request is sent via CCIP
     */
    event ArbitrationRequestSent(
        bytes32 indexed messageId,
        bytes32 indexed disputeId,
        uint64 indexed destinationChainSelector,
        address contractAddress,
        uint256 caseId
    );

    /**
     * @notice Event emitted when arbitration decision is received via CCIP
     */
    event ArbitrationDecisionReceived(
        bytes32 indexed messageId,
        bytes32 indexed disputeId,
        uint64 indexed sourceChainSelector,
        bool approved,
        uint256 appliedAmount
    );

    /**
     * @notice Event emitted when arbitration is executed on target contract
     */
    event ArbitrationExecuted(
        bytes32 indexed disputeId,
        address indexed targetContract,
        uint256 indexed caseId,
        bool approved,
        uint256 appliedAmount,
        address beneficiary
    );
}