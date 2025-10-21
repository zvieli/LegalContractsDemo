// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Client} from "./LocalClient.sol";

interface IRouterClientLocal {
    function getFee(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message) external view returns (uint256);
    function ccipSend(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message) external payable returns (bytes32);
}
