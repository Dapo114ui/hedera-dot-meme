// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BondingCurveMath} from "../BondingCurveMath.sol";

/// @notice Thin external wrapper so tests can call BondingCurveMath's
/// internal pure functions directly (libraries can't be called from
/// off-chain test code otherwise).
contract BondingCurveMathHarness {
    function quote(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 amountIn
    ) external pure returns (uint256) {
        return BondingCurveMath.quote(reserveIn, reserveOut, amountIn);
    }

    function applyFee(
        uint256 amount,
        uint16 feeBps
    ) external pure returns (uint256 amountAfterFee, uint256 feeAmount) {
        return BondingCurveMath.applyFee(amount, feeBps);
    }
}
