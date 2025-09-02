// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TemplateRentContract {
    address public immutable landlord;
    address public immutable tenant;
    uint256 public rentAmount;
    bool public rentPaid;
    uint256 public totalPaid;
    bool public active;

    AggregatorV3Interface internal immutable priceFeed;

    uint256 public dueDate;
    uint8 public lateFeePercent = 5;

    mapping(address => uint256) public tokenPaid; 

    bool public rentSigned;

    // events
    event RentPaid(address indexed tenant, uint256 amount, bool late, address token);
    event ContractCancelled(address indexed by);
    event DueDateUpdated(uint256 newTimestamp);
    event LateFeeUpdated(uint256 newPercent);
    event RentSigned(address indexed signer, uint256 timestamp);

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
        require(token.transferFrom(msg.sender, landlord, amount), "Token transfer failed");
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
    active = false;
    emit ContractCancelled(msg.sender);
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
}
