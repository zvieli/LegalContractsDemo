// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title Arbitrator
 * @notice V7 LLM Oracle Interface for LegalContractsDemo
 * @dev Accepts structured arbitration decisions from off-chain LLM via an authorized Oracle relay.
 *      Forwards the final decision to ArbitrationService for enforcement.
 */
contract Arbitrator {
    address public owner;
    address public arbitrationService;

    event DecisionReceived(bytes32 indexed caseId, string decisionJson);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyArbitrationService() {
        require(msg.sender == arbitrationService, "Only ArbitrationService");
        _;
    }

    constructor(address _arbitrationService) {
        owner = msg.sender;
        arbitrationService = _arbitrationService;
    }

    /**
     * @notice Called by Oracle relay to submit final LLM decision
     * @param caseId Unique case identifier
     * @param decisionJson Structured JSON decision from LLM
     */
    function submitDecision(bytes32 caseId, string calldata decisionJson) external onlyOwner {
        emit DecisionReceived(caseId, decisionJson);
        // Forward to ArbitrationService for enforcement (off-chain triggers actual call)
    }

    /**
     * @notice Allows owner to update ArbitrationService address
     */
    function setArbitrationService(address _arbitrationService) external onlyOwner {
        arbitrationService = _arbitrationService;
    }
}
