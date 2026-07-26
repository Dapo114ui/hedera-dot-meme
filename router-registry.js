// Central place that knows about every bonding-curve contract this app
// talks to, and picks the right one for a given token.
//
// Every token launched before this file existed lives on the third-party
// memejob contract. The new first-party OnycBondingCurve contract
// (deployed + verified on testnet, see contracts/OnycBondingCurve.sol)
// only starts handling tokens once the launch flow is actually wired up
// to call it - a separate, not-yet-done phase. Until then,
// getRouterForToken() always resolves to memejob, matching what
// meme_tokens.router_address is backfilled/defaulted to (see
// scripts/router_address_migration.sql).
//
// coin.js and mirror-trades.js previously each hardcoded their own copy
// of the memejob address - consolidated here as the single source of
// truth so there's one place to add the second contract when the trade
// panel and launch flow are updated to use it.

export const MEMEJOB_ADDRESS = '0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8';

// Lowercased so getRouterForToken can compare it directly against
// Supabase's router_address column without a separate normalization step.
export const ONYC_BONDING_CURVE_ADDRESS = '0x035b2f0f3306231eec998d23eaf5d08eaa885542';

export const MEMEJOB_ABI = [
    "function buyJob(address memeAddress, uint256 amountOutMin, address referrer) external payable",
    "function sellJob(address memeAddress, uint256 amountIn) external",
    "function getAmountOut(address memeAddress, uint256 amount, uint8 txType) view returns (uint256 value)",
    "function addressToMemeTokenMapping(address token) view returns (address tokenAddress, address creatorAddress, uint256 fundsRaised, uint256 tokensSold, address firstBuyer, bool distributeRewards)",
    "function FUNDING_GOAL() view returns (uint256)"
];

// Matches contracts/IOnycBondingCurve.sol exactly. Note the different
// decimals convention from memejob: HBAR-denominated values here
// (creationFeeTinybars, fundingGoal, virtualHbarReserve, realHbarReserve,
// previewBuy/previewSell's HBAR side) are 8-decimal tinybars, confirmed
// live against a real deployment (see contracts/test/ValueScaleProbe.sol)
// - NOT the same scale memejob's fundsRaised/FUNDING_GOAL use, which any
// code branching on isOnycBondingCurve below needs to account for.
export const ONYC_BONDING_CURVE_ABI = [
    "function create(string name, string symbol, string memo) payable returns (address tokenAddress)",
    "function buy(address tokenAddress, uint256 minTokensOut) payable returns (uint256 tokensOut)",
    "function sell(address tokenAddress, uint256 tokenAmount, uint256 minHbarOut) returns (uint256 hbarOut)",
    "function getAmountOut(address tokenAddress, uint256 amount, uint8 txType) view returns (uint256)",
    "function previewBuy(address tokenAddress, uint256 hbarAmountIn) view returns (uint256 tokensOut)",
    "function previewSell(address tokenAddress, uint256 tokenAmountIn) view returns (uint256 hbarOut)",
    "function creationFeeTinybars() view returns (uint256)",
    "function tradingFeeBps() view returns (uint16)",
    "function fundingGoal() view returns (uint256)",
    "function memeTokens(address tokenAddress) view returns (tuple(address tokenAddress, address creatorAddress, uint256 virtualHbarReserve, uint256 virtualTokenReserve, uint256 realHbarReserve, uint256 tokensSold, bool graduated))"
];

/**
 * Resolves which bonding-curve contract owns a given token, from its
 * meme_tokens row's router_address column. Defaults to memejob if the
 * column is missing/null/unrecognized - a row that predates the
 * migration, or any other unexpected value, is always treated as
 * memejob rather than silently failing to resolve at all.
 *
 * @param {{ router_address?: string | null }} tokenRow
 * @returns {{ address: string, abi: string[], isOnycBondingCurve: boolean }}
 */
export function getRouterForToken(tokenRow) {
    const raw = tokenRow?.router_address?.toLowerCase();
    if (raw === ONYC_BONDING_CURVE_ADDRESS) {
        return { address: ONYC_BONDING_CURVE_ADDRESS, abi: ONYC_BONDING_CURVE_ABI, isOnycBondingCurve: true };
    }
    return { address: MEMEJOB_ADDRESS, abi: MEMEJOB_ABI, isOnycBondingCurve: false };
}
