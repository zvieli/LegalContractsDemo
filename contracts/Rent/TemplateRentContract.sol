// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../AggregatorV3Interface.sol";
// ERC20 support removed: no IERC20, IERC20Permit, SafeERC20
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
    uint256 public dueDate;
    uint8 public lateFeePercent = 5;

    // tokenPaid removed (no ERC20 support)
    // Pull-payment ledger: credit recipients here and let them withdraw to avoid stuck transfers
    mapping(address => uint256) public withdrawable;
    // Reporter bond per dispute caseId (optional bond attached by reporter)
    mapping(uint256 => uint256) private _reporterBond;
    // Track debtor per case and whether debtor has deposited required claim amount
    mapping(uint256 => address) private _caseDebtor;
    mapping(uint256 => bool) private _caseDepositSatisfied;
    // Track on-chain recorded debts owed by parties when a resolution exceeds available funds
    mapping(address => uint256) public debtOwed;

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
    // per-party deposit balances (landlord and tenant can deposit security)
    mapping(address => uint256) public partyDeposit;

    enum DisputeType { Damage, ConditionStart, ConditionEnd, Quality, EarlyTerminationJustCause, DepositSplit, ExternalValuation }

    struct DisputeCase {
        address initiator;
        DisputeType dtype;
        uint256 requestedAmount;    // claim amount (e.g., damages or amount to release)
        string evidenceUri;         // ipfs://<cid> or other off-chain URI referencing canonical evidence
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
    // Optional initial evidence URI supplied at contract creation (e.g., ipfs://<cid>)
    string public initialEvidenceUri;

    // events
    event RentPaid(address indexed tenant, uint256 amount, bool late);
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
    event SecurityDepositPaid(address indexed by, uint256 amount, uint256 total);
    event DepositDebited(address indexed who, uint256 amount);
    event DisputeReported(uint256 indexed caseId, address indexed initiator, uint8 disputeType, uint256 requestedAmount);
    // Event to include the evidence URI when available
    event DisputeReportedWithUri(uint256 indexed caseId, string evidenceUri);
    event DisputeFiled(uint256 indexed caseId, address indexed debtor, uint256 requestedAmount);
    event DisputeResolved(uint256 indexed caseId, bool approved, uint256 appliedAmount, address beneficiary);
    event DisputeAppliedCapped(uint256 indexed caseId, uint256 requestedAmount, uint256 available, uint256 applied);
    event DebtRecorded(address indexed debtor, uint256 amount);
    // ERC20 support removed: ERC20DebtCollected event intentionally omitted
    event DisputeRationale(uint256 indexed caseId, string classification, string rationale);
    event PaymentWithdrawn(address indexed to, uint256 amount);
    /// @notice emitted when an attempted approval fails due to insufficient deposit
    error InsufficientDepositForResolution(uint256 available, uint256 required);

    constructor(
        address _landlord,
        address _tenant,
        uint256 _rentAmount,
        uint256 _dueDate,
        address _priceFeed,
        uint256 _propertyId,
        address _arbitration_service,
        uint256 _requiredDeposit,
        string memory _initialEvidenceUri
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
    arbitrationService = _arbitration_service;
    requiredDeposit = _requiredDeposit;
    // store optional initial evidence URI for off-chain payload referenced at creation time
    initialEvidenceUri = _initialEvidenceUri;
    // Set dueDate from constructor param so frontend/tx metadata can include it when desired
    dueDate = _dueDate;
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
        emit RentPaid(msg.sender, amount, false);
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
        emit RentPaid(msg.sender, msg.value, false);
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
        emit RentPaid(msg.sender, msg.value, late);
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
        emit RentPaid(msg.sender, msg.value, late);
    }
    // ERC20 payment functions removed (project no longer supports ERC20 payments)

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

    function depositSecurity() external payable onlyActive onlyFullySigned {
        if (msg.value == 0) revert DepositTooLow();
        partyDeposit[msg.sender] += msg.value;
        emit SecurityDepositPaid(msg.sender, msg.value, partyDeposit[msg.sender]);
        if (requiredDeposit > 0 && partyDeposit[msg.sender] < requiredDeposit) revert DepositTooLow();
    }

    function getDisputesCount() external view returns (uint256) { return _disputes.length; }

    /// @notice Deposit (or top-up) the reporter bond for an existing dispute case
    function depositReporterBond(uint256 caseId) external payable onlyActive {
        require(caseId < _disputes.length, "bad id");
        require(msg.value > 0, "no value");
        _reporterBond[caseId] += msg.value;
    }

    /// @notice Read the reporter bond attached to a dispute (0 if none)
    function getDisputeBond(uint256 caseId) external view returns (uint256) {
        if (caseId >= _disputes.length) return 0;
        return _reporterBond[caseId];
    }

    function getDispute(uint256 caseId) external view returns (
        address initiator,
        DisputeType dtype,
        uint256 requestedAmount,
        string memory evidenceUri,
        bool resolved,
        bool approved,
        uint256 appliedAmount
    ) {
        require(caseId < _disputes.length, "bad id");
        DisputeCase storage dc = _disputes[caseId];
        return (dc.initiator, dc.dtype, dc.requestedAmount, dc.evidenceUri, dc.resolved, dc.approved, dc.appliedAmount);
    }

    function getDisputeMeta(uint256 caseId) external view returns (string memory classification, string memory rationale) {
        require(caseId < _disputes.length, "bad id");
        DisputeMeta storage m = _disputeMeta[caseId];
        return (m.classification, m.rationale);
    }

    /// @notice Debtor may deposit the requested claim amount to satisfy a dispute case so resolution that debits deposit can be executed.
    function depositForCase(uint256 caseId) external payable onlyActive {
        require(caseId < _disputes.length, "bad id");
        address debtor = _caseDebtor[caseId];
        require(msg.sender == debtor, "only debtor may deposit");
        DisputeCase storage dc = _disputes[caseId];
        uint256 req = dc.requestedAmount;
        require(req > 0, "no requested amount");
        if (msg.value == 0) revert DepositTooLow();
        partyDeposit[msg.sender] += msg.value;
        emit SecurityDepositPaid(msg.sender, msg.value, partyDeposit[msg.sender]);
        if (partyDeposit[msg.sender] >= req) {
            _caseDepositSatisfied[caseId] = true;
        }
    }

    function reportDispute(DisputeType dtype, uint256 requestedAmount, string calldata evidenceUri) external payable onlyActive returns (uint256 caseId) {
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
    // store provided evidence URI
    dc.evidenceUri = evidenceUri;

        // Enforce reporter bond = 0.5% of requestedAmount (anti-spam). Require msg.value >= requiredBond
        uint256 requiredBond = 0;
        if (requestedAmount > 0) {
            requiredBond = (requestedAmount * 5) / 10000; // 0.05%
            // ensure at least 1 wei if computed zero but request >0
            if (requiredBond == 0) requiredBond = 1;
        }
        if (msg.value < requiredBond) revert InsufficientFee();
        // store the bond (allow callers to overpay; full msg.value credited)
        if (msg.value > 0) {
            _reporterBond[caseId] = msg.value;
        }

        // Track debtor for this case and whether they already have sufficient deposit
        address debtor = msg.sender == landlord ? tenant : landlord;
        _caseDebtor[caseId] = debtor;
        if (partyDeposit[debtor] >= requestedAmount) {
            _caseDepositSatisfied[caseId] = true;
        } else {
            _caseDepositSatisfied[caseId] = false;
        }

    emit DisputeReported(caseId, msg.sender, uint8(dtype), requestedAmount);
    emit DisputeReportedWithUri(caseId, dc.evidenceUri);
    // Notify debtor off-chain via event so UI can prompt debtor to deposit requested amount
    emit DisputeFiled(caseId, debtor, requestedAmount);
    }

    // Deprecated: CID-based reporting functions removed. Use reportDispute with a bytes32 digest.

    /// @notice Read the stored evidence URI for a dispute (empty string if none)
    function getDisputeUri(uint256 caseId) external view returns (string memory) {
        require(caseId < _disputes.length, "bad id");
        return _disputes[caseId].evidenceUri;
    }

    /// @notice Final resolution used by arbitrator/oracle (single-step) similar to NDA oracle path.
    /// @param caseId dispute id
    /// @param approve whether claim approved
    /// @param appliedAmount amount to transfer (capped by depositBalance when deducting)
    /// @param beneficiary receiver of funds (usually landlord for damage; tenant for refund scenarios)
    /// @param classification short label (<=64 chars)
    /// @param rationale explanation (<=512 chars)
    // Allow arbitration service to forward ETH to supplement depositBalance when resolving
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
    // added forwardedEth: extra ETH forwarded by the arbitration service to supplement depositBalance
    function _resolveDisputeFinal(
        uint256 caseId,
        bool approve,
        uint256,
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

        // Handle reporter bond (if any) and debtor deposit movements according to the requested flow:
        // - When approved: reporter bond returns to reporter; debtor's deposit moves to claimant (beneficiary) as compensation.
        // - When rejected: reporter bond goes to arbitrator owner; debtor's deposit (if any reserved) returns to debtor.
        uint256 bond = _reporterBond[caseId];
        if (bond > 0) {
            // clear bond storage immediately
            _reporterBond[caseId] = 0;
        }

        uint256 applied = 0;
        address debtor = _caseDebtor[caseId];
        uint256 requested = dc.requestedAmount;

        if (approve) {
            // Return bond to initiator (reporter)
            if (bond > 0) {
                address initiator = dc.initiator;
                (bool okBond, ) = payable(initiator).call{value: bond}("");
                if (!okBond) {
                    withdrawable[initiator] += bond;
                    emit PaymentCredited(initiator, bond);
                }
            }

            // Transfer debtor deposit to beneficiary as compensation (must be available)
            if (requested > 0) {
                uint256 available = partyDeposit[debtor];
                if (available == 0) {
                    // nothing to apply
                    applied = 0;
                } else if (available < requested) {
                    // Mitigation: cap applied amount to available deposit per spec 2.2
                    partyDeposit[debtor] = 0;
                    emit DisputeAppliedCapped(caseId, requested, available, available);
                    emit DepositDebited(debtor, available);
                    // send available to beneficiary
                    (bool okCap, ) = payable(beneficiary).call{value: available}("");
                    if (!okCap) {
                        withdrawable[beneficiary] += available;
                        emit PaymentCredited(beneficiary, available);
                    }
                    applied = available;
                } else {
                    partyDeposit[debtor] = available - requested;
                    emit DepositDebited(debtor, requested);
                    // Send to beneficiary
                    (bool ok, ) = payable(beneficiary).call{value: requested}("");
                    if (!ok) {
                        withdrawable[beneficiary] += requested;
                        emit PaymentCredited(beneficiary, requested);
                    }
                    applied = requested;
                }
            }
        } else {
            // Rejected: forward bond to arbitrator owner if possible
            if (bond > 0) {
                address arbOwner = address(0);
                if (arbitrationService != address(0)) {
                    (bool ok, bytes memory data) = arbitrationService.staticcall(abi.encodeWithSignature("owner()"));
                    if (ok && data.length >= 32) {
                        arbOwner = abi.decode(data, (address));
                    }
                }
                if (arbOwner != address(0)) {
                    (bool sentOwner, ) = payable(arbOwner).call{value: bond}("");
                    if (!sentOwner) {
                        withdrawable[arbOwner] += bond;
                        emit PaymentCredited(arbOwner, bond);
                    }
                } else {
                    withdrawable[address(this)] += bond;
                    emit PaymentCredited(address(this), bond);
                }
            }
            // If rejected, debtor deposit remains with debtor (no transfer). Nothing else to do.
        }

        dc.appliedAmount = applied;
        _disputeMeta[caseId] = DisputeMeta({classification: classification, rationale: rationale});
        emit DisputeResolved(caseId, approve, applied, beneficiary);
        emit DisputeRationale(caseId, classification, rationale);
    }

    }

    