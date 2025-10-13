// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../ccip/CCIPArbitrationTypes.sol";

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

contract NDATemplate is EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    string public constant CONTRACT_NAME = "NDATemplate";
    string public constant CONTRACT_VERSION = "1";

    address public immutable partyA;
    address public immutable partyB;

    mapping(address => bool) public isParty;
    mapping(address => bool) public signedBy;
    address[] private _parties;

    uint256 public immutable expiryDate;
    uint16 public immutable penaltyBps;
    bytes32 public immutable customClausesHash;

    bool public active = true;

    mapping(address => uint256) public deposits;
    mapping(address => uint256) public withdrawable;
    uint256 public immutable minDeposit;

    address public immutable arbitrationService;

    uint256 public disputeFee;
    uint256 public minReportInterval;
    uint256 public maxOpenReportsPerReporter;

    bytes32 private constant NDA_TYPEHASH =
        keccak256("NDA(address contractAddress,uint256 expiryDate,uint16 penaltyBps,bytes32 customClausesHash)");

    event NDASigned(address indexed signer, uint256 timestamp);
    event PartyAdded(address indexed party);
    event DepositMade(address indexed party, uint256 amount);
    event DepositWithdrawn(address indexed party, uint256 amount);
    event BreachReported(uint256 indexed caseId, address indexed reporter, address indexed offender, uint256 requestedPenalty, bytes32 evidenceHash);
    event BreachResolved(uint256 indexed caseId, bool approved, uint256 appliedPenalty, address offender, address beneficiary);
    event ContractDeactivated(address indexed by, string reason);
    event PenaltyEnforced(address indexed offender, uint256 penaltyAmount, address beneficiary);
    event PaymentWithdrawn(address indexed to, uint256 amount);
    event BreachRationale(uint256 indexed caseId, string classification, string rationale);
    event CCIPArbitrationRequested(uint256 indexed caseId, bytes32 indexed messageId, bytes32 disputeId);
    event CCIPConfigUpdated(address indexed ccipSender, bool enabled);

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

    BreachCase[] private _cases;
    mapping(uint256 => CaseMeta) private _caseMeta;
    mapping(uint256 => uint256) private _caseFee;
    mapping(uint256 => uint256) private _revealDeadline;
    mapping(uint256 => uint256) private _resolvedAt;
    mapping(uint256 => PendingEnforcement) private _pendingEnforcement;

    mapping(address => uint256) public lastReportAt;
    mapping(address => uint256) public openReportsCount;
    mapping(address => uint256) public offenderBreachCount;

    uint256 public revealWindowSeconds;
    uint256 public appealWindowSeconds;

    ICCIPArbitrationSender public ccipSender;
    bool public ccipEnabled;
    mapping(uint256 => bytes32) public ccipMessageIds;

    constructor(
        address _partyA,
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        uint256 _minDeposit,
        address _arbitrationService
    ) EIP712(CONTRACT_NAME, CONTRACT_VERSION) {
        require(_partyA != address(0) && _partyB != address(0), "Invalid parties");
        require(_expiryDate > block.timestamp, "Expiry must be in future");
        require(_penaltyBps <= 10_000, "penaltyBps > 100%");

        partyA = _partyA;
        partyB = _partyB;

        expiryDate = _expiryDate;
        penaltyBps = _penaltyBps;
        customClausesHash = _customClausesHash;
        minDeposit = _minDeposit;
        arbitrationService = _arbitrationService;

        disputeFee = 0;
        minReportInterval = 0;
        maxOpenReportsPerReporter = 10;

        isParty[_partyA] = true;
        isParty[_partyB] = true;
        _parties.push(_partyA);
        _parties.push(_partyB);
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

    function addParty(address newParty) external onlyArbitrationService onlyActive {
        require(newParty != address(0), "Invalid address");
        require(!isParty[newParty], "Already a party");
        isParty[newParty] = true;
        _parties.push(newParty);
        emit PartyAdded(newParty);
    }

    function getParties() external view returns (address[] memory) {
        return _parties;
    }

    function signNDA(bytes calldata signature) external onlyActive {
        address signer = ECDSA.recover(_messageHash(), signature);
        require(isParty[signer], "Invalid signer (not a party)");
        require(!signedBy[signer], "Already signed");
        signedBy[signer] = true;
        emit NDASigned(signer, block.timestamp);
    }

    function configureCCIP(address _ccipSender, bool _enabled) external onlyArbitrationService {
        ccipSender = ICCIPArbitrationSender(_ccipSender);
        ccipEnabled = _enabled;
        emit CCIPConfigUpdated(_ccipSender, _enabled);
    }

    function isCCIPAvailable() external view returns (bool) {
        return ccipEnabled && address(ccipSender) != address(0);
    }

    function isFullySigned() public view returns (bool) {
        for (uint256 i = 0; i < _parties.length; ) {
            if (!signedBy[_parties[i]]) return false;
            unchecked { ++i; }
        }
        return true;
    }

    function canWithdraw() public view returns (bool) {
        if (active) return false;
        for (uint256 i = 0; i < _cases.length; ) {
            if (!_cases[i].resolved) return false;
            unchecked { ++i; }
        }
        return true;
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

    function reportBreach(
        address offender,
        uint256 requestedPenalty,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external payable onlyParty onlyActive returns (uint256 caseId) {
        require(isParty[offender], "Offender not a party");
        require(offender != msg.sender, "Cannot accuse self");
        require(requestedPenalty > 0, "Requested penalty must be > 0");
        require(deposits[offender] >= minDeposit, "Offender has no minimum deposit");

        if (disputeFee > 0) require(msg.value >= disputeFee, "Insufficient dispute fee");
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

        if (revealWindowSeconds > 0) _revealDeadline[caseId] = block.timestamp + revealWindowSeconds;

        emit BreachReported(caseId, msg.sender, offender, requestedPenalty, evidenceHash);

        if (ccipEnabled && address(ccipSender) != address(0)) {
            _triggerCCIPArbitration(caseId, evidenceHash, evidenceURI);
        }
    }

    function reportBreachWithMerkle(
        address offender,
        uint256 requestedPenalty,
        bytes32 evidenceHash,
        string calldata evidenceURI,
        bytes32 evidenceMerkleRoot
    ) external payable onlyParty onlyActive returns (uint256 caseId) {
        require(isParty[offender], "Offender not a party");
        require(offender != msg.sender, "Cannot accuse self");
        require(requestedPenalty > 0, "Requested penalty must be > 0");
        require(deposits[offender] >= minDeposit, "Offender has no minimum deposit");

        if (disputeFee > 0) require(msg.value >= disputeFee, "Insufficient dispute fee");
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
        bc.evidenceMerkleRoot = evidenceMerkleRoot;

        if (disputeFee > 0) _caseFee[caseId] = msg.value;
        lastReportAt[msg.sender] = block.timestamp;
        openReportsCount[msg.sender] += 1;

        if (revealWindowSeconds > 0) _revealDeadline[caseId] = block.timestamp + revealWindowSeconds;

        emit BreachReported(caseId, msg.sender, offender, requestedPenalty, evidenceHash);

        if (ccipEnabled && address(ccipSender) != address(0)) {
            _triggerCCIPArbitrationWithMerkle(caseId, evidenceHash, evidenceURI, evidenceMerkleRoot);
        }
    }

    function getCasesCount() external view returns (uint256) {
        return _cases.length;
    }

    function getCase(uint256 caseId) external view returns (
        address reporter,
        address offender,
        uint256 requestedPenalty,
        bytes32 evidenceHash,
        string memory evidenceURI,
        bytes32 evidenceMerkleRoot,
        bool resolved,
        bool approved
    ) {
        require(caseId < _cases.length, "Invalid case ID");
        BreachCase storage bc = _cases[caseId];
        return (bc.reporter, bc.offender, bc.requestedPenalty, bc.evidenceHash, bc.evidenceURI, bc.evidenceMerkleRoot, bc.resolved, bc.approved);
    }

    function _triggerCCIPArbitrationWithMerkle(uint256 caseId, bytes32 evidenceHash, string memory evidenceURI, bytes32 evidenceMerkleRoot) internal {
        require(caseId < _cases.length, "Invalid case ID");
        require(ccipEnabled && address(ccipSender) != address(0), "CCIP not available");

        BreachCase storage bc = _cases[caseId];
        bytes32 disputeId = keccak256(abi.encodePacked(address(this), caseId, block.timestamp, bc.reporter, bc.offender));
        string memory uriWithMerkle = string(abi.encodePacked(evidenceURI, "?merkleRoot=", _toHexString(evidenceMerkleRoot)));

        bytes32 messageId = ccipSender.sendArbitrationRequest(
            disputeId,
            address(this),
            caseId,
            evidenceHash,
            uriWithMerkle,
            bc.requestedPenalty,
            0
        );

        ccipMessageIds[caseId] = messageId;
        emit CCIPArbitrationRequested(caseId, messageId, disputeId);
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
            0
        );

        ccipMessageIds[caseId] = messageId;
        emit CCIPArbitrationRequested(caseId, messageId, disputeId);
    }

    function triggerCCIPArbitration(uint256 caseId) external payable onlyArbitrationService {
        require(caseId < _cases.length, "Invalid case ID");
        require(ccipEnabled && address(ccipSender) != address(0), "CCIP not available");

        BreachCase storage bc = _cases[caseId];
        require(!bc.resolved, "Case already resolved");

        _triggerCCIPArbitration(caseId, bc.evidenceHash, bc.evidenceURI);
    }

    function serviceResolve(uint256 caseId, bool approve, uint256 appliedPenalty, address beneficiary) external onlyActive nonReentrant {
        require(msg.sender == arbitrationService, "Only arbitration service");
        require(caseId < _cases.length, "Invalid case ID");
        require(beneficiary != address(0), "Invalid beneficiary");

        _applyResolution(caseId, approve, appliedPenalty, beneficiary);
    }

    function serviceEnforce(address guiltyParty, uint256 penaltyAmount, address beneficiary) external nonReentrant {
        require(msg.sender == arbitrationService, "Only arbitration service");
        require(penaltyAmount <= deposits[guiltyParty], "Insufficient deposit");
        require(penaltyAmount > 0, "Penalty must be > 0");
        require(beneficiary != address(0), "Invalid beneficiary");

        deposits[guiltyParty] -= penaltyAmount;
        withdrawable[beneficiary] += penaltyAmount;
        emit PenaltyEnforced(guiltyParty, penaltyAmount, beneficiary);
    }

    function getCaseMeta(uint256 caseId) external view returns (bytes32 classificationHash, bytes32 rationaleHash) {
        require(caseId < _cases.length, "Invalid case ID");
        CaseMeta storage m = _caseMeta[caseId];
        return (m.classificationHash, m.rationaleHash);
    }

    function getOffenderBreachCount(address offender) external view returns (uint256) {
        return offenderBreachCount[offender];
    }

    function setDisputeFee(uint256 fee) external onlyArbitrationService { disputeFee = fee; }
    function setRevealWindowSeconds(uint256 secondsWindow) external onlyArbitrationService { revealWindowSeconds = secondsWindow; }
    function setAppealWindowSeconds(uint256 secondsWindow) external onlyArbitrationService { appealWindowSeconds = secondsWindow; }
    function setMinReportInterval(uint256 secondsInterval) external onlyArbitrationService { minReportInterval = secondsInterval; }
    function setMaxOpenReportsPerReporter(uint256 maxOpen) external onlyArbitrationService { maxOpenReportsPerReporter = maxOpen; }
    function getRevealDeadline(uint256 caseId) external view returns (uint256) { require(caseId < _cases.length, "Invalid case ID"); return _revealDeadline[caseId]; }
    function getResolvedAt(uint256 caseId) external view returns (uint256) { require(caseId < _cases.length, "Invalid case ID"); return _resolvedAt[caseId]; }

    function finalizeEnforcement(uint256 caseId) external onlyActive onlyArbitrationService nonReentrant {
        require(caseId < _cases.length, "Invalid case ID");
        require(_pendingEnforcement[caseId].exists, "No pending enforcement");
        require(_resolvedAt[caseId] != 0, "Case not resolved");
        require(appealWindowSeconds > 0, "No appeal window configured");
        require(block.timestamp >= _resolvedAt[caseId] + appealWindowSeconds, "Appeal window not elapsed");

        PendingEnforcement storage pe = _pendingEnforcement[caseId];
        BreachCase storage bc = _cases[caseId];

        if (pe.appliedPenalty > 0) {
            require(pe.appliedPenalty <= deposits[bc.offender], "Insufficient deposit for pending penalty");
            deposits[bc.offender] -= pe.appliedPenalty;
            withdrawable[pe.beneficiary] += pe.appliedPenalty;
            emit PenaltyEnforced(bc.offender, pe.appliedPenalty, pe.beneficiary);
            offenderBreachCount[bc.offender] += 1;
        }

        if (pe.fee > 0 && pe.feeRecipient != address(0)) {
            withdrawable[pe.feeRecipient] += pe.fee;
        }

        delete _pendingEnforcement[caseId];
    }

    function _applyResolution(uint256 caseId, bool approve, uint256 appliedPenalty, address beneficiary) internal {
        BreachCase storage bc = _cases[caseId];
        bc.resolved = true;
        bc.approved = approve;

        _resolvedAt[caseId] = block.timestamp;

        uint256 applied = 0;
        if (approve) {
            applied = appliedPenalty > 0 ? appliedPenalty : bc.requestedPenalty;
            if (applied > deposits[bc.offender]) applied = deposits[bc.offender];

            if (applied > 0) {
                if (appealWindowSeconds > 0) {
                    _pendingEnforcement[caseId] = PendingEnforcement({ appliedPenalty: applied, beneficiary: beneficiary, fee: _caseFee[caseId], feeRecipient: bc.reporter, exists: true });
                } else {
                    deposits[bc.offender] -= applied;
                    withdrawable[beneficiary] += applied;
                    if (_caseFee[caseId] > 0) withdrawable[bc.reporter] += _caseFee[caseId];
                }
            }
        } else {
            if (appealWindowSeconds > 0) {
                _pendingEnforcement[caseId] = PendingEnforcement({ appliedPenalty: 0, beneficiary: beneficiary, fee: _caseFee[caseId], feeRecipient: beneficiary, exists: true });
            } else {
                if (_caseFee[caseId] > 0) withdrawable[beneficiary] += _caseFee[caseId];
            }
        }

        openReportsCount[bc.reporter] = openReportsCount[bc.reporter] > 0 ? openReportsCount[bc.reporter] - 1 : 0;
        _caseFee[caseId] = 0;
        if (approve) offenderBreachCount[bc.offender] += 1;

        emit BreachResolved(caseId, approve, applied, bc.offender, beneficiary);
    }

    function deactivate(string calldata reason) external {
        require(block.timestamp >= expiryDate, "Not authorized");
        require(active, "Already inactive");
        active = false;
        emit ContractDeactivated(msg.sender, reason);
    }

    function getContractStatus() external view returns (bool isActive, bool fullySigned, uint256 totalDeposits, uint256 activeCases) {
        uint256 totalDepositsValue;
        for (uint256 i = 0; i < _parties.length; ) {
            totalDepositsValue += deposits[_parties[i]];
            unchecked { ++i; }
        }

        uint256 unresolvedCases;
        for (uint256 j = 0; j < _cases.length; ) {
            if (!_cases[j].resolved) unresolvedCases++;
            unchecked { ++j; }
        }

        return (active, isFullySigned(), totalDepositsValue, unresolvedCases);
    }

    function _toHexString(bytes32 data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            str[i*2] = alphabet[uint8(data[i] >> 4)];
            str[1+i*2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }

    function getPendingEnforcement(uint256 caseId) external view returns (uint256 appliedPenalty, address beneficiary, uint256 fee, address feeRecipient, bool exists) {
        PendingEnforcement storage pe = _pendingEnforcement[caseId];
        return (pe.appliedPenalty, pe.beneficiary, pe.fee, pe.feeRecipient, pe.exists);
    }
}
