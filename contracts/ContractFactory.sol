// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TemplateRentContract.sol";
import "./NDATemplate.sol";

contract ContractFactory {
    // מאגר כל החוזים שנוצרו
    address[] public allContracts;
    mapping(address => address[]) public contractsByCreator;

    // אירועים לשידור כאשר חוזים חדשים נוצרים
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

    // פונקציה ליצירת חוזה שכירות חדש
    function createRentContract(
        address _tenant, 
        uint256 _rentAmount, 
        address _priceFeed
    ) external returns (address) {
        TemplateRentContract newContract = new TemplateRentContract(
            msg.sender,  // landlord
            _tenant,     // tenant
            _rentAmount, // סכום שכירות
            _priceFeed   // כתובת price feed
        );

        address newAddr = address(newContract);
        allContracts.push(newAddr);
        contractsByCreator[msg.sender].push(newAddr);

        emit RentContractCreated(newAddr, msg.sender, _tenant);
        return newAddr;
    }

    // פונקציה ליצירת חוזה NDA חדש
    function createNDA(address _partyB) external returns (address) {
    // msg.sender = partyA
    NDATemplate newNDA = new NDATemplate(msg.sender, _partyB);

    address newAddr = address(newNDA);
    allContracts.push(newAddr);
    contractsByCreator[msg.sender].push(newAddr);

    emit NDACreated(newAddr, msg.sender, _partyB);
    return newAddr;
}


    // פונקציות נוחות לקריאה מהחוץ
    function getAllContracts() external view returns (address[] memory) {
        return allContracts;
    }

    function getContractsByCreator(address creator) external view returns (address[] memory) {
        return contractsByCreator[creator];
    }
}
