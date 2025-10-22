// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Simple contract that reverts on receiving ETH to test fallback handling
contract FailReceiver {
    fallback() external payable {
        revert("FailReceiver: cannot accept");
    }
    receive() external payable {
        revert("FailReceiver: cannot accept");
    }
}
