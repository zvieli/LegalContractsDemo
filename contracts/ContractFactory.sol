// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TemplateRentContract.sol";

contract ContractFactory {
    // מאגר כל החוזים שנוצרו
    address[] public allContracts;
    mapping(address => address[]) public contractsByCreator;

    // אירוע לשידור כאשר חוזה חדש נוצר
    event RentContractCreated(
        address indexed contractAddress, 
        address indexed landlord, 
        address indexed tenant
    );

    // פונקציה ליצירת חוזה שכירות חדש
    function createRentContract(
        address _tenant, 
        uint256 _rentAmount, 
        address _priceFeed
    ) external returns (address) {

        // יוצרים מופע חדש של TemplateRentContract
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

    // פונקציות נוחות לקריאה מהחוץ
    function getAllContracts() external view returns (address[] memory) {
        return allContracts;
    }

    function getContractsByCreator(address creator) external view returns (address[] memory) {
        return contractsByCreator[creator];
    }
}
