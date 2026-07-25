import { Interface } from 'ethers';
import { createClient } from '@supabase/supabase-js';

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com';
const CONTRACT_ADDRESS = '0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8'; // memejob testnet contract

const TRADE_EVENTS_ABI = [
    'event TokensBought(address indexed tokenAddress, address indexed buyer, uint256 amount, uint256 totalPrice)',
    'event TokensSold(address indexed tokenAddress, address indexed seller, uint256 amount, uint256 totalPrice)'
];
const tradeEventsInterface = new Interface(TRADE_EVENTS_ABI);

export const config = {
    maxDuration: 15
};

// Points map to a real future token airdrop, so the volume this trade is
// worth is never taken from the client - it's re-derived here from the
// trade's own on-chain event log (the same TokensBought/TokensSold events
// mirror-trades.js already parses client-side for the chart/trades table).
//
// Tiered so extra volume stops buying more points past a daily cap per
// wallet - this is what actually resists wash-trading for airdrop farming:
// once trading fees/slippage stop being offset by additional points, there's
// no reason to keep round-tripping the same HBAR. Tuned, not fundamental -
// easy to retune from here.
const RATE_TIERS = [
    { upToHbar: 20, rate: 10 },     // 0-20 HBAR/24h: 10 pts/HBAR
    { upToHbar: 50, rate: 3 },      // 20-50 HBAR/24h: 3 pts/HBAR
    { upToHbar: Infinity, rate: 0 } // 50+ HBAR/24h: capped, no more points
];

// Points for `tradeHbar` of NEW volume, given `priorHbarToday` this wallet
// already has in the current 24h window. Integrates across tier
// boundaries so a trade straddling a threshold gets partial credit at each
// rate, rather than being all-or-nothing at whichever tier it starts in.
function computePointsForTrade(priorHbarToday, tradeHbar) {
    let remaining = tradeHbar;
    let cursor = priorHbarToday;
    let points = 0;
    for (const tier of RATE_TIERS) {
        if (remaining <= 0) break;
        const roomInTier = Math.max(0, tier.upToHbar - cursor);
        const hbarInThisTier = Math.min(remaining, roomInTier);
        if (hbarInThisTier > 0) {
            points += hbarInThisTier * tier.rate;
            remaining -= hbarInThisTier;
            cursor += hbarInThisTier;
        }
    }
    return Math.round(points);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
        console.error('award-points: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
        return res.status(500).json({ error: 'Points service not configured' });
    }

    const { txId, walletAddress } = req.body || {};
    if (!txId || typeof txId !== 'string') {
        return res.status(400).json({ error: 'Invalid txId' });
    }
    if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
        return res.status(400).json({ error: 'Invalid walletAddress' });
    }
    const wallet = walletAddress.toLowerCase();

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    try {
        // Idempotency: never award points twice for the same trade. The
        // unique constraint on tx_id is the real guarantee; this check just
        // avoids an unnecessary mirror node round-trip on a retry.
        const { data: existing } = await supabase
            .from('trade_points_ledger')
            .select('id')
            .eq('tx_id', txId)
            .maybeSingle();
        if (existing) {
            return res.status(200).json({ status: 'already_processed', txId });
        }

        // Independently verify the trade: fetch the real contract call
        // result for this transaction and decode its TokensBought/
        // TokensSold event. Accepts either the native Hedera transaction ID
        // format or a raw EVM tx hash - the mirror node endpoint supports
        // both (verified against a real transaction of each form).
        const resultRes = await fetch(`${MIRROR_BASE}/api/v1/contracts/results/${encodeURIComponent(txId)}`);
        if (!resultRes.ok) {
            return res.status(400).json({ error: 'Transaction not found on mirror node' });
        }
        const contractResult = await resultRes.json();

        if (contractResult.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
            return res.status(400).json({ error: 'Transaction was not a memejob trade' });
        }

        let trade = null;
        for (const log of contractResult.logs || []) {
            let parsed;
            try {
                parsed = tradeEventsInterface.parseLog({ topics: log.topics, data: log.data });
            } catch {
                continue;
            }
            if (!parsed) continue;
            const isBuy = parsed.name === 'TokensBought';
            const trader = (isBuy ? parsed.args.buyer : parsed.args.seller).toLowerCase();
            if (trader !== wallet) continue; // not this wallet's leg of the trade
            trade = {
                tokenAddress: parsed.args.tokenAddress.toLowerCase(),
                volumeTinybars: parsed.args.totalPrice
            };
            break;
        }

        if (!trade) {
            return res.status(400).json({ error: 'No matching trade event found for this wallet in that transaction' });
        }
        if (trade.volumeTinybars <= 0n) {
            return res.status(400).json({ error: 'Trade has no volume' });
        }

        const tradeHbar = Number(trade.volumeTinybars) / 1e8;

        // Wallet's existing volume in the current rolling 24h window.
        const cutoffIso = new Date(Date.now() - 86400000).toISOString();
        const { data: recentRows, error: recentError } = await supabase
            .from('trade_points_ledger')
            .select('volume_tinybars')
            .eq('wallet_address', wallet)
            .gte('created_at', cutoffIso);
        if (recentError) throw recentError;

        const priorHbarToday = (recentRows || []).reduce((sum, r) => sum + Number(r.volume_tinybars), 0) / 1e8;
        const pointsAwarded = computePointsForTrade(priorHbarToday, tradeHbar);

        const { error: insertError } = await supabase.from('trade_points_ledger').insert([{
            wallet_address: wallet,
            token_address: trade.tokenAddress,
            tx_id: txId,
            volume_tinybars: trade.volumeTinybars.toString(),
            points_awarded: pointsAwarded
        }]);
        if (insertError) {
            // Unique violation on tx_id means a concurrent request already
            // recorded this trade - treat as success, not a failure.
            if (insertError.code === '23505') {
                return res.status(200).json({ status: 'already_processed', txId });
            }
            throw insertError;
        }

        return res.status(200).json({
            status: 'ok',
            txId,
            tradeHbar,
            pointsAwarded,
            totalHbarToday: priorHbarToday + tradeHbar
        });
    } catch (err) {
        console.error('award-points failed:', err);
        return res.status(500).json({ error: err.message || 'Failed to award points' });
    }
}
