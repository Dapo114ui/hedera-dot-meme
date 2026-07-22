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

function hederaIdToEvmAddress(hederaId) {
    const num = parseInt(hederaId.split('.')[2], 10);
    return '0x' + '0'.repeat(24) + num.toString(16).padStart(16, '0');
}

// Binary-searches the router's forward-only getAmountOut (no reverse quote
// exists) for the minimum HBAR input whose token output meets the target.
async function findHbarForTargetTokens(routerContract, memeAddress, targetTokens, maxHbarTinybars) {
    let lo = 0n;
    let hi = maxHbarTinybars;

    const hiOut = await routerContract.getAmountOut(memeAddress, hi, 0);
    if (hiOut < targetTokens) {
        throw new Error(`Target unreachable within max spend cap (cap yields ${hiOut}, need ${targetTokens})`);
    }

    for (let i = 0; i < 30 && hi - lo > 1n; i++) {
        const mid = (lo + hi) / 2n;
        const out = await routerContract.getAmountOut(memeAddress, mid, 0);
        if (out < targetTokens) {
            lo = mid + 1n;
        } else {
            hi = mid;
        }
    }
    return hi;
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
        const tokenInfoRes = await fetch(`${MIRROR_BASE}/api/v1/tokens/${tokenId}`);
        if (!tokenInfoRes.ok) throw new Error('Token not found on mirror node');
        const tokenInfo = await tokenInfoRes.json();

        const createdMs = parseFloat(tokenInfo.created_timestamp) * 1000;
        if (!createdMs || Date.now() - createdMs > MAX_TOKEN_AGE_MS) {
            return res.status(400).json({ error: 'Token is not a recent launch' });
        }

        const totalSupply = BigInt(tokenInfo.total_supply || 0);
        if (totalSupply <= 0n) throw new Error('Token has no supply');

        const targetTokens = totalSupply / 100n; // 1%
        const memeAddress = hederaIdToEvmAddress(tokenId);

        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);

        const hbarNeeded = await findHbarForTargetTokens(routerContract, memeAddress, targetTokens, MAX_HBAR_TINYBARS);

        const chain = getChain('testnet');
        const adapter = createAdapter(NativeAdapter, {
            operator: { accountId: treasuryAccountId, privateKey: treasuryPrivateKey }
        });
        const client = new MJClient(adapter, {
            chain,
            contractId: ContractId.fromEvmAddress(0, 0, ROUTER_ADDRESS)
        });

        const mjToken = await client.getToken(tokenId);
        const result = await mjToken.buy({ amount: hbarNeeded });

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
