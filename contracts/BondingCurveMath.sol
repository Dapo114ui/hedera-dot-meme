// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BondingCurveMath
/// @notice Pure constant-product curve math (x*y=k, same family as Uniswap
/// V2) plus basis-point fee splitting. Deliberately has zero storage, zero
/// external calls, and zero HTS/Hedera-specific code, so it can be unit
/// tested exhaustively as plain EVM math - independent of anything
/// Hedera-specific, which is the harder-to-test part of the system.
library BondingCurveMath {
    uint16 internal constant BPS_DENOMINATOR = 10000;

    error ZeroReserve();

    /// @notice How much of `reserveOut` you get for `amountIn` of
    /// `reserveIn`, holding k = reserveIn * reserveOut constant:
    ///   amountOut = reserveOut - k / (reserveIn + amountIn)
    ///             = reserveOut * amountIn / (reserveIn + amountIn)
    /// Used both directions - buy quotes HBAR-in against
    /// (virtualHbarReserve, virtualTokenReserve), sell quotes tokens-in
    /// against (virtualTokenReserve, virtualHbarReserve).
    function quote(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 amountIn
    ) internal pure returns (uint256 amountOut) {
        if (reserveIn == 0 || reserveOut == 0) revert ZeroReserve();
        amountOut = (reserveOut * amountIn) / (reserveIn + amountIn);
    }

    /// @notice Splits `amount` into (amountAfterFee, feeAmount) at
    /// `feeBps` basis points (100 = 1%).
    function applyFee(
        uint256 amount,
        uint16 feeBps
    ) internal pure returns (uint256 amountAfterFee, uint256 feeAmount) {
        feeAmount = (amount * feeBps) / BPS_DENOMINATOR;
        amountAfterFee = amount - feeAmount;
    }
}
