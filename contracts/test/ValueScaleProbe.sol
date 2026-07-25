// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Throwaway diagnostic contract - NOT part of the app. Confirms
/// exactly what scale msg.value and address(this).balance use on real
/// Hedera execution, since a live testnet call just revealed OnycBondingCurve's
/// assumption (both in 18-decimal "weibar" units) is wrong for at least one
/// of them.
contract ValueScaleProbe {
    event Probe(uint256 msgValue, uint256 balanceAfter);

    function probe() external payable {
        emit Probe(msg.value, address(this).balance);
    }
}
