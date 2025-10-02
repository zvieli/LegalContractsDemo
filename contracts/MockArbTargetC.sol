// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockArbTargetC {
    event Called(address caller, uint256 value);
    function serviceResolve(uint256 value) external {
        emit Called(msg.sender, value);
    }
}
