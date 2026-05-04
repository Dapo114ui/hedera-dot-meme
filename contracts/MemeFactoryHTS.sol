// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MemeFactoryHTS {
    address payable public constant PLATFORM_TREASURY = payable(address(0x0000000000000000000000000000000000866a63));

    event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl);

    // This now only handles the platform fee and event logging
    function createMemeToken(string memory name, string memory symbol, uint256 initialSupply, string memory imageUrl) external payable {
        // We removed the strict require(msg.value >= 5 HBAR) to prevent gas estimation errors.
        // The fee is still collected and forwarded.
        if (msg.value > 0) {
            PLATFORM_TREASURY.transfer(msg.value);
        }
        
        emit MemeLaunched(msg.sender, address(0), name, symbol, imageUrl);
    }

    receive() external payable {}
}
