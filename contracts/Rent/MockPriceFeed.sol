// contracts/mocks/MockPriceFeed.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPriceFeed {
    int256 private price;

    constructor(int256 _initialPrice) {
        // Price in USD with 8 decimals (e.g., 2000 * 10^8 = $2000/ETH)
        price = _initialPrice * 10**8;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (0, price, 0, block.timestamp, 0);
    }

    function setPrice(int256 _newPrice) external {
        price = _newPrice * 10**8;
    }

    function getPrice() external view returns (int256) {
        return price;
    }
}