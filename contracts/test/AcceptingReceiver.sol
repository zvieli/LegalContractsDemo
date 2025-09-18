// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/// @notice A simple test helper that accepts ETH payments
contract AcceptingReceiver {
	receive() external payable {}
}
