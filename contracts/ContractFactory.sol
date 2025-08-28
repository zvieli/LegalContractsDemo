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
        TemplateRentContract newContract = new TemplateRentContract(
            msg.sender,
            _tenant, 
            _rentAmount,
            _priceFeed   
        );

        address newAddr = address(newContract);
        allContracts.push(newAddr);
        contractsByCreator[msg.sender].push(newAddr);

        emit RentContractCreated(newAddr, msg.sender, _tenant);
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

    emit NDACreated(newAddr, msg.sender, _partyB);
    return newAddr;
}

    function getAllContracts() external view returns (address[] memory) {
        return allContracts;
    }

    function getContractsByCreator(address creator) external view returns (address[] memory) {
        return contractsByCreator[creator];
    }
}
