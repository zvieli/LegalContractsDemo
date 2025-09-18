// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockReporterTarget {
    uint public val;
    function setVal(uint v) external payable {
        val = v + msg.value;
    }
}
