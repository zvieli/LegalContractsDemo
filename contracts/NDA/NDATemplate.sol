// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "contracts/Arbitration/ccip/CCIPArbitrationTypes.sol";
import "contracts/MerkleEvidenceManager.sol";

interface ICCIPArbitrationSender {
    function sendArbitrationRequest(
        bytes32 disputeId,
        address contractAddress,
        uint256 caseId,
        bytes32 evidenceHash,
        string calldata evidenceURI,
        uint256 requestedAmount,
        uint8 payFeesIn
    ) external payable returns (bytes32 messageId);
}

enum ContractState { Draft, PendingActivation, Active, Disputed, Resolved, Terminated }
enum PayFeesIn { ETH, LINK }
enum DisputeStatus { None, Open, Resolved }
enum Role { Unassigned, Claimant, Defendant }

contract NDATemplate is EIP712, ReentrancyGuard {
    // --- Circuit Breaker ---
    bool private paused;
    PayFeesIn public payFeesIn;

    mapping(uint256 => DisputeStatus) private disputeStatus;
    mapping(uint256 => uint256) private appealDeadline;

    mapping(address => Role) private roles;
    mapping(bytes32 => bool) private clauseHashes;

    MerkleEvidenceManager public immutable merkleEvidenceManager;
    mapping(uint256 => bool) public batchUsedForEvidence;

    struct BreachCase {
        address reporter;
        address offender;
        uint256 requestedPenalty;
        bytes32 evidenceHash;
        string evidenceURI;
        bytes32 evidenceMerkleRoot;
        bool resolved;
        bool approved;
    }

    struct CaseMeta {
        bytes32 classificationHash;
        bytes32 rationaleHash;
    }

    struct PendingEnforcement {
        uint256 appliedPenalty;
        address beneficiary;
        uint256 fee;
        address feeRecipient;
        bool exists;
    }

    string public constant CONTRACT_NAME = "NDATemplate";
    string public constant CONTRACT_VERSION = "1";

    address public immutable partyA;
    address public immutable partyB;
    address public immutable arbitrationService;
    address public immutable factory;
    uint256 public immutable expiryDate;
    uint16 public immutable penaltyBps;
    bytes32 public immutable customClausesHash;
    uint256 public immutable minDeposit;
    uint256 public earlyTerminationFee;

    ContractState public contractState;
    bool public active = true;

    mapping(address => bool) private isParty;
    mapping(address => bool) private signedBy;
    address[] private _parties;

    mapping(address => uint256) public deposits;
    mapping(address => bool) public hasDeposited;
    mapping(address => uint256) public withdrawable;

    BreachCase[] private _cases;
    mapping(uint256 => CaseMeta) private _caseMeta;
    mapping(uint256 => uint256) private _caseFee;
    mapping(uint256 => uint256) private _revealDeadline;
    mapping(uint256 => uint256) private _resolvedAt;
    mapping(uint256 => PendingEnforcement) private _pendingEnforcement;

    mapping(address => uint256) public lastReportAt;
    mapping(address => uint256) public openReportsCount;
    mapping(address => uint256) public offenderBreachCount;

    uint256 public disputeFee;
    uint256 public minReportInterval;
    uint256 public maxOpenReportsPerReporter;
    uint256 public revealWindowSeconds;
    uint256 public appealWindowSeconds;

    ICCIPArbitrationSender public ccipSender;
    bool public ccipEnabled;
    mapping(uint256 => bytes32) public ccipMessageIds;

    bytes32 private constant NDA_TYPEHASH =
        keccak256("NDA(address contractAddress,uint256 expiryDate,uint16 penaltyBps,bytes32 customClausesHash)");

    // --- Events ---
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AppealOpened(uint256 indexed caseId, uint256 deadline);
    event RoleChanged(address indexed party, Role newRole);
    event ClauseHashAdded(bytes32 indexed clauseHash);
    event DecisionAudit(uint256 indexed caseId, bytes32 indexed decisionHash, string cid);
    event NDASigned(address indexed signer, uint256 timestamp);
    event PartyAdded(address indexed party);
    event DepositMade(address indexed party, uint256 amount);
    event DepositWithdrawn(address indexed party, uint256 amount);
    event BreachReported(uint256 indexed caseId, address indexed reporter, address indexed offender, uint256 requestedPenalty, bytes32 evidenceHash);
    event BreachResolved(uint256 indexed caseId, bool approved, uint256 appliedPenalty, address offender, address beneficiary);
    event ContractDeactivated(address indexed by, string reason);
    event PenaltyEnforced(address indexed offender, uint256 penaltyAmount, address beneficiary);
    event PaymentWithdrawn(address indexed to, uint256 amount);
    event CCIPArbitrationRequested(uint256 indexed caseId, bytes32 indexed messageId, bytes32 disputeId);
    event CCIPConfigUpdated(address indexed ccipSender, bool enabled);
    event MutualCancelRequested(address indexed party, uint256 indexed timestamp);
    event MutualCancelExecuted(uint256 indexed timestamp);
    event ContractActivated(uint256 timestamp);
    event ArbitrationResolved(uint256 indexed caseId, bool approved, uint256 appliedPenalty, address beneficiary);
    event ContractTerminated(uint256 timestamp);
    event AppealResolved(uint256 indexed caseId, bool approved, uint256 timestamp);
    event EvidenceBatchReferenced(uint256 indexed caseId, uint256 indexed batchId, bytes32 indexed merkleRoot, address reporter);
    event BatchEvidenceVerified(uint256 indexed caseId, uint256 indexed batchId, bytes32 indexed cidHash, address uploader, bytes32 contentDigest);

    // --- Modifiers ---
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier whenPaused() {
        require(paused, "Contract is not paused");
        _;
    }

    modifier onlyClaimant() {
        require(roles[msg.sender] == Role.Claimant, "Not Claimant");
        _;
    }

    modifier onlyDefendant() {
        require(roles[msg.sender] == Role.Defendant, "Not Defendant");
        _;
    }

    modifier onlyActive() {
        require(active, "Contract inactive");
        _;
    }

    modifier onlyArbitrationService() {
        require(msg.sender == arbitrationService, "Only arbitration service");
        _;
    }

    modifier onlyParty() {
        require(isParty[msg.sender], "Only party");
        _;
    }

    // --- Constructor ---
    constructor(
        address _partyA,
        address _partyB,
        address _arbitrationService,
        address _factory,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        uint256 _minDeposit,
        address _merkleEvidenceManager,
        PayFeesIn _payFeesIn
    ) EIP712(CONTRACT_NAME, CONTRACT_VERSION) {
        partyA = _partyA;
        partyB = _partyB;
        arbitrationService = _arbitrationService;
        factory = _factory;
        expiryDate = _expiryDate;
        penaltyBps = _penaltyBps;
        customClausesHash = _customClausesHash;
        minDeposit = _minDeposit;
        payFeesIn = _payFeesIn;

        merkleEvidenceManager = MerkleEvidenceManager(_merkleEvidenceManager);

        isParty[_partyA] = true;
        isParty[_partyB] = true;
        _parties.push(_partyA);
        _parties.push(_partyB);
        contractState = ContractState.Draft;

        roles[_partyA] = Role.Unassigned;
        roles[_partyB] = Role.Unassigned;

        // Initialize reporting limits
        maxOpenReportsPerReporter = 1; // Allow 1 open report per reporter
        minReportInterval = 3600; // 1 hour minimum between reports
        revealWindowSeconds = 86400; // 24 hours to reveal evidence
        appealWindowSeconds = 604800; // 7 days to appeal
        disputeFee = 0.001 ether; // Minimum dispute fee
    }

    // --- Pause/Unpause ---
    function pause() external {
        require(msg.sender == factory || msg.sender == arbitrationService, "Only admin/factory");
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external {
        require(msg.sender == factory || msg.sender == arbitrationService, "Only admin/factory");
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    // --- Roles & Clauses ---
    function setRole(address party, Role newRole) external {
        require(msg.sender == factory, "Only Factory");
        require(contractState == ContractState.Disputed, "Can set role only in Disputed state");
        require(isParty[party], "Not a party");
        roles[party] = newRole;
        emit RoleChanged(party, newRole);
    }

    function addClauseHash(bytes32 clauseHash) external {
        require(msg.sender == factory, "Only Factory");
        require(!clauseHashes[clauseHash], "Clause already exists");
        clauseHashes[clauseHash] = true;
        emit ClauseHashAdded(clauseHash);
    }

    function verifyClauseHash(bytes32 clauseHash) external view returns (bool) {
        return clauseHashes[clauseHash];
    }

    function getRole(address party) external view returns (Role) {
        return roles[party];
    }

    // --- Receive/Fallback ---
    receive() external payable {
        revert("Direct ETH not allowed");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }

    // --- NDA Signing ---
    function _messageHash() internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    NDA_TYPEHASH,
                    address(this),
                    expiryDate,
                    penaltyBps,
                    customClausesHash
                )
            )
        );
    }

    function hashMessage() external view returns (bytes32) {
        return _messageHash();
    }

    function signNDA(bytes calldata signature) external onlyActive {
        address signer = ECDSA.recover(_messageHash(), signature);
        require(isParty[signer], "Invalid signer (not a party)");
        require(!signedBy[signer], "Already signed");
        signedBy[signer] = true;
        emit NDASigned(signer, block.timestamp);
        _checkActivation();
    }

    function _checkActivation() internal {
        bool allSigned = true;
        bool allDeposited = true;
        for (uint256 i = 0; i < _parties.length; i++) {
            if (!signedBy[_parties[i]]) allSigned = false;
            if (!hasDeposited[_parties[i]]) allDeposited = false;
        }
        if (allSigned && allDeposited) {
            contractState = ContractState.Active;
            emit ContractActivated(block.timestamp);
        } else if (allSigned || allDeposited) {
            contractState = ContractState.PendingActivation;
        }
    }

    // --- Party Management ---
    function addParty(address newParty) external onlyArbitrationService onlyActive {
        require(msg.sender == factory, "Only Factory");
        require(newParty != address(0), "Invalid address");
        require(!isParty[newParty], "Already a party");
        isParty[newParty] = true;
        _parties.push(newParty);
        emit PartyAdded(newParty);
    }

    function getParties() external view returns (address[] memory) {
        return _parties;
    }

    // --- Deposits ---
    function deposit() external payable onlyParty onlyActive whenNotPaused {
        require(msg.value >= minDeposit, "Deposit below minimum");
        deposits[msg.sender] += msg.value;
        hasDeposited[msg.sender] = true;
        emit DepositMade(msg.sender, msg.value);
        _checkActivation();
    }

    function withdrawDeposit(uint256 amount) external nonReentrant {
        require(canWithdraw(), "Cannot withdraw yet");
        require(deposits[msg.sender] >= amount && amount > 0, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        withdrawable[msg.sender] += amount;
        emit DepositWithdrawn(msg.sender, amount);
    }

    function withdrawPayments() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        require(amount > 0, "No funds to withdraw");
        withdrawable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit PaymentWithdrawn(msg.sender, amount);
    }

    function getTotalDeposited() public view returns (uint256 total) {
        for (uint256 i = 0; i < _parties.length; i++) {
            total += deposits[_parties[i]];
        }
    }

    function canWithdraw() public view returns (bool) {
        return contractState == ContractState.Terminated;
    }

    // --- Mutual Cancel ---
    mapping(address => bool) private cancelVotes;

    function mutualCancel() external onlyParty nonReentrant {
        require(contractState == ContractState.Active, "Not active");
        require(contractState != ContractState.Disputed, "Cannot cancel during dispute");
        require(!cancelVotes[msg.sender], "Already voted");
        cancelVotes[msg.sender] = true;
        emit MutualCancelRequested(msg.sender, block.timestamp);

        bool allVoted = true;
        for (uint256 i = 0; i < _parties.length; i++) {
            if (!cancelVotes[_parties[i]]) {
                allVoted = false;
                break;
            }
        }
        if (allVoted) {
            _finalizeMutualCancel();
        }
    }

    function _finalizeMutualCancel() internal {
        contractState = ContractState.Terminated;
        emit MutualCancelExecuted(block.timestamp);
        _finalizeWithdrawals();
    }

    function _finalizeWithdrawals() internal {
        uint256 fee = earlyTerminationFee;
        if (fee > 0) {
            payable(arbitrationService).transfer(fee);
        }
        for (uint256 i = 0; i < _parties.length; i++) {
            address party = _parties[i];
            uint256 amount = deposits[party];
            if (amount > 0) {
                deposits[party] = 0;
                hasDeposited[party] = false;
                (bool ok, ) = payable(party).call{value: amount}("");
                require(ok, "Withdraw failed");
            }
        }
    }

    // --- Breach Reporting ---
    function reportBreach(
        address offender,
        uint256 requestedPenalty,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external payable onlyParty onlyActive whenNotPaused returns (uint256 caseId) {
        require(contractState == ContractState.Active, "Must be active");
        require(isParty[offender], "Offender not a party");
        require(offender != msg.sender, "Cannot accuse self");
        require(requestedPenalty > 0, "Requested penalty must be > 0");
        require(deposits[offender] >= minDeposit, "Offender has no minimum deposit");

        if (payFeesIn == PayFeesIn.ETH) {
            require(msg.value == disputeFee, "Incorrect dispute fee (ETH)");
        }

        if (minReportInterval > 0) require(block.timestamp - lastReportAt[msg.sender] >= minReportInterval, "Reporting too frequently");
        require(openReportsCount[msg.sender] < maxOpenReportsPerReporter, "Too many open reports");

        caseId = _cases.length;
        _cases.push();
        BreachCase storage bc = _cases[caseId];
        bc.reporter = msg.sender;
        bc.offender = offender;
        bc.requestedPenalty = requestedPenalty;
        bc.evidenceHash = evidenceHash;
        bc.evidenceURI = evidenceURI;
        bc.evidenceMerkleRoot = bytes32(0);

        disputeStatus[caseId] = DisputeStatus.Open;
        lastReportAt[msg.sender] = block.timestamp;
        openReportsCount[msg.sender] += 1;
        contractState = ContractState.Disputed;

        emit BreachReported(caseId, msg.sender, offender, requestedPenalty, evidenceHash);

        if (ccipEnabled && address(ccipSender) != address(0)) {
            _triggerCCIPArbitration(caseId, evidenceHash, evidenceURI);
        }
    }

    // --- Paginated Dispute History ---
    function getDisputeHistoryPaginated(uint256 offset, uint256 limit) external view returns (BreachCase[] memory cases) {
        uint256 total = _cases.length;
        if (offset >= total) return new BreachCase[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;
        cases = new BreachCase[](size);
        for (uint256 i = 0; i < size; i++) {
            cases[i] = _cases[offset + i];
        }
    }

    function getCase(uint256 caseId) external view returns (BreachCase memory) {
        require(caseId < _cases.length, "Case does not exist");
        return _cases[caseId];
    }

    // --- Arbitration Resolution ---
    function serviceResolve(uint256 caseId, bool approve, uint256 appliedAmount, address beneficiary) external payable onlyArbitrationService {
        require(caseId < _cases.length, "Invalid case ID");
        BreachCase storage bc = _cases[caseId];
        require(!bc.resolved, "Case already resolved");

        bc.resolved = true;
        bc.approved = approve;

        if (approve && appliedAmount > 0) {
            // Apply penalty - transfer from offender's deposits to beneficiary
            uint256 available = deposits[bc.offender];
            uint256 penalty = appliedAmount > available ? available : appliedAmount;

            if (penalty > 0) {
                deposits[bc.offender] -= penalty;
                if (beneficiary == address(this)) {
                    // Keep in contract
                } else {
                    withdrawable[beneficiary] += penalty;
                }
                emit PenaltyEnforced(bc.offender, penalty, beneficiary);
            }
        }

        emit BreachResolved(caseId, approve, appliedAmount, bc.offender, beneficiary);
        emit ArbitrationResolved(caseId, approve, appliedAmount, beneficiary);
    }

    // --- CCIP Arbitration ---
    function configureCCIP(address _ccipSender, bool _enabled) external onlyArbitrationService {
        ccipSender = ICCIPArbitrationSender(_ccipSender);
        ccipEnabled = _enabled;
        emit CCIPConfigUpdated(_ccipSender, _enabled);
    }

    function setPayFeesIn(PayFeesIn _payFeesIn) external {
        require(msg.sender == factory, "Only Factory");
        payFeesIn = _payFeesIn;
    }

    function isCCIPAvailable() external view returns (bool) {
        return ccipEnabled && address(ccipSender) != address(0);
    }

    function _triggerCCIPArbitration(uint256 caseId, bytes32 evidenceHash, string memory evidenceURI) internal {
        require(caseId < _cases.length, "Invalid case ID");
        require(ccipEnabled && address(ccipSender) != address(0), "CCIP not available");

        BreachCase storage bc = _cases[caseId];
        bytes32 disputeId = keccak256(abi.encodePacked(address(this), caseId, block.timestamp, bc.reporter, bc.offender));

        bytes32 messageId = ccipSender.sendArbitrationRequest(
            disputeId,
            address(this),
            caseId,
            evidenceHash,
            evidenceURI,
            bc.requestedPenalty,
            uint8(payFeesIn)
        );

        ccipMessageIds[caseId] = messageId;
        emit CCIPArbitrationRequested(caseId, messageId, disputeId);
    }
}
