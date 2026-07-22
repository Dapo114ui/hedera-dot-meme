import { Interface } from 'ethers';

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com';
const CONTRACT_ADDRESS = '0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8'; // memejob testnet contract (CONTRACT_DEPLOYMENTS.testnet.evmAddress)

const TRADE_EVENTS_ABI = [
    'event TokensBought(address indexed tokenAddress, address indexed buyer, uint256 amount, uint256 totalPrice)',
    'event TokensSold(address indexed tokenAddress, address indexed seller, uint256 amount, uint256 totalPrice)'
];
const tradeEventsInterface = new Interface(TRADE_EVENTS_ABI);

const MAX_PAGES = 15;
const MAX_TRADES = 300;

export function evmAddressToHederaId(address) {
    if (!address.startsWith('0x')) return address;
    const accountNum = parseInt(address.substring(26), 16);
    return `0.0.${accountNum}`;
}

/**
 * Mirror node requires a bounded timestamp range for topic-filtered log
 * queries, and the memejob contract is shared across every token on the
 * platform, so instead of filtering server-side we page through the
 * contract's logs newest-first and keep only the ones for this token.
 */
export async function fetchTokenTrades(tokenEvmAddress) {
    const targetAddress = tokenEvmAddress.toLowerCase();
    const trades = [];
    let url = `${MIRROR_BASE}/api/v1/contracts/${CONTRACT_ADDRESS}/results/logs?order=desc&limit=100`;

    for (let page = 0; page < MAX_PAGES && url && trades.length < MAX_TRADES; page++) {
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
            if (!parsed || parsed.args.tokenAddress.toLowerCase() !== targetAddress) continue;

            const isBuy = parsed.name === 'TokensBought';
            trades.push({
                type: isBuy ? 'buy' : 'sell',
                trader: isBuy ? parsed.args.buyer : parsed.args.seller,
                tokenAmount: parsed.args.amount,
                hbarTinybars: parsed.args.totalPrice,
                timestamp: parseFloat(log.timestamp)
            });
        }

        url = data.links?.next ? MIRROR_BASE + data.links.next : null;
    }

    trades.sort((a, b) => a.timestamp - b.timestamp);
    return trades;
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
