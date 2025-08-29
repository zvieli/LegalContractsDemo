// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface INDATemplate {
    function resolveByArbitrator(uint256 caseId, bool approve, address beneficiary) external;
    function enforcePenalty(address guiltyParty, uint256 penaltyAmount, address beneficiary) external;
}

contract Arbitrator {
    address public owner;
    
    enum DisputeStatus { Pending, Resolved, Rejected }
    
    struct Dispute {
        address ndaContract;
        address partyA;
        address partyB;
        address reporter;
        bytes evidence;
        DisputeStatus status;
        uint256 penaltyAwarded;
        bool partyAVoted;
        bool partyBVoted;
        uint256 ndaCaseId;
    }
    
    mapping(uint256 => Dispute) public disputes;
    uint256 public disputeCounter;
    
    event DisputeCreated(uint256 indexed disputeId, address indexed ndaContract, address reporter, uint256 ndaCaseId);
    event DisputeResolved(uint256 indexed disputeId, address guiltyParty, uint256 penaltyAmount);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    function createDisputeForCase(
        address _ndaContract,
        uint256 _ndaCaseId,
        bytes calldata _evidence
    ) external returns (uint256) {
        disputeCounter++;
        
        disputes[disputeCounter] = Dispute({
            ndaContract: _ndaContract,
            partyA: address(0),
            partyB: address(0),
            reporter: msg.sender,
            evidence: _evidence,
            status: DisputeStatus.Pending,
            penaltyAwarded: 0,
            partyAVoted: false,
            partyBVoted: false,
            ndaCaseId: _ndaCaseId
        });
        
        emit DisputeCreated(disputeCounter, _ndaContract, msg.sender, _ndaCaseId);
        return disputeCounter;
    }
    
    function resolveDispute(uint256 _disputeId, address _guiltyParty, uint256 _penaltyAmount, address _beneficiary) external onlyOwner {
        require(_beneficiary != address(0), "Invalid beneficiary");
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.status == DisputeStatus.Pending, "Dispute not pending");
        
        dispute.status = DisputeStatus.Resolved;
        dispute.penaltyAwarded = _penaltyAmount;
        
        INDATemplate nda = INDATemplate(dispute.ndaContract);
        
        if (_penaltyAmount > 0) {
            nda.enforcePenalty(_guiltyParty, _penaltyAmount, _beneficiary);
        } else {
            nda.resolveByArbitrator(dispute.ndaCaseId, _penaltyAmount > 0, _beneficiary);
        }
        
        emit DisputeResolved(_disputeId, _guiltyParty, _penaltyAmount);
    }
    
    function getDispute(uint256 _disputeId) external view returns (
        address ndaContract,
        address partyA,
        address partyB,
        address reporter,
        DisputeStatus status,
        uint256 penaltyAwarded,
        uint256 ndaCaseId
    ) {
        require(_disputeId <= disputeCounter && _disputeId > 0, "Invalid dispute ID");
        Dispute memory dispute = disputes[_disputeId];
        
        return (
            dispute.ndaContract,
            dispute.partyA,
            dispute.partyB,
            dispute.reporter,
            dispute.status,
            dispute.penaltyAwarded,
            dispute.ndaCaseId
        );
    }
    
    function getActiveDisputesCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 1; i <= disputeCounter; i++) {
            if (disputes[i].status == DisputeStatus.Pending) {
                count++;
            }
        }
        return count;
    }
    
    function cancelDispute(uint256 _disputeId) external onlyOwner {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.status == DisputeStatus.Pending, "Dispute not pending");
        
        dispute.status = DisputeStatus.Rejected;
        emit DisputeResolved(_disputeId, address(0), 0);
    }
}