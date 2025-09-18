// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
// factory enforcement removed (size optimization) - relying on factory pattern off-chain

/// @title TemplateRentContract with EIP712 dual-party signature (similar to NDATemplate)
/// @notice Adds structured data signing so BOTH landlord & tenant can sign immutable core terms.
contract TemplateRentContract is EIP712, ReentrancyGuard {
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
    // Pull-payment ledger: credit recipients here and let them withdraw to avoid stuck transfers
    mapping(address => uint256) public withdrawable;

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
    // arbitration is handled via an external ArbitrationService to keep template bytecode small
    // The arbitration service is provided at contract creation and is immutable.
    address public immutable arbitrationService;       // service proxy that can call arbitration entrypoints
    uint256 public requiredDeposit;          // required security deposit amount (in wei) set at construction
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
    mapping(uint256 => uint256) private _reporterBond; // caseId => wei posted by reporter

    // Allow reporters to attach bond after filing (helper for ABI compatibility/testing)
    function depositReporterBond(uint256 caseId) external payable onlyActive {
        require(caseId < _disputes.length, "bad id");
        require(msg.value > 0, "no value");
        _reporterBond[caseId] += msg.value;
    }

    function getDisputeBond(uint256 caseId) external view returns (uint256) {
        if (caseId >= _disputes.length) return 0;
        return _reporterBond[caseId];
    }
    mapping(uint256 => DisputeMeta) private _disputeMeta; // id => meta

    // events
    event RentPaid(address indexed tenant, uint256 amount, bool late, address token);
    event PaymentCredited(address indexed to, uint256 amount);
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
    event PaymentWithdrawn(address indexed to, uint256 amount);

    constructor(
        address _landlord,
        address _tenant,
        uint256 _rentAmount,
        address _priceFeed,
        uint256 _propertyId,
        address _arbitrationService,
        uint256 _requiredDeposit
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
    // set arbitration immutable and required deposit
    // allow zero address for arbitrationService to indicate not pre-configured
    // but factory will normally supply a default arbitration service address
    // Assign the immutable directly
    // (Solidity allows assigning immutables in the constructor)
    // The variable is named `arbitrationService` in the contract.
    // Cast assignment below
    arbitrationService = _arbitrationService;
    requiredDeposit = _requiredDeposit;
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

    modifier onlyArbitrationService() {
        if (msg.sender != arbitrationService) revert OnlyArbitrator();
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
        if (!sent) {
            // credit for pull-based withdrawal to avoid reverts
            withdrawable[landlord] += msg.value;
            emit PaymentCredited(landlord, msg.value);
        }
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
            if (!sent) {
                withdrawable[landlord] += msg.value;
                emit PaymentCredited(landlord, msg.value);
            }
            emit RentPaid(msg.sender, msg.value, late, address(0));
    }

    function payRentPartial() external payable onlyTenant onlyActive onlyFullySigned {
        bool late = false;
        if (block.timestamp > dueDate && dueDate != 0) late = true;

        totalPaid += msg.value;
        if (totalPaid >= getRentInEth()) rentPaid = true;

    (bool sent, ) = payable(landlord).call{value: msg.value}("");
    if (!sent) {
        withdrawable[landlord] += msg.value;
        emit PaymentCredited(landlord, msg.value);
    }
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

    /// @notice Withdraw any pending pull-payments credited to caller
    function withdrawPayments() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        require(amount > 0, "No funds to withdraw");
        withdrawable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit PaymentWithdrawn(msg.sender, amount);
    }

    // Direct `cancelContract` removed. Use `initiateCancellation` / `approveCancellation` +
    // finalization via the configured `ArbitrationService`.

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
    }

    function approveCancellation() external onlyActive {
        if (!(msg.sender == landlord || msg.sender == tenant)) revert NotParty();
        if (!cancelRequested) revert CancelNotRequested();
        if (msg.sender == cancelInitiator) revert NotInitiator();
        if (cancelApprovals[msg.sender]) revert AlreadyApproved();
        cancelApprovals[msg.sender] = true;
        emit CancellationApproved(msg.sender);
        // If both parties have approved the cancellation, we DO NOT finalize here.
        // Keep the cancellation in a pending state so it is always finalized via
        // the configured ArbitrationService. This ensures the UI/arb path is used
        // and that any required fee forwarding happens through the service.
        // If you prefer immediate mutual-finalize in the future, re-enable the
        // call to `_finalizeCancellationStateOnly()` here.
    }

    /// @notice Finalize cancellation — must be called by the configured arbitration service.
    /// The arbitration service may finalize regardless of notice or mutual settings.
    function finalizeCancellation() external payable onlyActive onlyArbitrationService {
        if (!cancelRequested) revert CancelNotRequested();

        // Handle optional early termination fee — arbitrator provides payment in msg.value if needed
        uint256 fee = 0;
        if (earlyTerminationFeeBps > 0) {
            uint256 requiredEth = getRentInEth();
            fee = (requiredEth * uint256(earlyTerminationFeeBps)) / 10_000;
            if (msg.value < fee) revert InsufficientFee();
            // pay counterparty (the other party than cancelInitiator)
            address counterparty = cancelInitiator == landlord ? tenant : landlord;
            if (fee > 0) {
                (bool sent, ) = payable(counterparty).call{value: fee}("");
                if (!sent) {
                    // credit counterparty for pull-based withdrawal instead of reverting
                    withdrawable[counterparty] += fee;
                    emit PaymentCredited(counterparty, fee);
                }
                // emit EarlyTerminationFeePaid regardless to log the payment intent
                emit EarlyTerminationFeePaid(msg.sender, fee, counterparty);
            }
        }

        // finalize
        _finalizeCancellationStateOnly();
    }

    function _finalizeCancellationNoFeePath() internal {
        _finalizeCancellationStateOnly();
    }

    function _finalizeCancellationStateOnly() internal {
        if (!active) revert AlreadyInactive();
        active = false;
        // clear cancellation state
        cancelRequested = false;
        cancelApprovals[landlord] = false;
        cancelApprovals[tenant] = false;
        address initiator = cancelInitiator;
        cancelInitiator = address(0);
        cancelEffectiveAt = 0;
        emit ContractCancelled(initiator == address(0) ? msg.sender : initiator);
        emit CancellationFinalized(msg.sender);
    }

    // ================= Arbitration / Deposit / Disputes =================

    // removed onlyArbitrator modifier; use arbitrationService checks in entrypoints

    // Arbitration service is immutable and assigned at construction. Setter functions removed.

    function depositSecurity() external payable onlyTenant onlyActive onlyFullySigned {
        // If contract was deployed with a non-zero requiredDeposit, enforce it.
        if (requiredDeposit > 0 && depositBalance >= requiredDeposit) revert DepositAlreadySatisfied();
        if (msg.value == 0) revert DepositTooLow();
        depositBalance += msg.value;
        emit SecurityDepositPaid(msg.sender, msg.value, depositBalance);
        if (requiredDeposit > 0 && depositBalance < requiredDeposit) revert DepositTooLow(); // needs at least requiredDeposit overall
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

    function reportDispute(DisputeType dtype, uint256 requestedAmount, bytes32 evidenceHash) external payable onlyActive returns (uint256 caseId) {
        // Allow reporting disputes even when an external arbitration service is
        // not yet configured. This lets parties record evidence/claims and
        // later enable arbitration via `configureArbitration` without losing
        // previously reported cases.
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
        // Store any attached bond for the reporter (may be zero)
        if (msg.value > 0) {
            _reporterBond[caseId] = msg.value;
        }

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
    ) external onlyActive onlyArbitrationService {
        _resolveDisputeFinal(caseId, approve, appliedAmount, beneficiary, classification, rationale);
    }

    // Internal resolver reused by both the external oracle/arbitrator entrypoint and internal paths.
    function _resolveDisputeFinal(
        uint256 caseId,
        bool approve,
        uint256 appliedAmount,
        address beneficiary,
        string memory classification,
        string memory rationale
    ) internal {
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
                if (!ok) {
                    // credit beneficiary for pull-based withdrawal instead of reverting
                    withdrawable[beneficiary] += appliedAmount;
                    emit PaymentCredited(beneficiary, appliedAmount);
                    applied = appliedAmount;
                } else {
                    applied = appliedAmount;
                }
            }
        }
        dc.appliedAmount = applied;
        // Handle reporter bond routing: refund on approval, forfeit to arbitration owner on rejection
        uint256 bond = _reporterBond[caseId];
        if (bond > 0) {
            // clear stored bond first
            _reporterBond[caseId] = 0;
            if (approve) {
                // Refund bond to reporter (initiator)
                (bool okr, ) = payable(dc.initiator).call{value: bond}("");
                if (!okr) {
                    withdrawable[dc.initiator] += bond;
                    emit PaymentCredited(dc.initiator, bond);
                }
            } else {
                // On rejection, route bond to arbitration service owner if available
                address arbOwner = address(0);
                if (arbitrationService != address(0)) {
                    // try staticcall to read owner() from arbitrationService
                    (bool got, bytes memory out) = arbitrationService.staticcall(abi.encodeWithSignature("owner()"));
                    if (got && out.length >= 32) {
                        arbOwner = abi.decode(out, (address));
                    }
                }
                if (arbOwner != address(0)) {
                    (bool ok, ) = payable(arbOwner).call{value: bond}("");
                    if (!ok) {
                        withdrawable[arbOwner] += bond;
                        emit PaymentCredited(arbOwner, bond);
                    }
                } else {
                    // No arbitration owner configured — credit bond to contract withdrawable (ownerless)
                    withdrawable[address(this)] += bond;
                    emit PaymentCredited(address(this), bond);
                }
            }
        }
        _disputeMeta[caseId] = DisputeMeta({classification: classification, rationale: rationale});
        emit DisputeResolved(caseId, approve, applied, beneficiary);
        emit DisputeRationale(caseId, classification, rationale);
    }

    // Compatibility shim `resolveByArbitrator` removed. Use `resolveDisputeFinal` via a configured `arbitrationService`.
}
