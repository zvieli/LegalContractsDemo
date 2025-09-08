// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// factory enforcement removed (size optimization) - use off-chain policy & deployer pattern
contract NDATemplate is EIP712 {
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
    uint256 public immutable minDeposit;

    address public immutable arbitrator;

    bytes32 private constant NDA_TYPEHASH =
        keccak256("NDA(address contractAddress,uint256 expiryDate,uint16 penaltyBps,bytes32 customClausesHash)");

    event NDASigned(address indexed signer, uint256 timestamp);
    event PartyAdded(address indexed party);
    event DepositMade(address indexed party, uint256 amount);
    event DepositWithdrawn(address indexed party, uint256 amount);
    event BreachReported(uint256 indexed caseId, address indexed reporter, address indexed offender, uint256 requestedPenalty, bytes32 evidenceHash);
    event BreachVoted(uint256 indexed caseId, address indexed voter, bool approve);
    event BreachResolved(uint256 indexed caseId, bool approved, uint256 appliedPenalty, address offender, address beneficiary);
    event ContractDeactivated(address indexed by, string reason);
    event PenaltyEnforced(address indexed offender, uint256 penaltyAmount, address beneficiary);
    event BreachRationale(uint256 indexed caseId, string classification, string rationale);
    // debug removed

    struct BreachCase {
        address reporter;
        address offender;
        uint256 requestedPenalty;
        bytes32 evidenceHash;
        bool resolved;
        bool approved;
        uint256 approveVotes;
        uint256 rejectVotes;
        mapping(address => bool) voted;
    }

    struct CaseMeta {
        string classification;
        string rationale; // NOTE: demonstration only; in production consider hashing to save gas.
    }

    BreachCase[] private _cases;
    mapping(uint256 => CaseMeta) private _caseMeta; // caseId => meta

    constructor(
        address _partyA,
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        address _arbitrator,
        uint256 _minDeposit,
        address _admin
    ) EIP712(CONTRACT_NAME, CONTRACT_VERSION) {
        require(_admin != address(0), "admin=0");
        require(_partyA != address(0) && _partyB != address(0), "Invalid parties");
        require(_expiryDate > block.timestamp, "Expiry must be in future");
        require(_penaltyBps <= 10_000, "penaltyBps > 100%");
        
        if (_arbitrator != address(0)) {
            require(_arbitrator.code.length > 0, "Arbitrator must be a contract");
        }

        partyA = _partyA;
        partyB = _partyB;
    admin = _admin;

        expiryDate = _expiryDate;
        penaltyBps = _penaltyBps;
        customClausesHash = _customClausesHash;
        arbitrator = _arbitrator;
        minDeposit = _minDeposit;

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

    function withdrawDeposit(uint256 amount) external {
        require(canWithdraw(), "Cannot withdraw yet");
        require(deposits[msg.sender] >= amount && amount > 0, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Transfer failed");
        emit DepositWithdrawn(msg.sender, amount);
    }

    function reportBreach(
        address offender,
        uint256 requestedPenalty,
        bytes32 evidenceHash
    ) external onlyParty onlyActive returns (uint256 caseId) {
        require(isParty[offender], "Offender not a party");
        require(offender != msg.sender, "Cannot accuse self");
        require(requestedPenalty > 0, "Requested penalty must be > 0");
        require(deposits[offender] >= minDeposit, "Offender has no minimum deposit");

        caseId = _cases.length;
        _cases.push();
        BreachCase storage bc = _cases[caseId];
        bc.reporter = msg.sender;
        bc.offender = offender;
        bc.requestedPenalty = requestedPenalty;
        bc.evidenceHash = evidenceHash;

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
        return (bc.reporter, bc.offender, bc.requestedPenalty, bc.evidenceHash, bc.resolved, bc.approved, bc.approveVotes, bc.rejectVotes);
    }

    function voteOnBreach(uint256 caseId, bool approve) external onlyParty onlyActive {
        require(arbitrator == address(0), "Arbitrator set; voting disabled");
        require(caseId < _cases.length, "Invalid case ID");
        
        BreachCase storage bc = _cases[caseId];
        require(!bc.resolved, "Case resolved");
        require(msg.sender != bc.offender, "Offender cannot vote");
        require(!bc.voted[msg.sender], "Already voted");
        
        bc.voted[msg.sender] = true;

        if (approve) {
            bc.approveVotes += 1;
        } else {
            bc.rejectVotes += 1;
        }

        emit BreachVoted(caseId, msg.sender, approve);

        uint256 voters = _parties.length - 1;
        if (bc.approveVotes > voters / 2) {
            _applyResolution(caseId, true, bc.reporter);
        } else if (bc.rejectVotes > voters / 2) {
            _applyResolution(caseId, false, bc.reporter);
        }
    }

    function resolveByArbitrator(uint256 caseId, bool approve, address beneficiary) external onlyActive {
    require(arbitrator != address(0), "No arbitrator");
    require(msg.sender == arbitrator, "Only arbitrator");
    require(arbitrator.code.length > 0, "Arbitrator must be a contract");
        require(caseId < _cases.length, "Invalid case ID");
        require(beneficiary != address(0), "Invalid beneficiary");
        
        BreachCase storage bc = _cases[caseId];
        require(!bc.resolved, "Case resolved");
        
        _applyResolution(caseId, approve, beneficiary);
    }

    /// @notice Final resolution specifying an applied penalty directly (used by oracle path to avoid double deduction)
    function resolveByArbitratorFinal(uint256 caseId, bool approve, uint256 appliedPenalty, address beneficiary, string calldata classification, string calldata rationale) external onlyActive {
        require(arbitrator != address(0), "No arbitrator");
        require(msg.sender == arbitrator, "Only arbitrator");
        require(arbitrator.code.length > 0, "Arbitrator must be a contract");
        require(caseId < _cases.length, "Invalid case ID");
        require(beneficiary != address(0), "Invalid beneficiary");
        require(bytes(classification).length <= 64, "classification too long");
        require(bytes(rationale).length <= 512, "rationale too long");

        BreachCase storage bc = _cases[caseId];
        require(!bc.resolved, "Case resolved");

        bc.resolved = true;
        bc.approved = approve;
        uint256 applied = 0;
        if (approve && appliedPenalty > 0) {
            if (appliedPenalty > deposits[bc.offender]) {
                appliedPenalty = deposits[bc.offender];
            }
            if (appliedPenalty > 0) {
                deposits[bc.offender] -= appliedPenalty;
                (bool ok, ) = payable(beneficiary).call{value: appliedPenalty}("");
                require(ok, "Payout failed");
                applied = appliedPenalty;
            }
        }
        _caseMeta[caseId] = CaseMeta({ classification: classification, rationale: rationale });
        emit BreachResolved(caseId, approve, applied, bc.offender, beneficiary);
        emit BreachRationale(caseId, classification, rationale);
    }

    function getCaseMeta(uint256 caseId) external view returns (string memory classification, string memory rationale) {
        require(caseId < _cases.length, "Invalid case ID");
        CaseMeta storage m = _caseMeta[caseId];
        return (m.classification, m.rationale);
    }

    function enforcePenalty(address guiltyParty, uint256 penaltyAmount, address beneficiary) external {
    require(msg.sender == arbitrator, "Only arbitrator");
        require(arbitrator != address(0), "No arbitrator");
        require(penaltyAmount <= deposits[guiltyParty], "Insufficient deposit");
        require(penaltyAmount > 0, "Penalty must be > 0");
        require(beneficiary != address(0), "Invalid beneficiary");
        
        deposits[guiltyParty] -= penaltyAmount;
        
        (bool success, ) = payable(beneficiary).call{value: penaltyAmount}("");
        require(success, "Penalty transfer failed");
        
        emit PenaltyEnforced(guiltyParty, penaltyAmount, beneficiary);
    }

    function _applyResolution(uint256 caseId, bool approve, address beneficiary) internal {
        BreachCase storage bc = _cases[caseId];
        bc.resolved = true;
        bc.approved = approve;

        uint256 applied = 0;
        if (approve) {
            applied = bc.requestedPenalty;
            if (applied > deposits[bc.offender]) {
                applied = deposits[bc.offender];
            }
            if (applied > 0) {
                deposits[bc.offender] -= applied;
                (bool ok, ) = payable(beneficiary).call{value: applied}("");
                require(ok, "Payout failed");
            }
        }

        emit BreachResolved(caseId, approve, applied, bc.offender, beneficiary);
    }

    function deactivate(string calldata reason) external {
        bool isArbitrator = arbitrator != address(0) && msg.sender == arbitrator;
        bool isAdmin = msg.sender == admin;
        bool isExpired = block.timestamp >= expiryDate;
        
        require(isArbitrator || isAdmin || isExpired, "Not authorized");
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