// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
// factory enforcement removed (size optimization) - relying on factory pattern off-chain

/// @title TemplateRentContract with EIP712 dual-party signature (similar to NDATemplate)
/// @notice Adds structured data signing so BOTH landlord & tenant can sign immutable core terms.
contract TemplateRentContract is EIP712 {
    address public immutable landlord;
    address public immutable tenant;
    uint256 public immutable propertyId; // 0 if not linked
    uint256 public rentAmount;
    bool public rentPaid;
    uint256 public totalPaid;
    bool public active;

AggregatorV3Interface public immutable priceFeed;
    using SafeERC20 for IERC20;

    uint256 public dueDate;
    uint8 public lateFeePercent = 5;

    mapping(address => uint256) public tokenPaid; 

    // Signing state (EIP712)
    mapping(address => bool) public signedBy; // landlord/tenant => signed?
    bool public rentSigned; // true once BOTH have signed (backwards compatibility flag)

    string public constant CONTRACT_NAME = "TemplateRentContract";
    string public constant CONTRACT_VERSION = "1";

    // Typed data hash for core immutable terms (dueDate may still be mutable until fully signed)
    bytes32 private constant RENT_TYPEHASH = keccak256(
        "RENT(address contractAddress,address landlord,address tenant,uint256 rentAmount,uint256 dueDate)"
    );

    // Cancellation policy and state
    bool public requireMutualCancel;           // if true, both parties must approve
    uint256 public noticePeriod;               // seconds to wait before unilateral finalize
    uint16 public earlyTerminationFeeBps;      // optional fee in bps applied to current rent in ETH

    bool public cancelRequested;               // has a cancellation been initiated
    address public cancelInitiator;            // who initiated the cancellation
    uint256 public cancelEffectiveAt;          // timestamp when finalize is allowed (unilateral)
    mapping(address => bool) public cancelApprovals; // who approved (for mutual or record)

    // ============ Arbitration & Disputes (extension) ============
    address public arbitrator;               // optional arbitrator / oracle aggregator
    bool public arbitrationConfigured;       // one-time configuration gate
    uint256 public requiredDeposit;          // required security deposit amount (in wei) set during configuration
    uint256 public depositBalance;           // tenant security deposit locked in contract

    enum DisputeType { Damage, ConditionStart, ConditionEnd, Quality, EarlyTerminationJustCause, DepositSplit, ExternalValuation }

    struct DisputeCase {
        address initiator;
        DisputeType dtype;
        uint256 requestedAmount;    // claim amount (e.g., damages or amount to release)
        bytes32 evidenceHash;       // off-chain evidence reference (IPFS hash etc.)
        bool resolved;
        bool approved;
        uint256 appliedAmount;      // actual amount applied (deducted or released)
    }

    struct DisputeMeta { // classification & rationale produced by oracle/AI
        string classification;
        string rationale; // demonstration (could hash in production)
    }

    DisputeCase[] private _disputes;
    mapping(uint256 => DisputeMeta) private _disputeMeta; // id => meta

    // events
    event RentPaid(address indexed tenant, uint256 amount, bool late, address token);
    event ContractCancelled(address indexed by);
    event DueDateUpdated(uint256 newTimestamp);
    event LateFeeUpdated(uint256 newPercent);
    event RentSigned(address indexed signer, uint256 timestamp);
    event CancellationPolicyUpdated(uint256 noticePeriod, uint16 feeBps, bool requireMutual);
    event CancellationInitiated(address indexed by, uint256 effectiveAt);
    event CancellationApproved(address indexed by);
    event CancellationFinalized(address indexed by);
    event EarlyTerminationFeePaid(address indexed from, uint256 amount, address indexed to);
    event ArbitrationConfigured(address indexed arbitrator, uint256 requiredDeposit);
    event SecurityDepositPaid(address indexed tenant, uint256 amount, uint256 total);
    event DisputeReported(uint256 indexed caseId, address indexed initiator, uint8 disputeType, uint256 requestedAmount, bytes32 evidenceHash);
    event DisputeResolved(uint256 indexed caseId, bool approved, uint256 appliedAmount, address beneficiary);
    event DisputeRationale(uint256 indexed caseId, string classification, string rationale);

    constructor(
        address _landlord,
        address _tenant,
        uint256 _rentAmount,
        address _priceFeed,
        uint256 _propertyId
    ) EIP712(CONTRACT_NAME, CONTRACT_VERSION) {
        landlord = _landlord;
        tenant = _tenant;
        propertyId = _propertyId;
        rentAmount = _rentAmount;
        rentPaid = false;
        totalPaid = 0;
        active = true;
        priceFeed = AggregatorV3Interface(_priceFeed);
    // default policy: legacy immediate cancellation by either party
    requireMutualCancel = false;
    noticePeriod = 0;
    earlyTerminationFeeBps = 0;
    }

    // Modifiers
    // Custom errors
    error OnlyTenant();
    error OnlyLandlord();
    error NotActive();
    error AmountTooLow();
    error InvalidPrice();
    error AlreadySigned();
    error SignatureMismatch();
    error NotParty();
    error FullySignedDueDateLocked();
    error CancelAlreadyRequested();
    error CancelNotRequested();
    error NotInitiator();
    error AlreadyApproved();
    error BothMustApprove();
    error NoticeNotElapsed();
    error InsufficientFee();
    error AlreadyInactive();
    error InvalidFeeBps();
    error FeeTransferFailed();
    error NotFullySigned();
    error ArbitrationAlreadyConfigured();
    error ArbitratorInvalid();
    error DepositAlreadySatisfied();
    error DepositTooLow();
    error ArbitrationNotConfigured();
    error DisputeTypeInvalid();
    error DisputeAlreadyResolved();
    error OnlyArbitrator();
    error ClassificationTooLong();
    error RationaleTooLong();

    modifier onlyTenant() {
        if (msg.sender != tenant) revert OnlyTenant();
        _;
    }

    modifier onlyLandlord() {
        if (msg.sender != landlord) revert OnlyLandlord();
        _;
    }

    modifier onlyActive() {
        if (!active) revert NotActive();
        _;
    }

    modifier onlyFullySigned() {
        if (!rentSigned) revert NotFullySigned();
        _;
    }

    function payRent(uint256 amount) external onlyTenant onlyActive onlyFullySigned {
        if (amount < rentAmount) revert AmountTooLow();
        rentPaid = true;
        totalPaid += amount;
        emit RentPaid(msg.sender, amount, false, address(0));
    }

    function checkRentPrice() internal view returns (int256) {
        (,int256 price,,,) = priceFeed.latestRoundData();
        return price;
    }

    // contracts/Rent/TemplateRentContract.sol - תיקון הפונקציה
function getRentInEth() public view returns (uint256) {
    int256 price = checkRentPrice();
    if (price <= 0) revert InvalidPrice();
    
    // Assuming:
    // - rentAmount is in USD (e.g., 0.5 = $0.5)
    // - price is USD/ETH with 8 decimals (e.g., 2000 * 10^8 = $2000 per ETH)
    // - We need to convert rentAmount (USD) to ETH
    
    // Formula: ETH = USD / (USD/ETH)
    return (rentAmount * 1e8) / uint256(price);
}

    function payRentInEth() external payable onlyTenant onlyActive onlyFullySigned {
        uint256 requiredEth = getRentInEth();
    if (msg.value < requiredEth) revert AmountTooLow();
        rentPaid = true;
        totalPaid += msg.value;
        (bool sent, ) = payable(landlord).call{value: msg.value}("");
    require(sent, "transfer fail");
        emit RentPaid(msg.sender, msg.value, false, address(0));
    }

    function payRentWithLateFee() external payable onlyTenant onlyActive onlyFullySigned {
        uint256 requiredEth = getRentInEth();
        bool late = false;

        if (block.timestamp > dueDate && dueDate != 0) {
            uint256 fee = (requiredEth * uint256(lateFeePercent)) / 100;
            requiredEth += fee;
            late = true;
        }

    if (msg.value < requiredEth) revert AmountTooLow();
        totalPaid += msg.value;
        rentPaid = true;
        (bool sent, ) = payable(landlord).call{value: msg.value}("");
    require(sent, "transfer fail");
        emit RentPaid(msg.sender, msg.value, late, address(0));
    }

    function payRentPartial() external payable onlyTenant onlyActive onlyFullySigned {
        bool late = false;
        if (block.timestamp > dueDate && dueDate != 0) late = true;

        totalPaid += msg.value;
        if (totalPaid >= getRentInEth()) rentPaid = true;

    (bool sent, ) = payable(landlord).call{value: msg.value}("");
    require(sent, "transfer fail");
        emit RentPaid(msg.sender, msg.value, late, address(0));
    }

    function payRentWithToken(address tokenAddress, uint256 amount) external onlyTenant onlyActive onlyFullySigned {
    IERC20 token = IERC20(tokenAddress);
    // use SafeERC20 to support non-standard ERC20 tokens
    token.safeTransferFrom(msg.sender, landlord, amount);
        tokenPaid[tokenAddress] += amount;

        bool late = false;
        if (block.timestamp > dueDate && dueDate != 0) late = true;

        emit RentPaid(msg.sender, amount, late, tokenAddress);
    }

    function updateLateFee(uint8 newPercent) external onlyLandlord onlyActive {
        lateFeePercent = newPercent;
        emit LateFeeUpdated(newPercent);
    }

    function setDueDate(uint256 timestamp) external onlyLandlord onlyActive {
        // Once both parties have signed, freeze dueDate (ensures signature remains valid for agreed terms)
    if (rentSigned) revert FullySignedDueDateLocked();
        dueDate = timestamp;
        emit DueDateUpdated(timestamp);
    }

    // contracts/Rent/TemplateRentContract.sol - תיקון ה-cancelContract
function cancelContract() external {
    if (!(msg.sender == landlord || msg.sender == tenant)) revert NotParty();
    if (!active) revert AlreadyInactive();
    // Backward-compat immediate cancellation only when policy allows (no notice, no fee, no mutual)
    if (!requireMutualCancel && noticePeriod == 0 && earlyTerminationFeeBps == 0) {
        active = false;
        emit ContractCancelled(msg.sender);
        return;
    }
    // Otherwise, treat as initiate request if not already requested
    if (!cancelRequested) {
        cancelRequested = true;
        cancelInitiator = msg.sender;
        cancelEffectiveAt = block.timestamp + noticePeriod;
        cancelApprovals[msg.sender] = true;
        emit CancellationInitiated(msg.sender, cancelEffectiveAt);
        // If mutual is not required and no notice, finalize immediately
        if (!requireMutualCancel && noticePeriod == 0) {
            _finalizeCancellationNoFeePath();
        }
        return;
    }
    // If already requested and mutual is required, an opposite-party call acts as approval and finalizes
    if (requireMutualCancel && msg.sender != cancelInitiator && !cancelApprovals[msg.sender]) {
        cancelApprovals[msg.sender] = true;
        emit CancellationApproved(msg.sender);
        _finalizeCancellationNoFeePath();
        return;
    }
}

        /// @notice Hash (EIP712 typed data) for the contract's core terms that are being signed.
        function hashMessage() public view returns (bytes32) {
            return _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        RENT_TYPEHASH,
                        address(this),
                        landlord,
                        tenant,
                        rentAmount,
                        dueDate
                    )
                )
            );
        }

        /// @notice Landlord or tenant can provide an EIP712 signature over core terms. When both sign -> rentSigned = true.
        /// @dev If dueDate changes before both signatures collected, previously gathered signature(s) become invalid off-chain.
        function signRent(bytes calldata signature) external onlyActive {
            if (!(msg.sender == landlord || msg.sender == tenant)) revert NotParty();
            bytes32 digest = hashMessage();
            address recovered = ECDSA.recover(digest, signature);
            if (recovered != msg.sender) revert SignatureMismatch();
            if (signedBy[recovered]) revert AlreadySigned();
            signedBy[recovered] = true;
            emit RentSigned(recovered, block.timestamp);
            if (signedBy[landlord] && signedBy[tenant] && !rentSigned) {
                rentSigned = true; // backward compatibility flag
            }
        }

        function isFullySigned() external view returns (bool) {
            return rentSigned;
        }

    // ============ Cancellation Policy Management ============
    function setCancellationPolicy(uint256 _noticePeriod, uint16 _feeBps, bool _requireMutual)
        external
        onlyLandlord
        onlyActive
    {
    if (_feeBps > 10_000) revert InvalidFeeBps();
        noticePeriod = _noticePeriod;
        earlyTerminationFeeBps = _feeBps;
        requireMutualCancel = _requireMutual;
        emit CancellationPolicyUpdated(_noticePeriod, _feeBps, _requireMutual);
    }

    function initiateCancellation() external onlyActive {
    if (!(msg.sender == landlord || msg.sender == tenant)) revert NotParty();
    if (cancelRequested) revert CancelAlreadyRequested();
        cancelRequested = true;
        cancelInitiator = msg.sender;
        cancelEffectiveAt = block.timestamp + noticePeriod;
        cancelApprovals[msg.sender] = true;
        emit CancellationInitiated(msg.sender, cancelEffectiveAt);
        if (!requireMutualCancel && noticePeriod == 0) {
            _finalizeCancellationNoFeePath();
        }
    }

    function approveCancellation() external onlyActive {
    if (!(msg.sender == landlord || msg.sender == tenant)) revert NotParty();
    if (!cancelRequested) revert CancelNotRequested();
    if (msg.sender == cancelInitiator) revert NotInitiator();
    if (cancelApprovals[msg.sender]) revert AlreadyApproved();
        cancelApprovals[msg.sender] = true;
        emit CancellationApproved(msg.sender);
        if (requireMutualCancel) {
            _finalizeCancellationNoFeePath();
        } else if (noticePeriod == 0) {
            _finalizeCancellationNoFeePath();
        }
    }

    function finalizeCancellation() external payable onlyActive {
        if (!(msg.sender == landlord || msg.sender == tenant)) revert NotParty();
        if (!cancelRequested) revert CancelNotRequested();
        if (requireMutualCancel) {
            if (!(cancelApprovals[landlord] && cancelApprovals[tenant])) revert BothMustApprove();
            _finalizeCancellationNoFeePath();
            return;
        }
        if (block.timestamp < cancelEffectiveAt) revert NoticeNotElapsed();
        // Unilateral path: optional early termination fee
        uint256 fee = 0;
        if (earlyTerminationFeeBps > 0) {
            uint256 requiredEth = getRentInEth();
            fee = (requiredEth * uint256(earlyTerminationFeeBps)) / 10_000;
            if (msg.value < fee) revert InsufficientFee();
            address counterparty = msg.sender == landlord ? tenant : landlord;
            if (fee > 0) {
                (bool sent, ) = payable(counterparty).call{value: fee}("");
                if (!sent) revert FeeTransferFailed();
                emit EarlyTerminationFeePaid(msg.sender, fee, counterparty);
            }
        }
        _finalizeCancellationStateOnly();
    }

    function _finalizeCancellationNoFeePath() internal {
        _finalizeCancellationStateOnly();
    }

    function _finalizeCancellationStateOnly() internal {
    if (!active) revert AlreadyInactive();
        active = false;
        emit ContractCancelled(msg.sender);
        emit CancellationFinalized(msg.sender);
    }

    // ================= Arbitration / Deposit / Disputes =================

    modifier onlyArbitrator() {
        if (msg.sender != arbitrator) revert OnlyArbitrator();
        _;
    }

    function configureArbitration(address _arbitrator, uint256 _requiredDeposit) external onlyLandlord onlyActive {
        if (arbitrationConfigured) revert ArbitrationAlreadyConfigured();
        if (_arbitrator == address(0)) revert ArbitratorInvalid();
        // allow EOAs or contracts (no code.length check for flexibility with upgradeable/oracle addresses)
        arbitrator = _arbitrator;
        requiredDeposit = _requiredDeposit;
        arbitrationConfigured = true;
        emit ArbitrationConfigured(_arbitrator, _requiredDeposit);
    }

    function depositSecurity() external payable onlyTenant onlyActive onlyFullySigned {
        if (!arbitrationConfigured) revert ArbitrationNotConfigured();
        if (depositBalance >= requiredDeposit) revert DepositAlreadySatisfied();
        if (msg.value == 0) revert DepositTooLow();
        depositBalance += msg.value;
        emit SecurityDepositPaid(msg.sender, msg.value, depositBalance);
        if (depositBalance < requiredDeposit) revert DepositTooLow(); // needs at least requiredDeposit overall
    }

    function getDisputesCount() external view returns (uint256) { return _disputes.length; }

    function getDispute(uint256 caseId) external view returns (
        address initiator,
        DisputeType dtype,
        uint256 requestedAmount,
        bytes32 evidenceHash,
        bool resolved,
        bool approved,
        uint256 appliedAmount
    ) {
        require(caseId < _disputes.length, "bad id");
        DisputeCase storage dc = _disputes[caseId];
        return (dc.initiator, dc.dtype, dc.requestedAmount, dc.evidenceHash, dc.resolved, dc.approved, dc.appliedAmount);
    }

    function getDisputeMeta(uint256 caseId) external view returns (string memory classification, string memory rationale) {
        require(caseId < _disputes.length, "bad id");
        DisputeMeta storage m = _disputeMeta[caseId];
        return (m.classification, m.rationale);
    }

    function reportDispute(DisputeType dtype, uint256 requestedAmount, bytes32 evidenceHash) external onlyActive returns (uint256 caseId) {
        if (!arbitrationConfigured) revert ArbitrationNotConfigured();
        if (!(msg.sender == landlord || msg.sender == tenant)) revert NotParty();
        // For damage/quality claims requestedAmount must be >0
        if (requestedAmount == 0 && (dtype == DisputeType.Damage || dtype == DisputeType.Quality || dtype == DisputeType.DepositSplit)) revert AmountTooLow();

        caseId = _disputes.length;
        _disputes.push();
        DisputeCase storage dc = _disputes[caseId];
        dc.initiator = msg.sender;
        dc.dtype = dtype;
        dc.requestedAmount = requestedAmount;
        dc.evidenceHash = evidenceHash;

        emit DisputeReported(caseId, msg.sender, uint8(dtype), requestedAmount, evidenceHash);
    }

    /// @notice Final resolution used by arbitrator/oracle (single-step) similar to NDA oracle path.
    /// @param caseId dispute id
    /// @param approve whether claim approved
    /// @param appliedAmount amount to transfer (capped by depositBalance when deducting)
    /// @param beneficiary receiver of funds (usually landlord for damage; tenant for refund scenarios)
    /// @param classification short label (<=64 chars)
    /// @param rationale explanation (<=512 chars)
    function resolveDisputeFinal(
        uint256 caseId,
        bool approve,
        uint256 appliedAmount,
        address beneficiary,
        string calldata classification,
        string calldata rationale
    ) external onlyArbitrator onlyActive {
        if (caseId >= _disputes.length) revert DisputeTypeInvalid();
        if (beneficiary == address(0)) revert FeeTransferFailed(); // reuse error for zero address
        if (bytes(classification).length > 64) revert ClassificationTooLong();
        if (bytes(rationale).length > 512) revert RationaleTooLong();

        DisputeCase storage dc = _disputes[caseId];
        if (dc.resolved) revert DisputeAlreadyResolved();
        dc.resolved = true;
        dc.approved = approve;

        uint256 applied = 0;
        if (approve && appliedAmount > 0) {
            // For damage / quality / deposit split we deduct from depositBalance to beneficiary (landlord or tenant)
            if (appliedAmount > depositBalance) appliedAmount = depositBalance;
            if (appliedAmount > 0) {
                depositBalance -= appliedAmount;
                (bool ok, ) = payable(beneficiary).call{value: appliedAmount}("");
                if (!ok) revert FeeTransferFailed();
                applied = appliedAmount;
            }
        }
        dc.appliedAmount = applied;
        _disputeMeta[caseId] = DisputeMeta({classification: classification, rationale: rationale});
        emit DisputeResolved(caseId, approve, applied, beneficiary);
        emit DisputeRationale(caseId, classification, rationale);
    }
}
