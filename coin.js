import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { Interface } from 'ethers';

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
        // Initialize Supabase
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        
        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Supabase Environment Variables are missing! Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in Vercel.");
        }
        
        const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
            console.warn("Token not found in Supabase. Falling back to Hedera Mirror Node Logs...");
            try {
                const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/0x9A78619072d24d26e6c3159B4E52D4D3f5D6990a/results/logs?order=desc`);
                if (response.ok) {
                    const logsData = await response.json();
                    const iface = new Interface([
                        "event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl)"
                    ]);
                    for (const log of logsData.logs) {
                        try {
                            const parsedLog = iface.parseLog({ data: log.data, topics: log.topics });
                            if (parsedLog && parsedLog.name === 'MemeLaunched' && parsedLog.args.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()) {
                                tokenData = {
                                    name: parsedLog.args.name,
                                    symbol: parsedLog.args.symbol,
                                    image_url: parsedLog.args.imageUrl,
                                    creator_address: parsedLog.args.creator,
                                    created_at: new Date(parseFloat(log.timestamp) * 1000).toISOString()
                                };
                                break;
                            }
                        } catch(e) {}
                    }
                }
            } catch(e) {
                console.error("Mirror Node fallback failed:", e);
            }
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
            displayImage = tokenData.image_url.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/');
        }
        document.getElementById('token-image').src = displayImage;
        
        const dateObj = new Date(tokenData.created_at);
        document.getElementById('token-created').textContent = `Created ${dateObj.toLocaleDateString()}`;

        document.getElementById('display-contract').textContent = `${tokenAddress.slice(0,6)}...${tokenAddress.slice(-4)}`;
        document.getElementById('display-creator').textContent = `${tokenData.creator_address.slice(0,6)}...${tokenData.creator_address.slice(-4)}`;

        // Provide full copy functionality
        document.getElementById('copy-contract').onclick = () => navigator.clipboard.writeText(tokenAddress);
        document.getElementById('copy-creator').onclick = () => navigator.clipboard.writeText(tokenData.creator_address);

        // Hide loader, show content
        document.getElementById('coin-loader').style.display = 'none';
        document.getElementById('coin-content').style.display = 'block';

        // 4. Initialize Lightweight Charts with Dummy Data
        initChart();
        
        // 5. Populate Dummy Tables
        populateDummyTables();

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

function initChart() {
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

    // Generate some dummy candlestick data
    const data = [];
    let currentPrice = 0.00000077;
    let time = Math.floor(Date.now() / 1000) - (86400 * 30); // 30 days ago

    for (let i = 0; i < 100; i++) {
        time += 86400; // +1 day
        const open = currentPrice;
        const close = currentPrice * (1 + (Math.random() - 0.45) * 0.1); // slight upward bias
        const high = Math.max(open, close) * (1 + Math.random() * 0.05);
        const low = Math.min(open, close) * (1 - Math.random() * 0.05);
        
        data.push({ time, open, high, low, close });
        currentPrice = close;
    }

    candlestickSeries.setData(data);
    
    // Update stat card dynamically
    document.getElementById('stat-price').textContent = `$${currentPrice.toFixed(8)}`;
    document.getElementById('stat-mcap').textContent = `$${(currentPrice * 1000000000).toLocaleString()}`; // assuming 1B supply
    document.getElementById('stat-volume').textContent = `$${(Math.random() * 50000 + 10000).toLocaleString(undefined, {maximumFractionDigits:0})}`;

    // Handle resize
    new ResizeObserver(entries => {
        if (entries.length === 0 || entries[0].target !== chartContainer) { return; }
        const newRect = entries[0].contentRect;
        chart.applyOptions({ height: newRect.height, width: newRect.width });
    }).observe(chartContainer);
}

function populateDummyTables() {
    // Transactions
    const txBody = document.getElementById('tx-tbody');
    for (let i = 0; i < 10; i++) {
        const isBuy = Math.random() > 0.5;
        const amount = (Math.random() * 100).toFixed(2);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace;">0x${Math.random().toString(16).substr(2,6)}...</td>
            <td><span class="${isBuy ? 'type-buy' : 'type-sell'}">${isBuy ? 'BUY' : 'SELL'}</span></td>
            <td>${amount} HBAR</td>
            <td style="color: #94a3b8;">${Math.floor(Math.random() * 60)} mins ago</td>
        `;
        txBody.appendChild(tr);
    }

    // Holders
    const holdersBody = document.getElementById('holders-tbody');
    let totalPct = 100;
    for (let i = 1; i <= 10; i++) {
        const pct = i === 1 ? 45.2 : (Math.random() * (totalPct / i)).toFixed(2);
        totalPct -= pct;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: #94a3b8;">#${i}</td>
            <td style="font-family: monospace;">0x${Math.random().toString(16).substr(2,6)}...</td>
            <td>${pct}%</td>
        `;
        holdersBody.appendChild(tr);
    }
}

function setupTradeInterface(tokenAddress) {
    let currentMode = 'buy';
    
    const tabBuy = document.getElementById('tab-buy');
    const tabSell = document.getElementById('tab-sell');
    const tradeSubmitBtn = document.getElementById('trade-submit-btn');
    const tradeAmount = document.getElementById('trade-amount');

    tabBuy.onclick = () => {
        currentMode = 'buy';
        tabBuy.classList.add('active');
        tabSell.classList.remove('active');
        tradeSubmitBtn.textContent = 'Buy Token';
        tradeSubmitBtn.style.background = '#10b981';
        document.getElementById('trade-balance').textContent = '1000 HBAR';
    };

    tabSell.onclick = () => {
        currentMode = 'sell';
        tabSell.classList.add('active');
        tabBuy.classList.remove('active');
        tradeSubmitBtn.textContent = 'Sell Token';
        tradeSubmitBtn.style.background = '#ef4444';
        document.getElementById('trade-balance').textContent = '500,000 Tokens';
    };

    // Smart Contract Interaction Mockup
    tradeSubmitBtn.onclick = async () => {
        if (!window.ethereum) {
            alert("Please install HashPack or MetaMask!");
            return;
        }

        const amount = tradeAmount.value;
        if (!amount || amount <= 0) {
            alert("Enter a valid amount!");
            return;
        }

        tradeSubmitBtn.textContent = "Processing...";
        tradeSubmitBtn.disabled = true;

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            
            // NOTE: Here we will connect directly to the V3 Token Contract
            // For now, we simulate a successful transaction
            await new Promise(r => setTimeout(r, 2000));

            /* 
            const contractABI = [ ... ];
            const contract = new ethers.Contract(tokenAddress, contractABI, signer);
            if (currentMode === 'buy') {
                const tx = await contract.buyTokens({ value: ethers.parseEther(amount) });
                await tx.wait();
            } else {
                const tx = await contract.sellTokens(ethers.parseUnits(amount, 18));
                await tx.wait();
            }
            */
           
            alert(`SUCCESS! Successfully ${currentMode === 'buy' ? 'bought' : 'sold'} tokens.`);
            tradeAmount.value = '';

        } catch (error) {
            console.error(error);
            alert("Transaction failed: " + error.message);
        } finally {
            tradeSubmitBtn.textContent = currentMode === 'buy' ? 'Buy Token' : 'Sell Token';
            tradeSubmitBtn.disabled = false;
        }
    };
}
