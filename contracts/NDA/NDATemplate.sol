// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// factory enforcement removed (size optimization) - use off-chain policy & deployer pattern
contract NDATemplate is EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    string public constant CONTRACT_NAME = "NDATemplate";
    string public constant CONTRACT_VERSION = "1";

    address public immutable partyA;
    address public immutable partyB;
    address public immutable admin;

    mapping(address => bool) public isParty;
    mapping(address => bool) public signedBy;
    address[] private _parties;

    uint256 public immutable expiryDate;
    uint16 public immutable penaltyBps;
    bytes32 public immutable customClausesHash;

    bool public active = true;

    mapping(address => uint256) public deposits;
    // Pull-payment ledger: credit recipients here and let them withdraw to avoid stuck transfers
    mapping(address => uint256) public withdrawable;
    uint256 public immutable minDeposit;

    address public immutable arbitrationService;
    // Anti-spam & dispute economics
    uint256 public disputeFee; // fee required to file a dispute (wei)
    uint256 public minReportInterval; // min seconds between reports from same reporter
    uint256 public maxOpenReportsPerReporter; // cap open reports per reporter

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
    event EvidenceRevealed(uint256 indexed caseId, string uri);
    // debug removed

    struct BreachCase {
        address reporter;
        address offender;
        uint256 requestedPenalty;
        bytes32 evidenceHash;
        bool resolved;
        bool approved;
    }

    struct CaseMeta {
        string classification;
        string rationale; // NOTE: demonstration only; in production consider hashing to save gas.
    }

    BreachCase[] private _cases;
    mapping(uint256 => CaseMeta) private _caseMeta; // caseId => meta
    mapping(uint256 => string) private _evidenceURI; // optional revealed evidence storage (URI or CID)
    mapping(uint256 => uint256) private _caseFee; // fee attached to caseId
    mapping(uint256 => uint256) private _revealDeadline; // timestamp until which reveal allowed
    mapping(uint256 => uint256) private _resolvedAt; // timestamp when case was resolved
    struct PendingEnforcement {
        uint256 appliedPenalty;
        address beneficiary;
        uint256 fee;
        address feeRecipient;
        bool exists;
    }
    mapping(uint256 => PendingEnforcement) private _pendingEnforcement;
    mapping(address => uint256) public lastReportAt;
    mapping(address => uint256) public openReportsCount;
    mapping(address => uint256) public offenderBreachCount; // cumulative approved breaches per offender
    uint256 public revealWindowSeconds; // default 0 = no reveal deadline enforced
    uint256 public appealWindowSeconds; // default 0 = no appeal window enforced

    constructor(
        address _partyA,
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        uint256 _minDeposit,
        address _admin,
        address _arbitrationService
    ) EIP712(CONTRACT_NAME, CONTRACT_VERSION) {
        require(_admin != address(0), "admin=0");
        require(_partyA != address(0) && _partyB != address(0), "Invalid parties");
        require(_expiryDate > block.timestamp, "Expiry must be in future");
        require(_penaltyBps <= 10_000, "penaltyBps > 100%");

        partyA = _partyA;
        partyB = _partyB;
        admin = _admin;

        expiryDate = _expiryDate;
        penaltyBps = _penaltyBps;
        customClausesHash = _customClausesHash;
    minDeposit = _minDeposit;
    arbitrationService = _arbitrationService;
    // Real runtime resolution should prefer `arbitrationService` (see serviceResolve/serviceEnforce).

    // default anti-spam params
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

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
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

    function addParty(address newParty) external onlyAdmin onlyActive {
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

    function isFullySigned() public view returns (bool) {
        for (uint256 i = 0; i < _parties.length; ) {
            if (!signedBy[_parties[i]]) return false;
            unchecked { ++i; }
        }
        return true;
    }

    function deposit() external payable onlyParty onlyActive {
        require(msg.value > 0, "No value");
        deposits[msg.sender] += msg.value;
        emit DepositMade(msg.sender, msg.value);
    }

    function canWithdraw() public view returns (bool) {
        if (active) {
            return false;
        }

        for (uint256 i = 0; i < _cases.length; ) {
            if (!_cases[i].resolved) {
                return false;
            }
            unchecked { ++i; }
        }

        return true;
}

    function withdrawDeposit(uint256 amount) external nonReentrant {
        require(canWithdraw(), "Cannot withdraw yet");
        require(deposits[msg.sender] >= amount && amount > 0, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        // credit withdrawable ledger and let the party pull the funds
        withdrawable[msg.sender] += amount;
        emit DepositWithdrawn(msg.sender, amount);
    }

    /// @notice Withdraw any pending pull-payments credited to caller
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
        bytes32 evidenceHash
    ) external payable onlyParty onlyActive returns (uint256 caseId) {
        require(isParty[offender], "Offender not a party");
        require(offender != msg.sender, "Cannot accuse self");
        require(requestedPenalty > 0, "Requested penalty must be > 0");
        require(deposits[offender] >= minDeposit, "Offender has no minimum deposit");
        // Anti-spam: fee and per-reporter interval
        if (disputeFee > 0) {
            require(msg.value >= disputeFee, "Insufficient dispute fee");
        }
        if (minReportInterval > 0) {
            require(block.timestamp - lastReportAt[msg.sender] >= minReportInterval, "Reporting too frequently");
        }
        require(openReportsCount[msg.sender] < maxOpenReportsPerReporter, "Too many open reports");

        caseId = _cases.length;
        _cases.push();
        BreachCase storage bc = _cases[caseId];
        bc.reporter = msg.sender;
        bc.offender = offender;
        bc.requestedPenalty = requestedPenalty;
        bc.evidenceHash = evidenceHash;
        // record fee and reporter bookkeeping
        if (disputeFee > 0) {
            _caseFee[caseId] = msg.value;
        }
        lastReportAt[msg.sender] = block.timestamp;
        openReportsCount[msg.sender] += 1;

        // set a reveal deadline for this case if configured
        if (revealWindowSeconds > 0) {
            _revealDeadline[caseId] = block.timestamp + revealWindowSeconds;
        } else {
            _revealDeadline[caseId] = 0;
        }

        emit BreachReported(caseId, msg.sender, offender, requestedPenalty, evidenceHash);
    }

    function getCasesCount() external view returns (uint256) {
        return _cases.length;
    }

    function getCase(uint256 caseId) external view returns (
        address reporter,
        address offender,
        uint256 requestedPenalty,
        bytes32 evidenceHash,
        bool resolved,
        bool approved,
    uint256 approveVotes,
    uint256 rejectVotes
    ) {
        require(caseId < _cases.length, "Invalid case ID");
        BreachCase storage bc = _cases[caseId];
    // approveVotes and rejectVotes are deprecated (voting removed); return zeros for compatibility
    return (bc.reporter, bc.offender, bc.requestedPenalty, bc.evidenceHash, bc.resolved, bc.approved, 0, 0);
    }

    // Voting removed for two-party NDAs. Disputes must be resolved by an arbitrator or external oracle.

    /// @notice Minimal service-only entrypoint for external arbitration service to resolve a breach.
    function serviceResolve(uint256 caseId, bool approve, uint256 appliedPenalty, address beneficiary) external onlyActive nonReentrant {
        require(arbitrationService != address(0), "No arbitration service");
        require(msg.sender == arbitrationService, "Only arbitration service");
        require(caseId < _cases.length, "Invalid case ID");
        require(beneficiary != address(0), "Invalid beneficiary");

        BreachCase storage bc = _cases[caseId];
        require(!bc.resolved, "Case resolved");

        // Delegate to the internal resolution flow which respects appeal windows
        // and handles fee bookkeeping consistently.
        _applyResolution(caseId, approve, appliedPenalty, beneficiary);
    }

    // Compatibility shim `resolveByArbitrator` removed. Use `serviceResolve` via a configured `arbitrationService`.

    // Note: arbitrationService is immutable and set at construction by the factory/deployer.

    /// @notice Minimal service-only enforcement entrypoint to transfer penalty without additional checks.
    function serviceEnforce(address guiltyParty, uint256 penaltyAmount, address beneficiary) external nonReentrant {
        require(arbitrationService != address(0), "No arbitration service");
        require(msg.sender == arbitrationService, "Only arbitration service");
        require(penaltyAmount <= deposits[guiltyParty], "Insufficient deposit");
        require(penaltyAmount > 0, "Penalty must be > 0");
        require(beneficiary != address(0), "Invalid beneficiary");

        deposits[guiltyParty] -= penaltyAmount;
        withdrawable[beneficiary] += penaltyAmount;
        emit PenaltyEnforced(guiltyParty, penaltyAmount, beneficiary);
    }

    /// @notice Reveal evidence URI (e.g., IPFS CID) after committing evidenceHash on report
    function revealEvidence(uint256 caseId, string calldata uri) external onlyParty onlyActive {
        require(caseId < _cases.length, "Invalid case ID");
        BreachCase storage bc = _cases[caseId];
        require(msg.sender == bc.reporter || msg.sender == bc.offender, "Not a party to case");

    // enforce reveal window if configured
        if (revealWindowSeconds > 0) {
            require(_revealDeadline[caseId] != 0, "No reveal window set");
            require(block.timestamp <= _revealDeadline[caseId], "Reveal window closed");
        }

        // verify the revealed URI matches the committed evidence hash
        bytes32 computed = keccak256(bytes(uri));
        require(computed == bc.evidenceHash, "Evidence hash mismatch");

    // prevent double-reveal
    require(bytes(_evidenceURI[caseId]).length == 0, "Already revealed");
    _evidenceURI[caseId] = uri;
        emit EvidenceRevealed(caseId, uri);
    }

    function getCaseMeta(uint256 caseId) external view returns (string memory classification, string memory rationale) {
        require(caseId < _cases.length, "Invalid case ID");
        CaseMeta storage m = _caseMeta[caseId];
        return (m.classification, m.rationale);
    }

    function getEvidenceURI(uint256 caseId) external view returns (string memory) {
        require(caseId < _cases.length, "Invalid case ID");
        return _evidenceURI[caseId];
    }

    function getOffenderBreachCount(address offender) external view returns (uint256) {
        return offenderBreachCount[offender];
    }

    // Admin functions to tune anti-spam parameters
    function setDisputeFee(uint256 fee) external onlyAdmin {
        disputeFee = fee;
    }

    function setRevealWindowSeconds(uint256 secondsWindow) external onlyAdmin {
        revealWindowSeconds = secondsWindow;
    }

    function setAppealWindowSeconds(uint256 secondsWindow) external onlyAdmin {
        appealWindowSeconds = secondsWindow;
    }

    function getRevealDeadline(uint256 caseId) external view returns (uint256) {
        require(caseId < _cases.length, "Invalid case ID");
        return _revealDeadline[caseId];
    }

    function getResolvedAt(uint256 caseId) external view returns (uint256) {
        require(caseId < _cases.length, "Invalid case ID");
        return _resolvedAt[caseId];
    }

    function setMinReportInterval(uint256 secondsInterval) external onlyAdmin {
        minReportInterval = secondsInterval;
    }

    function setMaxOpenReportsPerReporter(uint256 maxOpen) external onlyAdmin {
        maxOpenReportsPerReporter = maxOpen;
    }

    // enforcePenalty removed — enforcement must go through the configured `arbitrationService` via `serviceEnforce`

    /// @notice Finalize any deferred enforcement after appeal window
    function finalizeEnforcement(uint256 caseId) external onlyActive nonReentrant {
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
            // credit beneficiary for pull-based withdrawal
            withdrawable[pe.beneficiary] += pe.appliedPenalty;
            emit PenaltyEnforced(bc.offender, pe.appliedPenalty, pe.beneficiary);
            offenderBreachCount[bc.offender] += 1;
        }

        if (pe.fee > 0 && pe.feeRecipient != address(0)) {
            // credit feeRecipient for pull-based withdrawal
            withdrawable[pe.feeRecipient] += pe.fee;
        }

        delete _pendingEnforcement[caseId];
    }

    function getPendingEnforcement(uint256 caseId) external view returns (uint256 appliedPenalty, address beneficiary, uint256 fee, address feeRecipient, bool exists) {
        PendingEnforcement storage pe = _pendingEnforcement[caseId];
        return (pe.appliedPenalty, pe.beneficiary, pe.fee, pe.feeRecipient, pe.exists);
    }

    function _applyResolution(uint256 caseId, bool approve, uint256 appliedPenalty, address beneficiary) internal {
        BreachCase storage bc = _cases[caseId];
        bc.resolved = true;
        bc.approved = approve;

        // record resolved timestamp for appeal window
        _resolvedAt[caseId] = block.timestamp;

        uint256 applied = 0;
        if (approve) {
            // Use the provided appliedPenalty (arbitrator may award different amount)
            applied = appliedPenalty > 0 ? appliedPenalty : bc.requestedPenalty;
            if (applied > deposits[bc.offender]) {
                applied = deposits[bc.offender];
            }
            if (applied > 0) {
                if (appealWindowSeconds > 0) {
                    // defer enforcement until appeal window elapses
                    _pendingEnforcement[caseId] = PendingEnforcement({ appliedPenalty: applied, beneficiary: beneficiary, fee: 0, feeRecipient: address(0), exists: true });
                } else {
                    deposits[bc.offender] -= applied;
                    // credit beneficiary for pull-based withdrawal
                    withdrawable[beneficiary] += applied;
                }
            }
        }

        // bookkeeping: decrement open reports and settle dispute fee
        openReportsCount[bc.reporter] = openReportsCount[bc.reporter] > 0 ? openReportsCount[bc.reporter] - 1 : 0;
        if (_caseFee[caseId] > 0) {
            uint256 f = _caseFee[caseId];
            _caseFee[caseId] = 0;
            if (approve) {
                if (appealWindowSeconds > 0) {
                    // associate fee refund with pending enforcement so it is sent along
                    if (_pendingEnforcement[caseId].exists) {
                        _pendingEnforcement[caseId].fee = f;
                        _pendingEnforcement[caseId].feeRecipient = bc.reporter;
                    } else {
                        // no pending enforcement, credit reporter immediately
                        withdrawable[bc.reporter] += f;
                    }
                } else {
                    withdrawable[bc.reporter] += f;
                }
            } else {
                if (appealWindowSeconds > 0) {
                    if (_pendingEnforcement[caseId].exists) {
                        _pendingEnforcement[caseId].fee = f;
                        _pendingEnforcement[caseId].feeRecipient = beneficiary;
                    } else {
                        withdrawable[beneficiary] += f;
                    }
                } else {
                    withdrawable[beneficiary] += f;
                }
            }
        }
        if (approve) offenderBreachCount[bc.offender] += 1;

        emit BreachResolved(caseId, approve, applied, bc.offender, beneficiary);
    }

    function deactivate(string calldata reason) external {
        bool isAdmin = msg.sender == admin;
        bool isExpired = block.timestamp >= expiryDate;

        require(isAdmin || isExpired, "Not authorized");
        require(active, "Already inactive");
        
        active = false;
        emit ContractDeactivated(msg.sender, reason);
    }

    function getContractStatus() external view returns (
        bool isActive,
        bool fullySigned,
        uint256 totalDeposits,
        uint256 activeCases
    ) {
        uint256 totalDepositsValue;
        uint256 partiesLen = _parties.length;
        for (uint256 i = 0; i < partiesLen; ) {
            totalDepositsValue += deposits[_parties[i]];
            unchecked { ++i; }
        }

        uint256 unresolvedCases;
        uint256 casesLen = _cases.length;
        for (uint256 j = 0; j < casesLen; ) {
            if (!_cases[j].resolved) {
                unresolvedCases++;
            }
            unchecked { ++j; }
        }

        return (
            active,
            isFullySigned(),
            totalDepositsValue,
            unresolvedCases
        );
    }
}