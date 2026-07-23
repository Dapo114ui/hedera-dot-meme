import { Interface } from 'ethers';

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com';
const CONTRACT_ADDRESS = '0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8'; // memejob testnet contract (CONTRACT_DEPLOYMENTS.testnet.evmAddress)

const TRADE_EVENTS_ABI = [
    'event TokensBought(address indexed tokenAddress, address indexed buyer, uint256 amount, uint256 totalPrice)',
    'event TokensSold(address indexed tokenAddress, address indexed seller, uint256 amount, uint256 totalPrice)'
];
const tradeEventsInterface = new Interface(TRADE_EVENTS_ABI);

// Each page is a sequential round-trip (pagination is a "next" link chain,
// not parallelizable), so this directly trades off completeness for
// latency. 5 pages (~500 most recent logs across the whole shared
// contract) keeps bulk ranking (leaderboard/markets) reasonably fast;
// recency-biased data is arguably more correct for "trending" anyway.
const MAX_PAGES = 5;

export function evmAddressToHederaId(address) {
    if (!address.startsWith('0x')) return address;
    const accountNum = parseInt(address.substring(26), 16);
    return `0.0.${accountNum}`;
}

/**
 * Mirror node requires a bounded timestamp range for topic-filtered log
 * queries, and the memejob contract is shared across every token on the
 * platform, so instead of filtering server-side we page through the
 * contract's logs newest-first (capped at MAX_PAGES) and decode
 * everything - callers filter/aggregate as needed.
 */
async function scanRecentTradeLogs(maxPages = MAX_PAGES) {
    const decoded = [];
    let url = `${MIRROR_BASE}/api/v1/contracts/${CONTRACT_ADDRESS}/results/logs?order=desc&limit=100`;

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
