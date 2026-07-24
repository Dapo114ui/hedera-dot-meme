import { ethers } from 'ethers';
import { ContractId } from '@hashgraph/sdk';
import { CONTRACT_DEPLOYMENTS, createAdapter, getChain, MJClient, NativeAdapter } from '@buidlerlabs/memejob-sdk-js';
import { createClient } from '@supabase/supabase-js';

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com';
const RPC_URL = 'https://testnet.hashio.io/api';
const ROUTER_ADDRESS = CONTRACT_DEPLOYMENTS.testnet.evmAddress;
const ROUTER_ABI = [
    'function getAmountOut(address memeAddress, uint256 amount, uint8 txType) view returns (uint256 value)'
];

const TREASURY_SHARE = 0.01; // 1% of total supply
const MAX_HBAR_TINYBARS = BigInt(Math.round((Number(process.env.TREASURY_BUY_MAX_HBAR) || 50) * 1e8));
const MAX_TOKEN_AGE_MS = 10 * 60 * 1000; // only act on tokens created in the last 10 minutes

export const config = {
    maxDuration: 30 // headroom for the mirror node retry loop below plus the actual buy transaction
};

function hederaIdToEvmAddress(hederaId) {
    const num = parseInt(hederaId.split('.')[2], 10);
    return '0x' + '0'.repeat(24) + num.toString(16).padStart(16, '0');
}

// The mirror node lags a few seconds behind consensus finality, but this
// runs immediately after the token's creation transaction resolves - so
// the very first lookup routinely 404s even though the token is real and
// final. Retry with backoff instead of failing on that expected delay.
async function fetchTokenInfoWithRetry(tokenId, attempts = 6, delayMs = 2000) {
    for (let i = 0; i < attempts; i++) {
        const res = await fetch(`${MIRROR_BASE}/api/v1/tokens/${tokenId}`);
        if (res.ok) return res.json();
        if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
    }
    throw new Error('Token not found on mirror node');
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const treasuryAccountId = process.env.VITE_TREASURY_ACCOUNT_ID;
    const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!treasuryAccountId || !treasuryPrivateKey) {
        console.error('treasury-buy: TREASURY_PRIVATE_KEY / VITE_TREASURY_ACCOUNT_ID not configured');
        return res.status(500).json({ error: 'Treasury not configured' });
    }

    const { tokenId } = req.body || {};
    if (!tokenId || !/^0\.0\.\d+$/.test(tokenId)) {
        return res.status(400).json({ error: 'Invalid tokenId' });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    try {
        // Idempotency: never buy twice for the same token
        const { data: existing } = await supabase
            .from('treasury_buys')
            .select('token_id')
            .eq('token_id', tokenId)
            .maybeSingle();
        if (existing) {
            return res.status(200).json({ status: 'already_processed', tokenId });
        }

        // Sanity: only act on tokens that were genuinely just created
        const tokenInfo = await fetchTokenInfoWithRetry(tokenId);

        const createdMs = parseFloat(tokenInfo.created_timestamp) * 1000;
        if (!createdMs || Date.now() - createdMs > MAX_TOKEN_AGE_MS) {
            return res.status(400).json({ error: 'Token is not a recent launch' });
        }

        const totalSupply = BigInt(tokenInfo.total_supply || 0);
        if (totalSupply <= 0n) throw new Error('Token has no supply');

        // 1% of the real supply, in the token's smallest unit. This is what
        // buy() wants for `amount` - it takes the token quantity and computes
        // the HBAR cost itself, so there is NO unit conversion to do here.
        const targetTokens = totalSupply / 100n;
        const memeAddress = hederaIdToEvmAddress(tokenId);

        // Price the buy first (tokens in -> HBAR out) so we can enforce the
        // spend cap before signing anything. getAmountOut(amount, 0) with
        // txType 0 = "buy this many meme tokens", returns tinybars needed.
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
        const hbarNeeded = await routerContract.getAmountOut(memeAddress, targetTokens, 0);
        if (hbarNeeded <= 0n) throw new Error('Could not price the 1% treasury buy (getAmountOut returned 0)');

        // Over-cap is an expected outcome (buying 1% of a large-supply token on
        // the bonding curve can cost 100+ HBAR), not a server error - return a
        // clear 200 so the fire-and-forget caller doesn't log a 500.
        if (hbarNeeded > MAX_HBAR_TINYBARS) {
            console.warn(`treasury-buy: 1% of ${tokenId} costs ${hbarNeeded} tinybars, over cap ${MAX_HBAR_TINYBARS}; skipping`);
            return res.status(200).json({
                status: 'skipped_over_cap',
                tokenId,
                hbarNeededTinybars: hbarNeeded.toString(),
                capTinybars: MAX_HBAR_TINYBARS.toString()
            });
        }

        const chain = getChain('testnet');
        const adapter = createAdapter(NativeAdapter, {
            operator: { accountId: treasuryAccountId, privateKey: treasuryPrivateKey }
        });
        const client = new MJClient(adapter, {
            chain,
            contractId: ContractId.fromEvmAddress(0, 0, ROUTER_ADDRESS)
        });

        const mjToken = await client.getToken(tokenId);
        // autoAssociate: the treasury account must be associated with the new
        // token to receive it; without this the native buy fails.
        const result = await mjToken.buy({ amount: targetTokens, autoAssociate: true });

        await supabase.from('treasury_buys').insert([{
            token_id: tokenId,
            hbar_spent_tinybars: hbarNeeded.toString(),
            tokens_received: (result.amount ?? targetTokens).toString(),
            tx_id: result.transactionIdOrHash || null
        }]);

        return res.status(200).json({
            status: 'ok',
            tokenId,
            hbarSpentTinybars: hbarNeeded.toString(),
            tokensReceived: (result.amount ?? targetTokens).toString(),
            txId: result.transactionIdOrHash || null
        });
    } catch (err) {
        console.error('treasury-buy failed:', err);
        return res.status(500).json({ error: err.message || 'Treasury buy failed' });
    }
}
