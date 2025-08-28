// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title NDATemplatePro
 * @notice NDA מרובה-צדדים עם חתימות EIP712, תנאים דינמיים, בורר/הצבעה, ופקדונות לקנסות.
 * @dev customClauses נשמרים כ-hash (bytes32) כדי "לקשור" קריפטוגרפית את הטקסט לחתימות.
 */
contract NDATemplate is EIP712 {
    using ECDSA for bytes32;

    // ====== הגדרות בסיס ======
    string public constant CONTRACT_NAME = "NDATemplate";
    string public constant CONTRACT_VERSION = "1";

    // צדדים
    address public immutable partyA;
    address public immutable partyB;

    // מנהל (יכול להוסיף צדדים חדשים). בדיפולט: המפרסם (deployer)
    address public immutable admin;

    // מפה לבדיקת חברות + מצב חתימה
    mapping(address => bool) public isParty;
    mapping(address => bool) public signedBy;
    address[] private _parties;

    // שדות דינמיים "אכיפים"
    uint256 public immutable expiryDate;        // timestamp
    uint16  public immutable penaltyBps;        // קנס בסיסי בבסיס נקודות (10000 = 100%)
    bytes32 public immutable customClausesHash; // keccak256 של טקסט הסעיפים

    // מצב
    bool public active = true;

    // פקדונות לכל צד (מקור לקנסות)
    mapping(address => uint256) public deposits;
    uint256 public immutable minDeposit; // מינימום פקדון לכל צד (לא חובה, אבל שימושי לדמו)

    // בורר (אופציונלי). אם 0x0 — הכרעה ע"י הצבעת רוב הצדדים שאינם המואשמים.
    address public immutable arbitrator;

    // ====== EIP712 ======
    // כלול את כל השדות "האכיפים" ב-typehash:
    // contractAddress, expiryDate, penaltyBps, customClausesHash
    bytes32 private constant NDA_TYPEHASH =
        keccak256("NDA(address contractAddress,uint256 expiryDate,uint16 penaltyBps,bytes32 customClausesHash)");

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

    // ====== אירועים ======
    event NDASigned(address indexed signer, uint256 timestamp);
    event PartyAdded(address indexed party);
    event DepositMade(address indexed party, uint256 amount);
    event DepositWithdrawn(address indexed party, uint256 amount);
    event BreachReported(uint256 indexed caseId, address indexed reporter, address indexed offender, uint256 requestedPenalty, bytes32 evidenceHash);
    event BreachVoted(uint256 indexed caseId, address indexed voter, bool approve);
    event BreachResolved(uint256 indexed caseId, bool approved, uint256 appliedPenalty, address offender, address beneficiary);
    event ContractDeactivated(address indexed by, string reason);

    // ====== תיקים/הפרות ======
    struct BreachCase {
        address reporter;
        address offender;
        uint256 requestedPenalty; // בקשת קנס ב-wei
        bytes32 evidenceHash;     // hash לאסמכתאות חיצוניות (IPFS וכו')
        bool resolved;
        bool approved;            // החלטה סופית
        uint256 approveVotes;
        uint256 rejectVotes;
        mapping(address => bool) voted;
    }

    BreachCase[] private _cases;

    // ====== בנאי ======
    constructor(
        address _partyA,
        address _partyB,
        uint256 _expiryDate,
        uint16  _penaltyBps,
        bytes32 _customClausesHash,
        address _arbitrator,   // יכול להיות address(0) אם אין בורר
        uint256 _minDeposit
    ) EIP712(CONTRACT_NAME, CONTRACT_VERSION) {
        require(_partyA != address(0) && _partyB != address(0), "Invalid parties");
        require(_expiryDate > block.timestamp, "Expiry must be in future");
        require(_penaltyBps <= 10_000, "penaltyBps > 100%");
        partyA = _partyA;
        partyB = _partyB;
        admin  = msg.sender;

        expiryDate       = _expiryDate;
        penaltyBps       = _penaltyBps;
        customClausesHash = _customClausesHash;
        arbitrator       = _arbitrator;
        minDeposit       = _minDeposit;

        // רושמים צדדים
        isParty[_partyA] = true;
        isParty[_partyB] = true;
        _parties.push(_partyA);
        _parties.push(_partyB);
    }

    // ====== modifier-ים ======
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

    // ====== ניהול צדדים ======
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

    // ====== חתימות EIP712 ======
    /**
     * @notice כל צד יכול להיחתם ע"י שליחת חתימה תקפה (לא חייב להיות ה-sender).
     *         מי שקורא לפונקציה יכול להיות כל אחד; אנו משחזרים את ה-signer מהחתימה.
     */
    function signNDA(bytes calldata signature) external onlyActive {
        address signer = ECDSA.recover(_messageHash(), signature);
        require(isParty[signer], "Invalid signer (not a party)");
        require(!signedBy[signer], "Already signed");
        signedBy[signer] = true;
        emit NDASigned(signer, block.timestamp);
    }

    function isFullySigned() public view returns (bool) {
        for (uint256 i = 0; i < _parties.length; i++) {
            if (!signedBy[_parties[i]]) return false;
        }
        return true;
    }

    // ====== פקדונות ======
    function deposit() external payable onlyParty onlyActive {
        require(msg.value > 0, "No value");
        deposits[msg.sender] += msg.value;
        emit DepositMade(msg.sender, msg.value);
    }

    function canWithdraw() public view returns (bool) {
        if (active) return false;
        // אין תיקים פתוחים שלא נפתרו
        for (uint256 i = 0; i < _cases.length; i++) {
            if (!_cases[i].resolved) return false;
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

    // ====== דיווח/הכרעה בהפרות ======
    /**
     * @param offender      מי שהפר לכאורה
     * @param requestedPenalty  קנס מבוקש ב-wei (ייגבה מהפקדון של המפר אם יאושר)
     * @param evidenceHash  hash של הוכחות חיצוניות (IPFS וכו')
     */
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
        // resolved=false by default

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
    ){
        BreachCase storage bc = _cases[caseId];
        return (bc.reporter, bc.offender, bc.requestedPenalty, bc.evidenceHash, bc.resolved, bc.approved, bc.approveVotes, bc.rejectVotes);
    }

    /**
     * @notice הצבעה של צדדים (ללא המואשם) כאשר אין בורר.
     *         אם יש בורר, רק הוא יכול להכריע (ראו resolveByArbitrator).
     */
    function voteOnBreach(uint256 caseId, bool approve) external onlyParty onlyActive {
        require(arbitrator == address(0), "Arbitrator set; voting disabled");
        BreachCase storage bc = _cases[caseId];
        require(!bc.resolved, "Case resolved");
        require(msg.sender != bc.offender, "Offender cannot vote");
        require(!bc.voted[msg.sender], "Already voted");
        bc.voted[msg.sender] = true;

        if (approve) bc.approveVotes += 1;
        else bc.rejectVotes += 1;

        emit BreachVoted(caseId, msg.sender, approve);

        // הכרעת רוב פשוטת: יותר אישורים מאשר דחיות, ובפועל לפחות מצביע אחד
        uint256 voters = _parties.length - 1; // בלי המואשם
        // אפשר גם להגדיר סף ספציפי (למשל majority of all eligible voters)
        if (bc.approveVotes > voters / 2) {
            _applyResolution(caseId, true);
        } else if (bc.rejectVotes > voters / 2) {
            _applyResolution(caseId, false);
        }
    }

    /**
     * @notice הכרעת בורר (אם הוגדר).
     */
    function resolveByArbitrator(uint256 caseId, bool approve) external onlyActive {
        require(arbitrator != address(0), "No arbitrator");
        require(msg.sender == arbitrator, "Only arbitrator");
        BreachCase storage bc = _cases[caseId];
        require(!bc.resolved, "Case resolved");
        _applyResolution(caseId, approve);
    }

    function _applyResolution(uint256 caseId, bool approve) internal {
        BreachCase storage bc = _cases[caseId];
        bc.resolved = true;
        bc.approved = approve;

        uint256 applied = 0;
        if (approve) {
            // נגבה קנס מהפקדון של המפר, עד גובה היתרה הקיימת
            applied = bc.requestedPenalty;
            if (applied > deposits[bc.offender]) {
                applied = deposits[bc.offender];
            }
            if (applied > 0) {
                deposits[bc.offender] -= applied;
                // העברה לנפגע (המדווח). אפשר להחליף למוטב אחר/Pool לפי צורך
                (bool ok, ) = payable(bc.reporter).call{value: applied}("");
                require(ok, "Payout failed");
            }
        }

        emit BreachResolved(caseId, approve, applied, bc.offender, bc.reporter);
    }

    // ====== סיום/ביטול ======
    function deactivate(string calldata reason) external {
        require(msg.sender == admin || msg.sender == arbitrator || block.timestamp >= expiryDate, "Not authorized");
        require(active, "Already inactive");
        active = false;
        emit ContractDeactivated(msg.sender, reason);
    }
}
