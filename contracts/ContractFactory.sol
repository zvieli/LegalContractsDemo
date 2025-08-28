// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TemplateRentContract.sol";
import "./NDATemplate.sol";

contract ContractFactory {
    address[] public allContracts;
    mapping(address => address[]) public contractsByCreator;

    event RentContractCreated(
        address indexed contractAddress, 
        address indexed landlord, 
        address indexed tenant,
        uint256 rentAmount,
        address priceFeed
    );

    event NDACreated(
        address indexed contractAddress,
        address indexed partyA,
        address indexed partyB,
        uint256 expiryDate,
        uint16 penaltyBps,
        address arbitrator,
        uint256 minDeposit
    );

    /// יצירת חוזה שכירות חדש
    function createRentContract(
        address _tenant, 
        uint256 _rentAmount, 
        address _priceFeed
    ) external returns (address) {
        require(_tenant != address(0), "Invalid tenant address");
        require(_priceFeed != address(0), "Invalid price feed address");
        require(_rentAmount > 0, "Rent amount must be > 0");

        TemplateRentContract newContract = new TemplateRentContract(
            msg.sender,  // landlord
            _tenant, 
            _rentAmount,
            _priceFeed
        );

        address newAddr = address(newContract);
        allContracts.push(newAddr);
        contractsByCreator[msg.sender].push(newAddr);

        emit RentContractCreated(newAddr, msg.sender, _tenant, _rentAmount, _priceFeed);
        return newAddr;
    }

    /// יצירת חוזה NDA חדש
    function createNDA(
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        address _arbitrator,
        uint256 _minDeposit
    ) external returns (address) {
        require(_partyB != address(0), "Invalid partyB address");
        require(_arbitrator != address(0), "Invalid arbitrator address");
        require(_expiryDate > block.timestamp, "Expiry must be in the future");
        require(_penaltyBps <= 10_000, "Penalty too high"); // לא יותר מ-100%
        require(_minDeposit > 0, "Deposit must be > 0");

        NDATemplate newNDA = new NDATemplate(
            msg.sender,    
            _partyB,       
            _expiryDate,   
            _penaltyBps,    
            _customClausesHash,  
            _arbitrator,       
            _minDeposit         
        );

        address newAddr = address(newNDA);
        allContracts.push(newAddr);
        contractsByCreator[msg.sender].push(newAddr);

        emit NDACreated(newAddr, msg.sender, _partyB, _expiryDate, _penaltyBps, _arbitrator, _minDeposit);
        return newAddr;
    }

    /// החזרת כל הכתובות של חוזים שנוצרו
    function getAllContracts() external view returns (address[] memory) {
        return allContracts;
    }

    /// החזרת כל החוזים שנוצרו על ידי יוצר מסוים
    function getContractsByCreator(address creator) external view returns (address[] memory) {
        return contractsByCreator[creator];
    }
}
