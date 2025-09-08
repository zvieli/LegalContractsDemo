// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface used by templates to verify the caller is the approved factory.
interface IFactoryAuth {
    function isFactory() external pure returns (bool);
}
