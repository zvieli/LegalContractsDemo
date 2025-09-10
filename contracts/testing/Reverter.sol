// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Reverter {
    receive() external payable {
        revert("I do not accept ETH");
    }
    fallback() external payable {
        revert("I do not accept ETH");
    }
}
