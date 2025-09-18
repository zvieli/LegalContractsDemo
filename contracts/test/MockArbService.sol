// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockArbService {
    address public ownerAddr;
    constructor(address _owner) {
        ownerAddr = _owner;
    }
    function owner() external view returns (address) { return ownerAddr; }
}
