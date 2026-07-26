import { supabase } from './supabase.js';
import { ethers } from 'ethers';
import { evmAddressToHederaId, fetchTokenTrades, fetchTokenHolders, fetchHbarUsdRate } from './mirror-trades.js';
import { isWatchlisted, toggleWatchlist } from './watchlist.js';
import { wrapProviderForLegacyFees } from './provider-fee-fix.js';
import { getAlertsForToken, addAlert, removeAlert, checkAlerts } from './alerts.js';
import { MEMEJOB_ADDRESS, getRouterForToken } from './router-registry.js';

// @hashgraph/sdk and @buidlerlabs/memejob-sdk-js (which pulls in viem) are
// ~3.5MB combined - dynamically imported only where actually needed (the
// trade handler below) so viewing a token's page doesn't pay for it unless
// the user actually buys/sells.


document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get Token Address from URL
    const urlParams = new URLSearchParams(window.location.search);
    const tokenAddress = urlParams.get('address');

    if (!tokenAddress) {
        alert("No token address provided!");
        window.location.href = 'markets.html';
        return;
    }

    try {
        // 2. Fetch Data from Supabase (case-insensitive match)
        let tokenData = null;
        try {
            const { data, error } = await supabase
                .from('meme_tokens')
                .select('*')
                .ilike('token_address', tokenAddress)
                .single();
            if (!error && data) {
                tokenData = data;
            }
        } catch(e) {
            console.warn("Supabase fetch failed, falling back...", e);
        }

        // Fallback to Blockchain if Supabase fails
        if (!tokenData) {
            console.warn("Token not found in Supabase. Falling back to Hedera Mirror Node...");
            try {
                const hederaId = evmAddressToHederaId(tokenAddress);
                const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/tokens/${hederaId}`);
                if (response.ok) {
                    const tokenInfo = await response.json();
                    if (tokenInfo) {
                        tokenData = {
                            name: tokenInfo.name,
                            symbol: tokenInfo.symbol,
                            image_url: tokenInfo.memo,
                            creator_address: tokenInfo.treasury_account_id,
                            created_at: new Date(parseFloat(tokenInfo.created_timestamp) * 1000).toISOString()
                        };
                    }
                }
            } catch(e) {
                console.error("Mirror Node fallback failed:", e);
            }
        }

        if (!window.poolAddress) {
            window.poolAddress = MEMEJOB_ADDRESS;
            window.isSDKRouter = true;
        }

        if (!tokenData) {
            console.error("Token not found in Supabase OR Blockchain logs.");
            document.getElementById('coin-loader').innerHTML = `
                <div style="text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                    <h2 style="margin-bottom: 8px;">Token Not Found</h2>
                    <p style="color: var(--text-secondary); margin-bottom: 24px;">The token address you are looking for does not exist or has not been indexed yet.</p>
                    <a href="markets.html" class="trade-submit-btn" style="text-decoration: none; display: inline-block; width: auto; padding: 10px 24px;">Back to Markets</a>
                </div>
            `;
            return;
        }

        // 3. Populate DOM with Token Metadata
        document.getElementById('token-name').textContent = tokenData.name;
        document.getElementById('token-symbol').textContent = tokenData.symbol;
        
        let displayImage = tokenData.image_url && tokenData.image_url.startsWith('http') ? tokenData.image_url : 'https://placehold.co/400x400/1a1a2e/ffd700?text=MEME';
        const localImage = localStorage.getItem(`meme_image_${tokenAddress.toLowerCase()}`);
        if (localImage) {
            displayImage = localImage;
        } else if (tokenData.image_url && tokenData.image_url.startsWith('ipfs://') && !tokenData.image_url.includes('bafybeidmeme')) {
            displayImage = tokenData.image_url.replace('ipfs://', 'https://ipfs.io/ipfs/');
        } else if (tokenData.image_url && (tokenData.image_url.startsWith('Qm') || tokenData.image_url.startsWith('bafy'))) {
            displayImage = `https://ipfs.io/ipfs/${tokenData.image_url}`;
        }
        document.getElementById('token-image').src = displayImage;
        
        const dateObj = new Date(tokenData.created_at);
        document.getElementById('token-created').textContent = `Created ${dateObj.toLocaleDateString()}`;

        document.getElementById('display-contract').textContent = `${tokenAddress.slice(0,6)}...${tokenAddress.slice(-4)}`;
        document.getElementById('display-creator').textContent = `${tokenData.creator_address.slice(0,6)}...${tokenData.creator_address.slice(-4)}`;

        // Provide full copy functionality
        document.getElementById('copy-contract').onclick = () => navigator.clipboard.writeText(tokenAddress);
        document.getElementById('copy-creator').onclick = () => navigator.clipboard.writeText(tokenData.creator_address);

        // Watchlist toggle
        const watchlistBtn = document.getElementById('watchlist-toggle-btn');
        if (watchlistBtn) {
            const setWatchlistState = (active) => watchlistBtn.classList.toggle('active', active);
            setWatchlistState(isWatchlisted(tokenAddress));
            watchlistBtn.onclick = () => setWatchlistState(toggleWatchlist(tokenAddress));
        }

        // Social share buttons
        const shareUrl = window.location.href;
        const shareText = `Check out ${tokenData.name} (${tokenData.symbol.startsWith('$') ? tokenData.symbol : '$' + tokenData.symbol}) on Onyc.meme`;
        const twitterBtn = document.getElementById('share-twitter-btn');
        if (twitterBtn) {
            twitterBtn.onclick = () => window.open(
                `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
                '_blank', 'noopener'
            );
        }
        const telegramBtn = document.getElementById('share-telegram-btn');
        if (telegramBtn) {
            telegramBtn.onclick = () => window.open(
                `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
                '_blank', 'noopener'
            );
        }
        const copyShareBtn = document.getElementById('share-copy-btn');
        if (copyShareBtn) {
            copyShareBtn.onclick = () => {
                navigator.clipboard.writeText(shareUrl);
                copyShareBtn.classList.add('active');
                setTimeout(() => copyShareBtn.classList.remove('active'), 1500);
            };
        }

        // Description and social links were pinned to IPFS at launch time
        // (the on-chain memo points at that JSON) but were never fetched
        // back here - so they were entered at launch and then never shown
        // anywhere. Non-blocking: don't hold up the rest of the page on an
        // IPFS gateway round-trip.
        (async () => {
            try {
                const hederaId = evmAddressToHederaId(tokenAddress);
                const tokenInfoRes = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/tokens/${hederaId}`);
                if (!tokenInfoRes.ok) return;
                const tokenInfo = await tokenInfoRes.json();
                const memo = tokenInfo.memo;
                if (!memo || !memo.startsWith('ipfs://')) return; // fallback (non-IPFS) memo - nothing to show

                const metadataRes = await fetch(`https://ipfs.io/ipfs/${memo.replace('ipfs://', '')}`);
                if (!metadataRes.ok) return;
                const metadata = await metadataRes.json();

                if (metadata.description) {
                    const descElem = document.getElementById('token-description');
                    descElem.textContent = metadata.description;
                    descElem.style.display = 'block';
                }

                const links = {
                    'social-twitter': metadata.properties?.twitter,
                    'social-telegram': metadata.properties?.telegram,
                    'social-website': metadata.properties?.website
                };
                let anyLink = false;
                for (const [id, url] of Object.entries(links)) {
                    if (!url) continue;
                    const elem = document.getElementById(id);
                    elem.href = url.startsWith('http') ? url : `https://${url}`;
                    elem.style.display = 'flex';
                    anyLink = true;
                }
                if (anyLink) {
                    document.getElementById('token-socials').style.display = 'flex';
                }
            } catch (e) {
                console.warn('Could not load description/social links from IPFS metadata:', e);
            }
        })();

        // Hide loader, show content
        document.getElementById('coin-loader').style.display = 'none';
        document.getElementById('coin-content').style.display = 'block';

        // 4. Load real trade history from mirror node logs, then render
        // the chart and the trades table from the same data. Refreshed
        // periodically so the chart and activity list reflect new buys/
        // sells while the page is open, not just a one-time snapshot from
        // page load. 24h volume is derived from this same trade set rather
        // than a separate fetch.
        let chartControls = null;
        try {
            const trades = await fetchTokenTrades(tokenAddress);
            chartControls = initChart(trades);
            renderTradesTable(trades);
            updateVolume24h(trades);
        } catch (e) {
            console.error("Failed to load trade history:", e);
            chartControls = initChart([]);
            renderTradesTable([]);
            updateVolume24h([]);
        }

        // 15m/1h/1d buttons set the candle interval; re-render is instant
        // since it reuses the already-fetched trades rather than refetching.
        const TIMEFRAME_SECONDS = { '15m': 900, '1h': 3600, '1d': 86400 };
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const seconds = TIMEFRAME_SECONDS[btn.textContent.trim()];
                if (!seconds) return;
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                chartControls?.setBucketSeconds(seconds);
            });
        });

        setInterval(async () => {
            try {
                const latestTrades = await fetchTokenTrades(tokenAddress);
                chartControls?.updateTrades(latestTrades);
                renderTradesTable(latestTrades);
                updateVolume24h(latestTrades);
            } catch (e) {
                console.warn("Could not refresh trade activity:", e);
            }
        }, 15000);

        // 5. Load real holder distribution from mirror node
        try {
            const holders = await fetchTokenHolders(evmAddressToHederaId(tokenAddress));
            renderHoldersTable(holders);
        } catch (e) {
            console.error("Failed to load holders:", e);
            renderHoldersTable([]);
        }

        // 6. Setup Trading Logic
        setupTradeInterface(tokenAddress, tokenData);

    } catch (err) {
        console.error(err);
        document.getElementById('coin-loader').innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                <h2 style="margin-bottom: 8px;">Connection Error</h2>
                <p style="color: var(--text-secondary); margin-bottom: 24px;">Failed to load token data from the indexing service.</p>
                <a href="markets.html" class="trade-submit-btn" style="text-decoration: none; display: inline-block; width: auto; padding: 10px 24px;">Back to Markets</a>
            </div>
        `;
    }
});

// Sums HBAR volume (both buys and sells) from trades in the last 24h.
// fetchTokenTrades pages back a bounded number of the shared contract's
// most recent logs (not literally "everything ever"), so for a very
// active token this could undercount slightly if more than that window's
// worth of trades happened in the last 24h - same recency tradeoff already
// accepted elsewhere in this app (leaderboard/markets ranking).
function updateVolume24h(trades) {
    const cutoff = Date.now() / 1000 - 86400;
    const volumeTinybars = trades
        .filter(t => t.timestamp >= cutoff)
        .reduce((sum, t) => sum + Number(t.hbarTinybars), 0);
    const volumeHbar = volumeTinybars / 1e8;
    document.getElementById('stat-volume').textContent =
        `${volumeHbar.toLocaleString(undefined, { maximumFractionDigits: 2 })} HBAR`;
}

// Buckets trades into OHLC candles at the given interval. Price is HBAR
// per token, derived directly from each trade's totalPrice/amount ratio
// (both use the same 8-decimal scaling, so it cancels out of the
// division).
function buildCandles(trades, bucketSeconds) {
    const buckets = new Map();

    for (const trade of trades) {
        const price = Number(trade.hbarTinybars) / Number(trade.tokenAmount);
        const bucketTime = Math.floor(trade.timestamp / bucketSeconds) * bucketSeconds;
        const existing = buckets.get(bucketTime);
        if (!existing) {
            buckets.set(bucketTime, { time: bucketTime, open: price, high: price, low: price, close: price });
        } else {
            existing.high = Math.max(existing.high, price);
            existing.low = Math.min(existing.low, price);
            existing.close = price;
        }
    }

    return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

function initChart(trades) {
    const chartContainer = document.getElementById('tvchart-container');
    const chart = LightweightCharts.createChart(chartContainer, {
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#d1d4dc',
        },
        grid: {
            vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
            horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
        },
        rightPriceScale: {
            borderVisible: false,
        },
        timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: false,
        },
    });

    const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        // Bonding-curve token prices sit around 0.00001-0.0001 HBAR. The
        // default price format (precision: 2, minMove: 0.01) rounds all of
        // that straight to 0.00, which is what made the chart render as a
        // single collapsed bar instead of real candles.
        priceFormat: {
            type: 'price',
            precision: 8,
            minMove: 0.00000001,
        },
    });

    chartContainer.style.position = 'relative';
    const emptyMsg = document.createElement('div');
    emptyMsg.textContent = 'No trades yet';
    emptyMsg.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#94a3b8; pointer-events:none;';

    // Candle interval is controlled by the 15m/1h/1d buttons - re-rendered
    // from the last trade set fetched so switching timeframe is instant
    // and doesn't need a new mirror node round-trip.
    let lastTrades = trades;
    let bucketSeconds = 86400; // matches the "1d" button, active by default

    const render = () => {
        const data = buildCandles(lastTrades, bucketSeconds);
        if (data.length > 0) {
            candlestickSeries.setData(data);
            emptyMsg.remove();
        } else if (!chartContainer.contains(emptyMsg)) {
            chartContainer.appendChild(emptyMsg);
        }
    };
    render();

    // Handle resize
    new ResizeObserver(entries => {
        if (entries.length === 0 || entries[0].target !== chartContainer) { return; }
        const newRect = entries[0].contentRect;
        chart.applyOptions({ height: newRect.height, width: newRect.width });
    }).observe(chartContainer);

    return {
        updateTrades: (currentTrades) => {
            lastTrades = currentTrades;
            render();
        },
        setBucketSeconds: (seconds) => {
            bucketSeconds = seconds;
            render();
        },
    };
}

function timeAgo(timestampSeconds) {
    const diffMs = Date.now() - timestampSeconds * 1000;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

function renderTradesTable(trades) {
    const txBody = document.getElementById('tx-tbody');
    txBody.innerHTML = '';

    if (trades.length === 0) {
        txBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No trades yet</td></tr>';
        return;
    }

    const recent = [...trades].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
    for (const trade of recent) {
        const hbarAmount = (Number(trade.hbarTinybars) / 1e8).toFixed(2);
        const isBuy = trade.type === 'buy';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace;">${trade.trader.slice(0, 6)}...${trade.trader.slice(-4)}</td>
            <td><span class="${isBuy ? 'type-buy' : 'type-sell'}">${isBuy ? 'BUY' : 'SELL'}</span></td>
            <td>${hbarAmount} HBAR</td>
            <td style="color: #94a3b8;">${timeAgo(trade.timestamp)}</td>
        `;
        txBody.appendChild(tr);
    }
}

// Fire-and-forget: award trade-volume points server-side. Never blocks or
// fails the trade UX - the trade itself already succeeded on-chain by the
// time this runs. The server independently re-verifies the trade against
// the mirror node rather than trusting anything sent here (points map to
// a future token airdrop, so the client is never a trusted source for how
// much a trade was actually worth).
function awardPointsForTrade(buyOrSellResult, walletAddress) {
    const txId = buyOrSellResult?.transactionIdOrHash;
    if (!txId || !walletAddress) return;
    fetch('/api/award-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId, walletAddress })
    }).catch(err => console.warn('Award points request failed:', err));
}

function renderHoldersTable(holders) {
    const holdersBody = document.getElementById('holders-tbody');
    holdersBody.innerHTML = '';

    if (holders.length === 0) {
        holdersBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#94a3b8;">No holders yet</td></tr>';
        return;
    }

    holders.forEach((holder, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: #94a3b8;">#${i + 1}</td>
            <td style="font-family: monospace;">${holder.account}</td>
            <td>${holder.percent.toFixed(2)}%</td>
        `;
        holdersBody.appendChild(tr);
    });
}

// Floor on buy size - mainly a spam/wash-trading guard for the points
// system planned on top of transaction activity (a per-trade minimum
// doesn't itself drive more trades, but it stops the count being farmed
// with near-zero trades). Easy to tune.
const MIN_BUY_HBAR = 1;

// Only needed for memejob tokens. The router's getAmountOut always takes
// a TOKEN quantity and returns its HBAR cost (txType 0) or HBAR proceeds
// (txType 1) - there is no "give me tokens for this much HBAR" query on
// memejob, and buyJob itself is called with a token quantity too (the
// SDK's buy() computes and attaches the HBAR cost automatically). So "I
// want to spend X HBAR" has to be solved by searching for the largest
// token quantity whose cost doesn't exceed X - cost is monotonically
// increasing in quantity on a bonding curve, so a bounded binary search
// finds it in a handful of calls. Verified against the live contract:
// budgeting 5 HBAR correctly resolves to ~320,085 tokens (not the ~5
// tokens a naive "amount == HBAR" reading would buy). OnycBondingCurve
// tokens don't need this at all - previewBuy() answers the same question
// directly in one call (see setupTradeInterface's buy branch below).
async function findTokenAmountForHbarBudget(routerContract, tokenAddress, hbarBudgetTinybars) {
    if (hbarBudgetTinybars <= 0n) return 0n;
    const oneTokenCost = await routerContract.getAmountOut(tokenAddress, 100000000n, 0);
    if (oneTokenCost <= 0n) return 0n;

    let hi = (hbarBudgetTinybars * 100000000n) / oneTokenCost * 2n;
    if (hi <= 0n) hi = 100000000n;
    let hiCost = await routerContract.getAmountOut(tokenAddress, hi, 0);
    for (let guard = 0; hiCost <= hbarBudgetTinybars && guard < 10; guard++) {
        hi *= 2n;
        hiCost = await routerContract.getAmountOut(tokenAddress, hi, 0);
    }

    let lo = 0n;
    for (let i = 0; i < 30 && hi - lo > 1n; i++) {
        const mid = (lo + hi) / 2n;
        const cost = await routerContract.getAmountOut(tokenAddress, mid, 0);
        if (cost <= hbarBudgetTinybars) lo = mid; else hi = mid;
    }
    return lo;
}

// HTS requires an account to associate a token before it can receive it -
// a rule OnycBondingCurve can't waive on a user's behalf (memejob tokens
// don't need this handled here; either its contract manages it
// internally or testnet accounts commonly have open auto-association
// slots, and it's been working without any association code in this file
// at all). associateToken is a plain HTS precompile call any account can
// make for itself, so this fits the same window.getUniversalProvider()
// pattern as every other wallet interaction in this file - no need for
// @hashgraph/sdk's native TokenAssociateTransaction.
const HTS_PRECOMPILE_ADDRESS = '0x0000000000000000000000000000000000000167';
const ASSOCIATE_TOKEN_ABI = ["function associateToken(address account, address token) external returns (int64 responseCode)"];

async function isTokenAssociated(userAddress, tokenHederaId) {
    try {
        const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${userAddress}/tokens?token.id=${tokenHederaId}`);
        if (!res.ok) return false;
        const data = await res.json();
        return Array.isArray(data.tokens) && data.tokens.length > 0;
    } catch (e) {
        console.warn('Could not check token association, will attempt to associate defensively:', e);
        return false;
    }
}

async function ensureTokenAssociated(signer, userAddress, tokenAddress) {
    const tokenHederaId = evmAddressToHederaId(tokenAddress);
    if (await isTokenAssociated(userAddress, tokenHederaId)) return;

    // Best-effort: mirror node indexing can lag, so this can fire even
    // when the account is already associated (e.g. via auto-association
    // that hasn't shown up in a query yet) - HTS returns a non-fatal
    // "already associated" code in that case. Don't let a failure here
    // block the trade; the buy() call right after this is the actual
    // authoritative check; it throws its own clear HtsTransferFailed if
    // association is genuinely still missing.
    try {
        const hts = new ethers.Contract(HTS_PRECOMPILE_ADDRESS, ASSOCIATE_TOKEN_ABI, signer);
        const tx = await hts.associateToken(userAddress, tokenAddress);
        await tx.wait();
    } catch (e) {
        console.warn('Token association attempt failed (may already be associated) - proceeding with buy anyway:', e);
    }
}

function setupTradeInterface(tokenAddress, tokenData) {
    let currentMode = 'buy';
    let currentSlippage = 0.01; // 1%

    const tabBuy = document.getElementById('tab-buy');
    const tabSell = document.getElementById('tab-sell');
    const tradeSubmitBtn = document.getElementById('trade-submit-btn');
    const tradeAmount = document.getElementById('trade-amount');
    const tradeReceive = document.getElementById('trade-receive');

    // Resolved from tokenData.router_address (see router-registry.js) -
    // defaults to memejob for any token that predates the migration or
    // came from the mirror-node fallback path (which has no
    // router_address at all).
    const { address: ROUTER_ADDRESS, abi: ROUTER_ABI, isOnycBondingCurve } = getRouterForToken(tokenData);

    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);

    // FUNDING_GOAL is a fixed global constant (same for every token), so it's
    // fetched once and cached rather than on every fetchStats() poll.
    let fundingGoalTinybars = null;

    // The connected wallet's address, cached after the first successful
    // eth_accounts read. fetchStats() polls every 10s, and re-asking the
    // wallet for its accounts on every single poll (rather than just reading
    // the already-known on-chain balance) was hammering the wallet provider
    // with a request it has no real reason to re-answer that often.
    let cachedUserAddress = null;

    // Total supply is fixed by the memejob contract at creation time (every
    // token mints the same amount) and never changes, so it's fetched once
    // here rather than on every fetchStats() poll. Falls back to the
    // contract's known fixed supply if the mirror node lookup fails.
    let totalSupplyWhole = 750000000;
    (async () => {
        try {
            const hederaId = evmAddressToHederaId(tokenAddress);
            const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/tokens/${hederaId}`);
            if (res.ok) {
                const info = await res.json();
                if (info.total_supply) {
                    totalSupplyWhole = Number(info.total_supply) / (10 ** (info.decimals ?? 8));
                }
            }
        } catch (e) {
            console.warn('Could not fetch real total supply for market cap, using fixed default:', e);
        }
    })();

    async function fetchStats() {
        try {
            // Price of exactly one whole token, in tinybars. getAmountOut's
            // `amount` argument is a TOKEN quantity (not HBAR) for txType=0 -
            // it returns how much HBAR is needed to buy that many tokens - so
            // passing 1.0 token (in the token's own 8-decimal units) directly
            // gives the price of one token, no inversion needed. (The previous
            // version divided 1 by this value, which produced a wildly wrong
            // price - e.g. 64,102 HBAR/token for a token that actually trades
            // at ~0.0000156 HBAR/token; verified against the live contract.)
            const oneToken = ethers.parseUnits('1', 8);
            const tinybarsForOneToken = await routerContract.getAmountOut(tokenAddress, oneToken, 0);

            const priceInHbar = Number(tinybarsForOneToken) / 1e8;
            if (priceInHbar > 0) {
                // Hedera's own exchange-rate precompile, not a hardcoded
                // constant - verified against real market price (~$0.071):
                // this tracks it within ~1%, cached internally for a minute.
                const hbarUsdRate = await fetchHbarUsdRate();

                document.getElementById('stat-price-hbar').textContent = `${priceInHbar.toFixed(8)} HBAR`;
                document.getElementById('stat-price-usd').textContent = `$${(priceInHbar * hbarUsdRate).toFixed(8)}`;

                const mcap = priceInHbar * totalSupplyWhole;
                document.getElementById('stat-mcap-hbar').textContent = `${mcap.toLocaleString(undefined, {maximumFractionDigits:0})} HBAR`;
                document.getElementById('stat-mcap-usd').textContent = `$${(mcap * hbarUsdRate).toLocaleString(undefined, {maximumFractionDigits:2})}`;

                // 24h volume is updated separately by updateVolume24h(),
                // driven by the trade-refresh loop that already has the
                // real trade data - no need to duplicate that fetch here.

                const triggered = checkAlerts(tokenAddress, priceInHbar);
                if (triggered.length > 0) {
                    triggered.forEach(a => showAlertToast(a));
                    renderAlertsList();
                }
            }

            // Bonding progress: real fundsRaised/FUNDING_GOAL from the
            // contract (was a hardcoded "6.9%" for every token before -
            // verified against several real tokens: a heavily-traded one
            // shows meaningfully higher progress than freshly-launched ones,
            // confirming this is the real underlying mechanic). Both
            // contracts express these in the same native tinybar scale, so
            // the percentage math itself doesn't change between them - only
            // the function/field names do (memejob's FUNDING_GOAL/fundsRaised
            // vs OnycBondingCurve's fundingGoal/realHbarReserve).
            try {
                let fundsRaisedTinybars;
                if (isOnycBondingCurve) {
                    if (fundingGoalTinybars === null) {
                        fundingGoalTinybars = await routerContract.fundingGoal();
                    }
                    const meme = await routerContract.memeTokens(tokenAddress);
                    fundsRaisedTinybars = meme.realHbarReserve;
                } else {
                    if (fundingGoalTinybars === null) {
                        fundingGoalTinybars = await routerContract.FUNDING_GOAL();
                    }
                    const mapping = await routerContract.addressToMemeTokenMapping(tokenAddress);
                    fundsRaisedTinybars = mapping.fundsRaised;
                }
                const progressPct = fundingGoalTinybars > 0n
                    ? Math.min(100, (Number(fundsRaisedTinybars) / Number(fundingGoalTinybars)) * 100)
                    : 0;
                document.getElementById('stat-progress-value').textContent = `${progressPct.toFixed(progressPct < 1 ? 4 : 1)}%`;
                document.getElementById('progress-bar-fill').style.width = `${progressPct}%`;
            } catch (e) {
                console.warn('Could not fetch bonding progress', e);
            }

            // Was gated on window.ethereum directly, which HashPack's
            // WalletConnect-based connection (window.getUniversalProvider(),
            // the same source used everywhere else in this file, e.g. the
            // trade submit handler below) doesn't necessarily populate - so
            // this silently never ran for anyone connected that way, leaving
            // the sell-tab balance stuck at "0 Tokens" regardless of real
            // holdings. balanceOf is a read, so no signer is needed - just
            // the already-connected account address.
            if (!cachedUserAddress) {
                const walletProvider = typeof window.getUniversalProvider === 'function' ? await window.getUniversalProvider() : window.ethereum;
                if (walletProvider) {
                    try {
                        const accounts = await walletProvider.request({ method: 'eth_accounts' });
                        cachedUserAddress = accounts?.[0] || null;
                    } catch (e) {
                        console.warn("Could not fetch connected account for token balance", e);
                    }
                }
            }
            if (cachedUserAddress) {
                try {
                    const erc20ABI = ["function balanceOf(address owner) view returns (uint256)"];
                    const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, provider);
                    const balance = await tokenContract.balanceOf(cachedUserAddress);
                    window.currentTokenBalance = ethers.formatUnits(balance, 8);

                    if (currentMode === 'sell') {
                        document.getElementById('trade-balance').textContent = `${window.currentTokenBalance} Tokens`;
                    }
                } catch (e) {
                    console.warn("Could not fetch token balance", e);
                }
            }
        } catch(e) {
            console.warn("Failed to fetch live stats", e);
        }
    }

    fetchStats();
    setInterval(fetchStats, 10000); // refresh every 10s

    function renderAlertsList() {
        const list = document.getElementById('alerts-list');
        if (!list) return;
        const active = getAlertsForToken(tokenAddress);

        if (active.length === 0) {
            list.innerHTML = '<li style="color: #94a3b8; font-size: 0.85rem;">No active alerts.</li>';
            return;
        }

        list.innerHTML = '';
        active.forEach(alertItem => {
            const li = document.createElement('li');
            li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 8px; font-size: 0.85rem;';
            li.innerHTML = `
                <span>${alertItem.direction === 'above' ? 'Above' : 'Below'} ${alertItem.targetPrice} HBAR</span>
                <button aria-label="Remove alert" style="background: transparent; border: none; color: #94a3b8; cursor: pointer;">✕</button>
            `;
            li.querySelector('button').addEventListener('click', () => {
                removeAlert(alertItem.id);
                renderAlertsList();
            });
            list.appendChild(li);
        });
    }

    function showAlertToast(alertItem) {
        const toast = document.createElement('div');
        toast.textContent = `🔔 Price ${alertItem.direction === 'above' ? 'rose above' : 'fell below'} ${alertItem.targetPrice} HBAR`;
        toast.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: var(--accent-yellow); color: #000; padding: 14px 20px; border-radius: 10px; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 1000;';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 6000);
    }

    renderAlertsList();

    const alertSetBtn = document.getElementById('alert-set-btn');
    if (alertSetBtn) {
        alertSetBtn.addEventListener('click', () => {
            const priceInput = document.getElementById('alert-target-price');
            const direction = document.getElementById('alert-direction').value;
            const targetPrice = parseFloat(priceInput.value);
            if (!targetPrice || targetPrice <= 0) {
                alert('Enter a valid target price.');
                return;
            }
            addAlert(tokenAddress, targetPrice, direction);
            priceInput.value = '';
            renderAlertsList();
        });
    }

    const labelReceive = document.getElementById('label-receive');

    async function updateReceiveAmount() {
        const amount = parseFloat(tradeAmount.value);
        if (!amount || amount <= 0) {
            tradeReceive.value = '';
            return;
        }

        try {
            if (currentMode === 'buy') {
                if (amount < MIN_BUY_HBAR) {
                    tradeWarning.textContent = `Minimum buy is ${MIN_BUY_HBAR} HBAR.`;
                    tradeWarning.style.display = 'block';
                } else {
                    tradeWarning.style.display = 'none';
                }

                const hbarBudgetTinybars = ethers.parseUnits(amount.toString(), 8);

                if (isOnycBondingCurve) {
                    // previewBuy answers "how many tokens for this much
                    // HBAR" directly and exactly - no approximation needed,
                    // unlike memejob below.
                    labelReceive.textContent = 'Amount to receive';
                    const tokensOut = await routerContract.previewBuy(tokenAddress, hbarBudgetTinybars);
                    tradeReceive.value = ethers.formatUnits(tokensOut, 8);
                } else {
                    // "Amount to pay" is HBAR here, but getAmountOut only ever
                    // takes a TOKEN quantity (see findTokenAmountForHbarBudget
                    // above) - so a live per-keystroke preview can't call it
                    // directly with the HBAR figure. Approximate via the current
                    // spot price (cost of exactly one token) instead; the exact
                    // amount is resolved with a real binary search at submit time.
                    labelReceive.textContent = 'Amount to receive (approx.)';
                    const oneTokenCost = await routerContract.getAmountOut(tokenAddress, 100000000n, 0);
                    if (oneTokenCost > 0n) {
                        const approxTokens = (hbarBudgetTinybars * 100000000n) / oneTokenCost;
                        tradeReceive.value = ethers.formatUnits(approxTokens, 8);
                    } else {
                        tradeReceive.value = '';
                    }
                }
            } else {
                labelReceive.textContent = 'Amount to receive';
                const amountIn = ethers.parseUnits(amount.toString(), 8); // sell amount is already in tokens
                const amountOut = await routerContract.getAmountOut(tokenAddress, amountIn, 1);
                tradeReceive.value = ethers.formatUnits(amountOut, 8);
            }
        } catch(e) {
            tradeReceive.value = '';
        }
    }

    tradeAmount.addEventListener('input', updateReceiveAmount);

    const slippageBtns = document.querySelectorAll('.slippage-btns button');
    slippageBtns.forEach(btn => {
        btn.onclick = () => {
            slippageBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSlippage = parseFloat(btn.textContent) / 100;
        };
    });

    // .max-btn lives in .input-wrapper, a sibling of .percent-btns, not
    // inside it - ".percent-btns button" alone never matched it, so MAX
    // had no click handler despite the logic below already expecting it.
    const percentBtns = document.querySelectorAll('.percent-btns button, .max-btn');
    percentBtns.forEach(btn => {
        btn.onclick = () => {
            let balanceStr = currentMode === 'buy' ? window.currentHbarBalance : window.currentTokenBalance;
            let balance = parseFloat(balanceStr || '0');
            
            if (btn.classList.contains('max-btn') || btn.textContent === 'MAX') {
                tradeAmount.value = balance;
            } else {
                const pct = parseFloat(btn.textContent) / 100;
                tradeAmount.value = (balance * pct).toFixed(4);
            }
            updateReceiveAmount();
        };
    });

    const tradeWarning = document.getElementById('trade-warning');
    const labelPay = document.getElementById('label-pay');

    tabBuy.onclick = () => {
        currentMode = 'buy';
        tabBuy.classList.add('active');
        tabSell.classList.remove('active');
        tradeSubmitBtn.textContent = 'Buy Token';
        tradeSubmitBtn.style.background = '#10b981';
        document.getElementById('trade-balance').textContent = window.currentHbarBalance ? `${window.currentHbarBalance} HBAR` : '0 HBAR';
        tradeAmount.min = String(MIN_BUY_HBAR);
        labelPay.textContent = `Amount to pay (min. ${MIN_BUY_HBAR} HBAR)`;
        updateReceiveAmount();
    };

    tabSell.onclick = () => {
        currentMode = 'sell';
        tabSell.classList.add('active');
        tabBuy.classList.remove('active');
        tradeSubmitBtn.textContent = 'Sell Token';
        tradeSubmitBtn.style.background = '#ef4444';
        document.getElementById('trade-balance').textContent = window.currentTokenBalance ? `${window.currentTokenBalance} Tokens` : '0 Tokens';
        tradeAmount.min = '0';
        labelPay.textContent = 'Amount to pay';
        tradeWarning.style.display = 'none';
        updateReceiveAmount();
    };

    // Buy is the default active tab on load, but its label/min weren't set
    // until a tab was actually clicked - initialize that state now.
    tabBuy.onclick();

    tradeSubmitBtn.onclick = async () => {
        const universalProvider = typeof window.getUniversalProvider === 'function' ? await window.getUniversalProvider() : window.ethereum;
        if (!universalProvider) {
            alert("Please connect a wallet!");
            return;
        }

        const amount = parseFloat(tradeAmount.value);
        if (!amount || amount <= 0) {
            alert("Enter a valid amount!");
            return;
        }

        if (currentMode === 'buy' && amount < MIN_BUY_HBAR) {
            alert(`Minimum buy is ${MIN_BUY_HBAR} HBAR.`);
            return;
        }

        tradeSubmitBtn.textContent = "Processing...";
        tradeSubmitBtn.disabled = true;

        try {
            if (window.ensureHederaTestnet) await window.ensureHederaTestnet();

            const accounts = await universalProvider.request({ method: 'eth_accounts' });
            const userAddress = accounts?.[0];

            if (isOnycBondingCurve) {
                // OnycBondingCurve has no SDK - plain ethers calls against
                // the ABI, same pattern as every other wallet interaction
                // in this file. NOTE: awardPointsForTrade below currently
                // only verifies trades against memejob's contract address
                // (api/award-points.js) - updating it to accept either
                // contract is a separate, not-yet-done phase, so points
                // won't be awarded for these trades yet even though the
                // trade itself works correctly.
                const browserProvider = new ethers.BrowserProvider(universalProvider);
                const signer = await browserProvider.getSigner();
                const routerWithSigner = routerContract.connect(signer);

                if (currentMode === 'buy') {
                    const hbarBudgetTinybars = ethers.parseUnits(amount.toString(), 8);

                    tradeSubmitBtn.textContent = "Checking token association...";
                    await ensureTokenAssociated(signer, userAddress, tokenAddress);

                    const tokensOut = await routerContract.previewBuy(tokenAddress, hbarBudgetTinybars);
                    if (tokensOut <= 0n) {
                        throw new Error("Could not price this buy.");
                    }
                    const slippageBps = BigInt(Math.round(currentSlippage * 10000));
                    const minTokensOut = tokensOut - (tokensOut * slippageBps / 10000n);

                    // Outer transaction value is 18-decimal - Hedera only
                    // rescales to the contract's native 8-decimal tinybars
                    // at the RPC boundary (see contracts/IOnycBondingCurve.sol's
                    // decimals section).
                    const valueForTx = hbarBudgetTinybars * 10n ** 10n;

                    tradeSubmitBtn.textContent = "Confirm in wallet...";
                    const tx = await routerWithSigner.buy(tokenAddress, minTokensOut, { value: valueForTx });
                    await tx.wait();
                    awardPointsForTrade({ transactionIdOrHash: tx.hash }, userAddress);
                } else {
                    const tokenAmountIn = ethers.parseUnits(amount.toString(), 8);

                    tradeSubmitBtn.textContent = "Approve in wallet...";
                    const erc20WithSigner = new ethers.Contract(
                        tokenAddress,
                        ["function approve(address spender, uint256 amount) returns (bool)"],
                        signer
                    );
                    const approveTx = await erc20WithSigner.approve(ROUTER_ADDRESS, tokenAmountIn);
                    await approveTx.wait();

                    const hbarOut = await routerContract.previewSell(tokenAddress, tokenAmountIn);
                    const slippageBps = BigInt(Math.round(currentSlippage * 10000));
                    const minHbarOut = hbarOut - (hbarOut * slippageBps / 10000n);

                    tradeSubmitBtn.textContent = "Confirm in wallet...";
                    const tx = await routerWithSigner.sell(tokenAddress, tokenAmountIn, minHbarOut);
                    await tx.wait();
                    awardPointsForTrade({ transactionIdOrHash: tx.hash }, userAddress);
                }
            } else {
                // Set up MemeJob Client
                const [{ ContractId }, { CONTRACT_DEPLOYMENTS, createAdapter, getChain, MJClient, EvmAdapter }] = await Promise.all([
                    import('@hashgraph/sdk'),
                    import('@buidlerlabs/memejob-sdk-js')
                ]);
                const chain = getChain('testnet');
                const adapter = createAdapter(EvmAdapter, {
                    ethereumProvider: wrapProviderForLegacyFees(universalProvider || window.ethereum)
                });
                const client = new MJClient(adapter, {
                    chain: chain,
                    contractId: ContractId.fromEvmAddress(0, 0, CONTRACT_DEPLOYMENTS.testnet.evmAddress),
                });

                // Need to pass the native HTS address if tokenAddress is EVM
                const targetAddress = evmAddressToHederaId(tokenAddress);

                console.log("Getting token instance from SDK...");
                const mjToken = await client.getToken(targetAddress);

                if (currentMode === 'buy') {
                    // "Amount to pay" is HBAR the user wants to spend, but
                    // buy({amount}) - and the on-chain buyJob it calls - takes a
                    // TOKEN quantity, not HBAR (confirmed against the live
                    // contract). Resolve the token amount that actually costs
                    // (up to) the entered HBAR budget before buying.
                    tradeSubmitBtn.textContent = "Finding best price...";
                    const hbarBudgetTinybars = ethers.parseUnits(amount.toString(), 8);
                    const tokenAmount = await findTokenAmountForHbarBudget(routerContract, tokenAddress, hbarBudgetTinybars);
                    if (tokenAmount <= 0n) {
                        throw new Error("Could not find a valid token amount for that HBAR budget.");
                    }
                    tradeSubmitBtn.textContent = "Confirm in wallet...";
                    console.log("Buying via SDK - HBAR budget:", hbarBudgetTinybars.toString(), "-> token amount:", tokenAmount.toString());
                    const result = await mjToken.buy({
                        amount: tokenAmount
                    });
                    console.log("Buy result:", result);
                    awardPointsForTrade(result, userAddress);
                } else {
                    const amountIn = ethers.parseUnits(amount.toString(), 8); // sell amount is already in tokens
                    console.log("Selling via SDK with amount:", amountIn.toString());
                    const result = await mjToken.sell({
                        amount: amountIn,
                        instant: true
                    });
                    console.log("Sell result:", result);
                    awardPointsForTrade(result, userAddress);
                }
            }

            alert(`SUCCESS! Successfully ${currentMode === 'buy' ? 'bought' : 'sold'} tokens.`);
            tradeAmount.value = '';
            tradeReceive.value = '';
            fetchStats();

        } catch (error) {
            console.error(error);
            alert("Transaction failed: " + (error.message || error));
        } finally {
            tradeSubmitBtn.textContent = currentMode === 'buy' ? 'Buy Token' : 'Sell Token';
            tradeSubmitBtn.disabled = false;
        }
    };
}
