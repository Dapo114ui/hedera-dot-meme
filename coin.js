import { supabase } from './supabase.js';
import { ethers } from 'ethers';
import { evmAddressToHederaId, fetchTokenTrades, fetchTokenHolders } from './mirror-trades.js';
import { isWatchlisted, toggleWatchlist } from './watchlist.js';

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
            window.poolAddress = "0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8";
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

        // Hide loader, show content
        document.getElementById('coin-loader').style.display = 'none';
        document.getElementById('coin-content').style.display = 'block';

        // 4. Load real trade history from mirror node logs, then render
        // the chart and the trades table from the same data.
        try {
            const trades = await fetchTokenTrades(tokenAddress);
            initChart(trades);
            renderTradesTable(trades);
        } catch (e) {
            console.error("Failed to load trade history:", e);
            initChart([]);
            renderTradesTable([]);
        }

        // 5. Load real holder distribution from mirror node
        try {
            const holders = await fetchTokenHolders(evmAddressToHederaId(tokenAddress));
            renderHoldersTable(holders);
        } catch (e) {
            console.error("Failed to load holders:", e);
            renderHoldersTable([]);
        }

        // 6. Setup Trading Logic
        setupTradeInterface(tokenAddress);

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

// Buckets trades into hourly OHLC candles. Price is HBAR per token,
// derived directly from each trade's totalPrice/amount ratio (both use
// the same 8-decimal scaling, so it cancels out of the division).
function buildCandles(trades) {
    const bucketSeconds = 3600;
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
    });

    const data = buildCandles(trades);
    if (data.length > 0) {
        candlestickSeries.setData(data);
    } else {
        chartContainer.style.position = 'relative';
        const emptyMsg = document.createElement('div');
        emptyMsg.textContent = 'No trades yet';
        emptyMsg.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#94a3b8; pointer-events:none;';
        chartContainer.appendChild(emptyMsg);
    }

    // Handle resize
    new ResizeObserver(entries => {
        if (entries.length === 0 || entries[0].target !== chartContainer) { return; }
        const newRect = entries[0].contentRect;
        chart.applyOptions({ height: newRect.height, width: newRect.width });
    }).observe(chartContainer);
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

function setupTradeInterface(tokenAddress) {
    let currentMode = 'buy';
    let currentSlippage = 0.01; // 1%
    
    const tabBuy = document.getElementById('tab-buy');
    const tabSell = document.getElementById('tab-sell');
    const tradeSubmitBtn = document.getElementById('trade-submit-btn');
    const tradeAmount = document.getElementById('trade-amount');
    const tradeReceive = document.getElementById('trade-receive');
    
    const ROUTER_ADDRESS = "0xa3bf9adec2fb49fb65c8948aed71c6bf1c4d61c8";
    const ROUTER_ABI = [
        "function buyJob(address memeAddress, uint256 amountOutMin, address referrer) external payable",
        "function sellJob(address memeAddress, uint256 amountIn) external",
        "function getAmountOut(address memeAddress, uint256 amount, uint8 txType) view returns (uint256 value)"
    ];

    const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);

    async function fetchStats() {
        try {
            // Get price: how many tokens 1 HBAR (10^8) buys. txType = 0 for buy
            const oneHbar = ethers.parseUnits('1', 8);
            const tokensForOneHbar = await routerContract.getAmountOut(tokenAddress, oneHbar, 0);
            
            const tokensAmount = Number(ethers.formatUnits(tokensForOneHbar, 8));
            if (tokensAmount > 0) {
                const priceInHbar = 1.0 / tokensAmount;
                
                document.getElementById('stat-price-hbar').textContent = `${priceInHbar.toFixed(8)} ℏ`;
                document.getElementById('stat-price-usd').textContent = `$${(priceInHbar * 0.05).toFixed(8)}`;
                
                const mcap = priceInHbar * 1000000000;
                document.getElementById('stat-mcap-hbar').textContent = `${mcap.toLocaleString(undefined, {maximumFractionDigits:0})} ℏ`;
                document.getElementById('stat-mcap-usd').textContent = `$${(mcap * 0.05).toLocaleString(undefined, {maximumFractionDigits:2})}`;
                
                document.getElementById('stat-volume').textContent = `--- ℏ`;
            }

            if (window.ethereum) {
                const ethProvider = new ethers.BrowserProvider(window.ethereum);
                const signer = await ethProvider.getSigner();
                const userAddress = await signer.getAddress();
                
                const erc20ABI = ["function balanceOf(address owner) view returns (uint256)"];
                const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, provider);
                const balance = await tokenContract.balanceOf(userAddress);
                window.currentTokenBalance = ethers.formatUnits(balance, 8);
                
                if (currentMode === 'sell') {
                    document.getElementById('trade-balance').textContent = `${window.currentTokenBalance} Tokens`;
                }
            }
        } catch(e) {
            console.warn("Failed to fetch live stats", e);
        }
    }

    fetchStats();
    setInterval(fetchStats, 10000); // refresh every 10s

    async function updateReceiveAmount() {
        const amount = parseFloat(tradeAmount.value);
        if (!amount || amount <= 0) {
            tradeReceive.value = '';
            return;
        }

        try {
            const amountIn = ethers.parseUnits(amount.toString(), 8); // Assuming 8 decimals for HBAR and Token
            let amountOut;
            if (currentMode === 'buy') {
                amountOut = await routerContract.getAmountOut(tokenAddress, amountIn, 0);
            } else {
                amountOut = await routerContract.getAmountOut(tokenAddress, amountIn, 1);
            }
            tradeReceive.value = ethers.formatUnits(amountOut, 8);
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

    const percentBtns = document.querySelectorAll('.percent-btns button');
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

    tabBuy.onclick = () => {
        currentMode = 'buy';
        tabBuy.classList.add('active');
        tabSell.classList.remove('active');
        tradeSubmitBtn.textContent = 'Buy Token';
        tradeSubmitBtn.style.background = '#10b981';
        document.getElementById('trade-balance').textContent = window.currentHbarBalance ? `${window.currentHbarBalance} HBAR` : '0 HBAR';
        updateReceiveAmount();
    };

    tabSell.onclick = () => {
        currentMode = 'sell';
        tabSell.classList.add('active');
        tabBuy.classList.remove('active');
        tradeSubmitBtn.textContent = 'Sell Token';
        tradeSubmitBtn.style.background = '#ef4444';
        document.getElementById('trade-balance').textContent = window.currentTokenBalance ? `${window.currentTokenBalance} Tokens` : '0 Tokens';
        updateReceiveAmount();
    };

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

        tradeSubmitBtn.textContent = "Processing...";
        tradeSubmitBtn.disabled = true;

        try {
            if (window.ensureHederaTestnet) await window.ensureHederaTestnet();

            // Set up MemeJob Client
            const [{ ContractId }, { CONTRACT_DEPLOYMENTS, createAdapter, getChain, MJClient, EvmAdapter }] = await Promise.all([
                import('@hashgraph/sdk'),
                import('@buidlerlabs/memejob-sdk-js')
            ]);
            const chain = getChain('testnet');
            const adapter = createAdapter(EvmAdapter, {
                ethereumProvider: universalProvider || window.ethereum
            });
            const client = new MJClient(adapter, {
                chain: chain,
                contractId: ContractId.fromEvmAddress(0, 0, CONTRACT_DEPLOYMENTS.testnet.evmAddress),
            });

            // Need to pass the native HTS address if tokenAddress is EVM
            const targetAddress = evmAddressToHederaId(tokenAddress);

            console.log("Getting token instance from SDK...");
            const mjToken = await client.getToken(targetAddress);

            const amountIn = ethers.parseUnits(amount.toString(), 8); // Always 8 decimals for Hedera native

            if (currentMode === 'buy') {
                console.log("Buying via SDK with amount:", amountIn.toString());
                const result = await mjToken.buy({
                    amount: amountIn
                });
                console.log("Buy result:", result);
            } else {
                console.log("Selling via SDK with amount:", amountIn.toString());
                const result = await mjToken.sell({
                    amount: amountIn,
                    instant: true
                });
                console.log("Sell result:", result);
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
