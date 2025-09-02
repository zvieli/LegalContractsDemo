// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Rent/TemplateRentContract.sol";
import "./NDA/NDATemplate.sol";

contract ContractFactory {
    address[] public allContracts;
    mapping(address => address[]) public contractsByCreator;

    event RentContractCreated(
        address indexed contractAddress, 
        address indexed landlord, 
        address indexed tenant
    );

    event NDACreated(
        address indexed contractAddress,
        address indexed partyA,
        address indexed partyB
    );

    function createRentContract(
        address _tenant, 
        uint256 _rentAmount, 
        address _priceFeed
    ) external returns (address) {
    address creator = msg.sender;
    require(_tenant != address(0), "Tenant cannot be zero address");
    require(_tenant != creator, "Landlord cannot be tenant");
        require(_rentAmount > 0, "Rent amount must be greater than 0");
        require(_priceFeed != address(0), "Price feed cannot be zero address");
        require(_priceFeed.code.length > 0, "Price feed must be a contract");

        TemplateRentContract newContract = new TemplateRentContract(
            msg.sender,
            _tenant, 
            _rentAmount,
            _priceFeed   
        );

        address newAddr = address(newContract);
    allContracts.push(newAddr);
    contractsByCreator[creator].push(newAddr);

    emit RentContractCreated(newAddr, creator, _tenant);
        return newAddr;
    }

    function createNDA(
        address _partyB,
        uint256 _expiryDate,
        uint16 _penaltyBps,
        bytes32 _customClausesHash,
        address _arbitrator,
        uint256 _minDeposit
    ) external returns (address) {
    address creator = msg.sender;
    require(_partyB != address(0), "Party B cannot be zero address");
    require(_partyB != creator, "Party A cannot be Party B");
        require(_expiryDate > block.timestamp, "Expiry date must be in the future");
        require(_penaltyBps <= 10000, "Penalty must be 10000 bps or less");
        require(_minDeposit > 0, "Minimum deposit must be greater than 0");
        
        if (_arbitrator != address(0)) {
            require(_arbitrator.code.length > 0, "Arbitrator must be a contract");
        }

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
    contractsByCreator[creator].push(newAddr);

    emit NDACreated(newAddr, creator, _partyB);
        return newAddr;
    }

    function getAllContracts() external view returns (address[] memory) {
        return allContracts;
    }

    // Convenience: total counts to avoid returning large arrays in one call
    function getAllContractsCount() external view returns (uint256) {
        return allContracts.length;
    }

    /// @notice Return a page of `contractsByCreator[creator]` starting at `start`, up to `count` entries
    function getContractsByCreatorPaged(address creator, uint256 start, uint256 count) external view returns (address[] memory) {
        uint256 total = contractsByCreator[creator].length;
        if (start >= total) {
            return new address[](0);
        }
        uint256 end = start + count;
        if (end > total) {
            end = total;
        }
        uint256 size = end - start;
        address[] memory page = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = contractsByCreator[creator][start + i];
        }
        return page;
    }

    /// @notice Return a page of `allContracts` starting at `start`, up to `count` entries
    function getAllContractsPaged(uint256 start, uint256 count) external view returns (address[] memory) {
        uint256 total = allContracts.length;
        if (start >= total) {
            return new address[](0);
        }
        uint256 end = start + count;
        if (end > total) {
            end = total;
        }
        uint256 size = end - start;
        address[] memory page = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = allContracts[start + i];
        }
        return page;
    }

    function getContractsByCreator(address creator) external view returns (address[] memory) {
        return contractsByCreator[creator];
    }
}