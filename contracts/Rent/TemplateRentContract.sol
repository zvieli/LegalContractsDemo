// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TemplateRentContract {
    address public immutable landlord;
    address public immutable tenant;
    uint256 public rentAmount;
    bool public rentPaid;
    uint256 public totalPaid;
    bool public active;

AggregatorV3Interface public immutable priceFeed;
    using SafeERC20 for IERC20;

    uint256 public dueDate;
    uint8 public lateFeePercent = 5;

    mapping(address => uint256) public tokenPaid; 

    bool public rentSigned;

    // Cancellation policy and state
    bool public requireMutualCancel;           // if true, both parties must approve
    uint256 public noticePeriod;               // seconds to wait before unilateral finalize
    uint16 public earlyTerminationFeeBps;      // optional fee in bps applied to current rent in ETH

    bool public cancelRequested;               // has a cancellation been initiated
    address public cancelInitiator;            // who initiated the cancellation
    uint256 public cancelEffectiveAt;          // timestamp when finalize is allowed (unilateral)
    mapping(address => bool) public cancelApprovals; // who approved (for mutual or record)

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

    constructor(
        address _landlord,
        address _tenant,
        uint256 _rentAmount,
        address _priceFeed
    ) {
        landlord = _landlord;
        tenant = _tenant;
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
    modifier onlyTenant() {
        require(msg.sender == tenant, "Only tenant can pay");
        _;
    }

    modifier onlyLandlord() {
        require(msg.sender == landlord, "Only landlord can call");
        _;
    }

    modifier onlyActive() {
        require(active, "Contract is not active");
        _;
    }

    function payRent(uint256 amount) external onlyTenant onlyActive {
        require(amount >= rentAmount, "Not enough amount");
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
    require(price > 0, "Invalid price");
    
    // Assuming:
    // - rentAmount is in USD (e.g., 0.5 = $0.5)
    // - price is USD/ETH with 8 decimals (e.g., 2000 * 10^8 = $2000 per ETH)
    // - We need to convert rentAmount (USD) to ETH
    
    // Formula: ETH = USD / (USD/ETH)
    return (rentAmount * 1e8) / uint256(price);
}

    function payRentInEth() external payable onlyTenant onlyActive {
        uint256 requiredEth = getRentInEth();
        require(msg.value >= requiredEth, "Not enough ETH sent");
        rentPaid = true;
        totalPaid += msg.value;
        (bool sent, ) = payable(landlord).call{value: msg.value}("");
        require(sent, "ETH transfer to landlord failed");
        emit RentPaid(msg.sender, msg.value, false, address(0));
    }

    function payRentWithLateFee() external payable onlyTenant onlyActive {
        uint256 requiredEth = getRentInEth();
        bool late = false;

        if (block.timestamp > dueDate && dueDate != 0) {
            uint256 fee = (requiredEth * uint256(lateFeePercent)) / 100;
            requiredEth += fee;
            late = true;
        }

        require(msg.value >= requiredEth, "Not enough ETH sent");
        totalPaid += msg.value;
        rentPaid = true;
        (bool sent, ) = payable(landlord).call{value: msg.value}("");
        require(sent, "ETH transfer to landlord failed");
        emit RentPaid(msg.sender, msg.value, late, address(0));
    }

    function payRentPartial() external payable onlyTenant onlyActive {
        bool late = false;
        if (block.timestamp > dueDate && dueDate != 0) late = true;

        totalPaid += msg.value;
        if (totalPaid >= getRentInEth()) rentPaid = true;

        (bool sent, ) = payable(landlord).call{value: msg.value}("");
        require(sent, "ETH transfer to landlord failed");
        emit RentPaid(msg.sender, msg.value, late, address(0));
    }

    function payRentWithToken(address tokenAddress, uint256 amount) external onlyTenant onlyActive {
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
        dueDate = timestamp;
        emit DueDateUpdated(timestamp);
    }

    // contracts/Rent/TemplateRentContract.sol - תיקון ה-cancelContract
function cancelContract() external {
    require(msg.sender == landlord || msg.sender == tenant, "Only landlord or tenant can cancel");
    require(active, "Contract already inactive");
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

    function signRent(bytes calldata signature) external onlyTenant onlyActive {
        require(!rentSigned, "Rent already signed");

        bytes32 messageHash = keccak256(abi.encodePacked(address(this), rentAmount, dueDate));
        bytes32 ethSignedMessageHash = ECDSA.toEthSignedMessageHash(messageHash);

        address signerAddress = ECDSA.recover(ethSignedMessageHash, signature);
        require(signerAddress == tenant, "Invalid signature");

        rentSigned = true;
        emit RentSigned(signerAddress, block.timestamp);
    }

    // ============ Cancellation Policy Management ============
    function setCancellationPolicy(uint256 _noticePeriod, uint16 _feeBps, bool _requireMutual)
        external
        onlyLandlord
        onlyActive
    {
        require(_feeBps <= 10_000, "Invalid fee bps");
        noticePeriod = _noticePeriod;
        earlyTerminationFeeBps = _feeBps;
        requireMutualCancel = _requireMutual;
        emit CancellationPolicyUpdated(_noticePeriod, _feeBps, _requireMutual);
    }

    function initiateCancellation() external onlyActive {
        require(msg.sender == landlord || msg.sender == tenant, "Only landlord or tenant");
        require(!cancelRequested, "Cancellation already requested");
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
        require(msg.sender == landlord || msg.sender == tenant, "Only landlord or tenant");
        require(cancelRequested, "No cancellation requested");
        require(msg.sender != cancelInitiator, "Initiator already approved");
        require(!cancelApprovals[msg.sender], "Already approved");
        cancelApprovals[msg.sender] = true;
        emit CancellationApproved(msg.sender);
        if (requireMutualCancel) {
            _finalizeCancellationNoFeePath();
        } else if (noticePeriod == 0) {
            _finalizeCancellationNoFeePath();
        }
    }

    function finalizeCancellation() external payable onlyActive {
        require(msg.sender == landlord || msg.sender == tenant, "Only landlord or tenant");
        require(cancelRequested, "No cancellation requested");
        if (requireMutualCancel) {
            require(cancelApprovals[landlord] && cancelApprovals[tenant], "Both must approve");
            _finalizeCancellationNoFeePath();
            return;
        }
        require(block.timestamp >= cancelEffectiveAt, "Notice period not elapsed");
        // Unilateral path: optional early termination fee
        uint256 fee = 0;
        if (earlyTerminationFeeBps > 0) {
            uint256 requiredEth = getRentInEth();
            fee = (requiredEth * uint256(earlyTerminationFeeBps)) / 10_000;
            require(msg.value >= fee, "Insufficient fee");
            address counterparty = msg.sender == landlord ? tenant : landlord;
            if (fee > 0) {
                (bool sent, ) = payable(counterparty).call{value: fee}("");
                require(sent, "Fee transfer failed");
                emit EarlyTerminationFeePaid(msg.sender, fee, counterparty);
            }
        }
        _finalizeCancellationStateOnly();
    }

    function _finalizeCancellationNoFeePath() internal {
        _finalizeCancellationStateOnly();
    }

    function _finalizeCancellationStateOnly() internal {
        require(active, "Already inactive");
        active = false;
        emit ContractCancelled(msg.sender);
        emit CancellationFinalized(msg.sender);
    }
}
