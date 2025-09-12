// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IArbitrationService {
    function applyResolutionToTarget(address targetContract, uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external;
}

// Per-dispute instance deployed by the Arbitrator factory. This is intentionally a
// separate top-level contract because Solidity doesn't allow nested contracts.
contract ArbitrationInstance {
    address public immutable factory;
    address public immutable platformOwner; // firm/platform owner who may resolve
    address public immutable ndaContract;
    uint256 public immutable ndaCaseId;
    address public immutable reporter;
    bool public resolved;

    event InstanceResolved(uint256 ndaCaseId, uint256 penaltyAmount, address beneficiary);

    constructor(address _ndaContract, uint256 _ndaCaseId, address _reporter, address _platformOwner) {
        factory = msg.sender;
        ndaContract = _ndaContract;
        ndaCaseId = _ndaCaseId;
        reporter = _reporter;
        platformOwner = _platformOwner;
        resolved = false;
    }

    // Only the platform owner can resolve a dispute on this instance.
    function resolve(uint256 _penaltyAmount, address _beneficiary) external {
        require(msg.sender == platformOwner, "Only platform owner");
        require(!resolved, "Already resolved");
        resolved = true;
        // Call back into the factory (Arbitrator) to apply the resolution via the
        // configured ArbitrationService. The factory holds the arbitrationService
        // address and dispute bookkeeping.
        Arbitrator(factory).applyResolutionFromInstance(address(this), _penaltyAmount, _beneficiary);
        emit InstanceResolved(ndaCaseId, _penaltyAmount, _beneficiary);
    }
}

contract Arbitrator {
    address public immutable owner;

    enum DisputeStatus { Pending, Resolved, Rejected }

    struct Dispute {
        address ndaContract;
        address reporter;
        bytes evidence;
        DisputeStatus status;
        uint256 penaltyAwarded;
        uint256 ndaCaseId;
        address arbitrationInstance;
    }

    mapping(uint256 => Dispute) public disputes;
    uint256 public disputeCounter;
    address public arbitrationService;
    mapping(address => uint256) public instanceToDisputeId;

    event DisputeCreated(uint256 indexed disputeId, address indexed ndaContract, address reporter, uint256 ndaCaseId, address arbitrationInstance);
    event DisputeResolved(uint256 indexed disputeId, address arbitrationInstance, uint256 penaltyAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setArbitrationService(address _service) external onlyOwner {
        arbitrationService = _service;
    }

    // Create a dispute and deploy a per-dispute ArbitrationInstance.
    function createDisputeForCase(
        address _ndaContract,
        uint256 _ndaCaseId,
        bytes calldata _evidence
    ) external returns (uint256) {
        uint256 id = ++disputeCounter;

        ArbitrationInstance instance = new ArbitrationInstance(_ndaContract, _ndaCaseId, msg.sender, owner);

        disputes[id] = Dispute({
            ndaContract: _ndaContract,
            reporter: msg.sender,
            evidence: _evidence,
            status: DisputeStatus.Pending,
            penaltyAwarded: 0,
            ndaCaseId: _ndaCaseId,
            arbitrationInstance: address(instance)
        });

        instanceToDisputeId[address(instance)] = id;

        emit DisputeCreated(id, _ndaContract, msg.sender, _ndaCaseId, address(instance));
        return id;
    }

    // Internal canonical resolver logic extracted so multiple external
    // overloads can forward to the same implementation without recursive
    // visibility issues.
    function _resolveDispute(uint256 _disputeId, uint256 _penaltyAmount, address _beneficiary) internal {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.status == DisputeStatus.Pending, "Dispute not pending");

        // Apply resolution via the configured ArbitrationService so templates only
        // accept service-originated calls (compatibility shim removed from templates).
        require(arbitrationService != address(0), "No arbitration service set");
        IArbitrationService(arbitrationService).applyResolutionToTarget(dispute.ndaContract, dispute.ndaCaseId, _penaltyAmount > 0, _penaltyAmount, _beneficiary);

        dispute.status = DisputeStatus.Resolved;
        dispute.penaltyAwarded = _penaltyAmount;

        emit DisputeResolved(_disputeId, dispute.arbitrationInstance, _penaltyAmount);
    }

    // Platform owner resolves disputes. Tests and older callers use the
    // 4-argument form (disputeId, offender, penaltyAmount, beneficiary).
    // The `offender` address is not required by the resolution flow, so it is
    // accepted but ignored. We expose only this 4-arg signature to avoid ABI
    // overload ambiguity in ethers.js.
    function resolveDispute(
        uint256 _disputeId,
        address /* _offender */,
        uint256 _penaltyAmount,
        address _beneficiary
    ) external onlyOwner {
        _resolveDispute(_disputeId, _penaltyAmount, _beneficiary);
    }

    /// @notice Called by a per-dispute ArbitrationInstance to apply a resolution.
    /// The caller must be a known arbitration instance created by this factory.
    function applyResolutionFromInstance(address, uint256 _penaltyAmount, address _beneficiary) external {
        uint256 id = instanceToDisputeId[msg.sender];
        require(id != 0, "Unknown instance");
        Dispute storage dispute = disputes[id];
        require(dispute.status == DisputeStatus.Pending, "Dispute not pending");
        require(arbitrationService != address(0), "No arbitration service set");

        IArbitrationService(arbitrationService).applyResolutionToTarget(dispute.ndaContract, dispute.ndaCaseId, _penaltyAmount > 0, _penaltyAmount, _beneficiary);

        dispute.status = DisputeStatus.Resolved;
        dispute.penaltyAwarded = _penaltyAmount;

        emit DisputeResolved(id, dispute.arbitrationInstance, _penaltyAmount);
    }

    function getDispute(uint256 _disputeId) external view returns (
        address ndaContract,
        address reporter,
        bytes memory evidence,
        DisputeStatus status,
        uint256 penaltyAwarded,
        uint256 ndaCaseId,
        address arbitrationInstance
    ) {
        require(_disputeId <= disputeCounter && _disputeId > 0, "Invalid dispute ID");
        Dispute memory dispute = disputes[_disputeId];

        return (
            dispute.ndaContract,
            dispute.reporter,
            dispute.evidence,
            dispute.status,
            dispute.penaltyAwarded,
            dispute.ndaCaseId,
            dispute.arbitrationInstance
        );
    }

    function getActiveDisputesCount() external view returns (uint256) {
        uint256 count = 0;
        uint256 dc = disputeCounter;
        for (uint256 i = 1; i <= dc; ) {
            if (disputes[i].status == DisputeStatus.Pending) {
                count++;
            }
            unchecked { ++i; }
        }
        return count;
    }

    function cancelDispute(uint256 _disputeId) external onlyOwner {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.status == DisputeStatus.Pending, "Dispute not pending");

        dispute.status = DisputeStatus.Rejected;
        emit DisputeResolved(_disputeId, dispute.arbitrationInstance, 0);
    }
}