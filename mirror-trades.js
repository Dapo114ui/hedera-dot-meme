import { Interface } from 'ethers';
import { MEMEJOB_ADDRESS, ONYC_BONDING_CURVE_ADDRESS } from './router-registry.js';

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com';
const RPC_URL = 'https://testnet.hashio.io/api';
// Trades happen on either contract, so every log-scanning function below
// scans both and merges the results (see router-registry.js).
const CONTRACT_ADDRESSES = [MEMEJOB_ADDRESS, ONYC_BONDING_CURVE_ADDRESS];

const EXCHANGE_RATE_PRECOMPILE = '0x0000000000000000000000000000000000000168';
const exchangeRateInterface = new Interface(['function tinycentsToTinybars(uint256 tinycents) view returns (uint256)']);

// tinycentsToTinybars($1.00) is the one live call both of these derive
// from: it's the exact same call the memejob SDK's getCreationFee() makes
// (100n * 10n**TOKEN_DECIMALS tinycents, TOKEN_DECIMALS=8), so its raw
// result IS the token creation fee in tinybars directly - no separate
// fetch needed to know both the HBAR/USD rate and the creation fee.
let cachedTinybarsPerDollar = null;
let cachedAt = 0;
const CACHE_MS = 60000;

async function fetchTinybarsPerDollar() {
    if (cachedTinybarsPerDollar !== null && Date.now() - cachedAt < CACHE_MS) {
        return cachedTinybarsPerDollar;
    }
    try {
        const data = exchangeRateInterface.encodeFunctionData('tinycentsToTinybars', [100n * 10n ** 8n]); // $1.00 in tinycents
        const res = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: EXCHANGE_RATE_PRECOMPILE, data }, 'latest'] })
        });
        const json = await res.json();
        const [tinybarsPerDollar] = exchangeRateInterface.decodeFunctionResult('tinycentsToTinybars', json.result);
        if (tinybarsPerDollar > 0n) {
            cachedTinybarsPerDollar = tinybarsPerDollar;
            cachedAt = Date.now();
        }
    } catch (e) {
        console.warn('Could not fetch live exchange rate', e);
    }
    return cachedTinybarsPerDollar ?? 0n;
}

// Hedera's own exchange-rate precompile (also used for the launch/HTS fees
// elsewhere in this app) is a much better source for HBAR/USD than a
// hardcoded constant - verified against real market price (~$0.071 on
// exchanges): this returns ~$0.0706, within ~1%. No external API, no CORS,
// no rate limits. Cached briefly since the rate only updates hourly-ish.
export async function fetchHbarUsdRate() {
    const tinybarsPerDollar = await fetchTinybarsPerDollar();
    const hbarPerDollar = Number(tinybarsPerDollar) / 1e8;
    return hbarPerDollar > 0 ? 1 / hbarPerDollar : 0;
}

// The real, current token-creation fee (in tinybars) - what memejob's
// getCreationFee() itself returns, exposed here so the UI can show it
// without a redundant fetch.
export async function fetchCreationFeeTinybars() {
    return fetchTinybarsPerDollar();
}

const TRADE_EVENTS_ABI = [
    'event TokensBought(address indexed tokenAddress, address indexed buyer, uint256 amount, uint256 totalPrice)',
    'event TokensSold(address indexed tokenAddress, address indexed seller, uint256 amount, uint256 totalPrice)'
];
const tradeEventsInterface = new Interface(TRADE_EVENTS_ABI);

// Each page is a sequential round-trip (pagination is a "next" link chain,
// not parallelizable), so this directly trades off completeness for
// latency. 5 pages per contract (~500 most recent logs each, scanned in
// parallel across contracts) keeps bulk ranking (leaderboard/markets)
// reasonably fast; recency-biased data is arguably more correct for
// "trending" anyway.
const MAX_PAGES = 5;

export function evmAddressToHederaId(address) {
    if (!address.startsWith('0x')) return address;
    const accountNum = parseInt(address.substring(26), 16);
    return `0.0.${accountNum}`;
}

export function hederaIdToEvmAddress(hederaId) {
    const num = parseInt(hederaId.split('.')[2], 10);
    return '0x' + '0'.repeat(24) + num.toString(16).padStart(16, '0');
}

// Forward direction, but unlike evmAddressToHederaId above this also
// resolves accounts with a real EVM alias (e.g. any HashPack-created
// wallet) by asking the mirror node, not just the long-zero form. Used
// wherever a trader/wallet address is shown to the user (leaderboard,
// portfolio, recent trades) - Hedera users identify accounts by their
// native ID, not the raw EVM address the app stores internally. Caches in
// localStorage since these are looked up per-row in trader lists.
export async function getHederaNativeId(evmAddress) {
    if (!evmAddress) return null;
    if (/^0\.0\.\d+$/.test(evmAddress)) return evmAddress;

    if (evmAddress.toLowerCase().startsWith('0x000000000000000000000000')) {
        return evmAddressToHederaId(evmAddress);
    }

    const cacheKey = `hedera_id_${evmAddress.toLowerCase()}`;
    const cachedId = localStorage.getItem(cacheKey);
    if (cachedId && !cachedId.toLowerCase().startsWith('0x')) return cachedId;

    try {
        const res = await fetch(`${MIRROR_BASE}/api/v1/accounts/${evmAddress}`);
        if (res.ok) {
            const data = await res.json();
            if (data.account) {
                localStorage.setItem(cacheKey, data.account);
                return data.account;
            }
        }
    } catch (e) {
        console.warn(`Could not resolve Hedera native ID for ${evmAddress}`, e);
    }
    return null;
}

// The long-zero address above is only valid for entities without a real
// EVM alias (contracts, tokens, or accounts created without an ECDSA key).
// An account that already has one (e.g. created via an EVM-compatible
// wallet like HashPack) MUST be targeted by that real alias for value
// transfers - sending to its long-zero form instead is rejected by
// Hedera's JSON-RPC relay with INVALID_ALIAS_KEY (confirmed against
// testnet: identical transfer succeeds to the alias, fails to long-zero).
// So resolve the real alias from the mirror node when one exists, and
// only fall back to the long-zero form for accounts that genuinely don't
// have one.
export async function resolveAccountEvmAddress(hederaId) {
    try {
        const res = await fetch(`${MIRROR_BASE}/api/v1/accounts/${hederaId}`);
        if (res.ok) {
            const data = await res.json();
            if (data.evm_address && /^0x[0-9a-fA-F]{40}$/.test(data.evm_address)) {
                return data.evm_address;
            }
        }
    } catch (e) {
        console.warn(`Could not resolve real EVM alias for ${hederaId}, falling back to long-zero address`, e);
    }
    return hederaIdToEvmAddress(hederaId);
}

/**
 * Mirror node requires a bounded timestamp range for topic-filtered log
 * queries, and each bonding-curve contract is shared across every token
 * routed through it, so instead of filtering server-side we page through
 * each contract's logs newest-first (capped at MAX_PAGES per contract) and
 * decode everything - callers filter/aggregate as needed.
 */
async function scanContractTradeLogs(contractAddress, maxPages) {
    const decoded = [];
    let url = `${MIRROR_BASE}/api/v1/contracts/${contractAddress}/results/logs?order=desc&limit=100`;

    for (let page = 0; page < maxPages && url; page++) {
        const res = await fetch(url);
        if (!res.ok) break;
        const data = await res.json();

        for (const log of data.logs || []) {
            let parsed;
            try {
                parsed = tradeEventsInterface.parseLog({ topics: log.topics, data: log.data });
            } catch {
                continue;
            }
            if (!parsed) continue;

            const isBuy = parsed.name === 'TokensBought';
            decoded.push({
                tokenAddress: parsed.args.tokenAddress.toLowerCase(),
                type: isBuy ? 'buy' : 'sell',
                trader: isBuy ? parsed.args.buyer : parsed.args.seller,
                tokenAmount: parsed.args.amount,
                hbarTinybars: parsed.args.totalPrice,
                timestamp: parseFloat(log.timestamp)
            });
        }

        url = data.links?.next ? MIRROR_BASE + data.links.next : null;
    }

    return decoded;
}

async function scanRecentTradeLogs(maxPages = MAX_PAGES) {
    const perContract = await Promise.all(
        CONTRACT_ADDRESSES.map(addr => scanContractTradeLogs(addr, maxPages))
    );
    return perContract.flat();
}

export async function fetchTokenTrades(tokenEvmAddress) {
    const targetAddress = tokenEvmAddress.toLowerCase();
    const all = await scanRecentTradeLogs();
    const trades = all.filter(t => t.tokenAddress === targetAddress);
    trades.sort((a, b) => a.timestamp - b.timestamp);
    return trades;
}

// Real per-token market stats (volume, latest price, price change) from a
// single shared-contract log scan - the price change is only across
// whatever window the scan covers (bounded by MAX_PAGES), not a true 24h
// figure, but it's genuine trade data rather than a fabricated number.
export async function fetchTokenMarketStats() {
    const all = await scanRecentTradeLogs();
    const byToken = new Map();

    for (const t of all) {
        const price = Number(t.hbarTinybars) / Number(t.tokenAmount);
        const existing = byToken.get(t.tokenAddress);
        if (!existing) {
            byToken.set(t.tokenAddress, {
                volumeTinybars: t.hbarTinybars,
                firstPrice: price, firstTs: t.timestamp,
                lastPrice: price, lastTs: t.timestamp
            });
        } else {
            existing.volumeTinybars += t.hbarTinybars;
            if (t.timestamp < existing.firstTs) { existing.firstPrice = price; existing.firstTs = t.timestamp; }
            if (t.timestamp > existing.lastTs) { existing.lastPrice = price; existing.lastTs = t.timestamp; }
        }
    }

    const stats = new Map();
    for (const [tokenAddress, s] of byToken) {
        stats.set(tokenAddress, {
            volumeTinybars: s.volumeTinybars,
            lastPrice: s.lastPrice,
            changePct: s.firstPrice > 0 ? ((s.lastPrice - s.firstPrice) / s.firstPrice) * 100 : 0
        });
    }
    return stats;
}

// Tallies real HBAR trade volume per token, so "top tokens" can be ranked
// by actual activity instead of just recency.
export async function fetchTopTokensByVolume() {
    const stats = await fetchTokenMarketStats();
    return Array.from(stats.entries())
        .map(([tokenAddress, s]) => ({ tokenAddress, hbarTinybars: s.volumeTinybars }))
        .sort((a, b) => (a.hbarTinybars < b.hbarTinybars ? 1 : a.hbarTinybars > b.hbarTinybars ? -1 : 0));
}

export async function fetchTokenHolders(hederaTokenId) {
    const [tokenRes, balancesRes] = await Promise.all([
        fetch(`${MIRROR_BASE}/api/v1/tokens/${hederaTokenId}`),
        fetch(`${MIRROR_BASE}/api/v1/tokens/${hederaTokenId}/balances?limit=100`)
    ]);
    if (!tokenRes.ok || !balancesRes.ok) throw new Error('Mirror node balances lookup failed');

    const tokenInfo = await tokenRes.json();
    const balancesData = await balancesRes.json();
    const totalSupply = Number(tokenInfo.total_supply || 0);

    return (balancesData.balances || [])
        .filter(b => Number(b.balance) > 0)
        .sort((a, b) => Number(b.balance) - Number(a.balance))
        .slice(0, 10)
        .map(b => ({
            account: b.account,
            balance: Number(b.balance),
            percent: totalSupply > 0 ? (Number(b.balance) / totalSupply) * 100 : 0
        }));
}
