import { 
    TokenCreateTransaction, 
    TransferTransaction, 
    Hbar, 
    AccountId, 
    TokenType, 
    TokenSupplyType,
    TransactionId
} from '@hashgraph/sdk';
import { Interface, parseUnits, BrowserProvider, Contract, parseEther } from 'ethers';

// Global Error Handler for Debugging
window.onerror = function(msg, url, line, col, error) {
    alert(`GLOBAL ERROR: ${msg}\nAt: ${url}:${line}:${col}`);
    return false;
};

// Global check for debugging
console.log("Hedera dot meme script v3.0 (Pure Extension) loaded");

const CONTRACT_ADDRESS_V2 = "0x13d2D2400D001cFE3d4941adf209F71376D3ADF9"; // HTS Contract (Forwards HBAR)
const ABI_V2 = [
    "function createMemeToken(string name, string symbol, int64 initialSupply, string imageUrl) returns (address)",
    "event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl)"
];
document.addEventListener('DOMContentLoaded', async () => {

    // Helper: Bytes to Base64
    function uint8ArrayToBase64(bytes) {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    // Helper Functions
    async function getHederaNativeId(evmAddress) {
        if (!evmAddress) return null;
        // 1. Handle Long-Zero Address automatically
        if (evmAddress.toLowerCase().startsWith('0x000000000000000000000000')) {
            const hexNum = evmAddress.substring(26);
            const accountNum = parseInt(hexNum, 16);
            return `0.0.${accountNum}`;
        }

        // 2. Read from Cache
        const cacheKey = `hedera_id_${evmAddress.toLowerCase()}`;
        const cachedId = localStorage.getItem(cacheKey);
        if (cachedId && !cachedId.toLowerCase().startsWith('0x')) return cachedId;

        // 3. Mirror Node Fetch
        try {
            let response = await fetch(`https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`);
            if (!response.ok) {
                response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`);
            }

            if (response.ok) {
                const data = await response.json();
                if (data.account) {
                    localStorage.setItem(cacheKey, data.account);
                    return data.account;
                }
            }
        } catch (error) {
            console.error("Could not fetch Hedera ID:", error);
        }
        return null;
    }

    let currentUserEvm = null;
    let currentUserNative = null;

    const updateWalletUI = async () => {
        const launchSubmitBtn = document.querySelector('.launch-submit-btn');
        const customWalletBtn = document.getElementById('custom-wallet-btn');
        if (!customWalletBtn) return;

        if (currentUserNative) {
            const copyHtml = `
                <span class="copy-btn" data-address="${currentUserNative}" title="Copy Hedera Address" style="margin-left: 6px; padding: 2px; cursor: pointer; display: inline-flex; align-items: center; opacity: 0.8;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </span>`;
            
            customWalletBtn.innerHTML = `<span id="wallet-balance-display" style="opacity: 0.8; font-weight: normal; margin-right: 6px;">... ℏ</span> ${currentUserNative} ${copyHtml}`;

            // Fetch balance asynchronously
            try {
                const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/balances?account.id=${currentUserNative}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.balances && data.balances.length > 0) {
                        const hbarBalance = (data.balances[0].balance / 100000000).toFixed(2);
                        const balanceDisplay = document.getElementById('wallet-balance-display');
                        if (balanceDisplay) {
                            balanceDisplay.innerText = `${hbarBalance} ℏ |`;
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to fetch balance:", err);
            }

            if (launchSubmitBtn) {
                launchSubmitBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 10.5L21 3"/><path d="M16 3H21V8"/><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg>
                    Launch Meme
                `;
            }
        } else {
            customWalletBtn.innerHTML = `Connect Wallet`;
            if (launchSubmitBtn) {
                launchSubmitBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 10.5L21 3"/><path d="M16 3H21V8"/><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg>
                    Connect Wallet to Launch
                `;
            }
        }

        // Trigger portfolio refresh if the function exists
        if (typeof window.refreshPortfolioUI === 'function') {
            window.refreshPortfolioUI();
        }
    };

    let hashpackProvider = null;
    
    // EIP-6963 Provider Discovery
    window.addEventListener("eip6963:announceProvider", (event) => {
        if (event.detail?.info?.name?.toLowerCase().includes('hashpack')) {
            hashpackProvider = event.detail.provider;
        }
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const getProvider = async () => {
        // Wait briefly in case EIP-6963 is still announcing
        if (!hashpackProvider && !window.ethereum && !window.hashpack) {
            await new Promise(r => setTimeout(r, 500));
        }
        
        if (hashpackProvider) return hashpackProvider;
        if (window.hashpack) return window.hashpack;
        if (window.hashconnect) return window.hashconnect;
        if (window.ethereum?.isHashPack) return window.ethereum;
        if (window.ethereum) return window.ethereum;
        return null;
    };

    const connectWallet = async () => {
        const provider = await getProvider();
        if (!provider) {
            alert("No HashPack provider found. Please ensure the HashPack extension is installed and unlocked.");
            return false;
        }
        
        try {
            const accounts = await provider.request({ method: 'eth_requestAccounts' });
            if (accounts && accounts.length > 0) {
                currentUserEvm = accounts[0];
                currentUserNative = await getHederaNativeId(currentUserEvm);
                updateWalletUI();
                return true;
            }
        } catch (err) {
            console.error("Connection error:", err);
            alert("Failed to connect wallet.");
        }
        return false;
    };

    // Auto-connect on load if already connected previously
    setTimeout(async () => {
        const provider = await getProvider();
        if (provider) {
            try {
                const accounts = await provider.request({ method: 'eth_accounts' });
                if (accounts && accounts.length > 0) {
                    currentUserEvm = accounts[0];
                    currentUserNative = await getHederaNativeId(currentUserEvm);
                    updateWalletUI();
                }
            } catch (e) {
                console.error("Auto-connect check failed", e);
            }
        } else {
            updateWalletUI();
        }
    }, 500);

    // Use Event Delegation for Connect/Launch/Copy
    document.addEventListener('click', async (e) => {
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            e.preventDefault();
            e.stopPropagation();
            const addressToCopy = copyBtn.dataset.address;
            if (addressToCopy) {
                navigator.clipboard.writeText(addressToCopy);
                copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                setTimeout(() => {
                    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                }, 2000);
            }
            return;
        }

        const walletBtn = e.target.closest('#custom-wallet-btn') || e.target.closest('.connect-wallet-trigger');
        if (walletBtn) {
            if (currentUserNative) {
                if (confirm("Disconnect? (Requires clearing cache or locking wallet)")) {
                    currentUserEvm = null;
                    currentUserNative = null;
                    updateWalletUI();
                }
            } else {
                connectWallet();
            }
            return;
        }

        const btn = e.target.closest('.launch-submit-btn');
        if (!btn) return;

        e.preventDefault();
        
        if (!currentUserNative) {
            const connected = await connectWallet();
            if (!connected) return;
        }

        console.log("CRITICAL: Executing Pure Extension Launch v3.0", currentUserNative);

        btn.disabled = true;
        btn.innerHTML = `<span>Preparing Launch...</span>`;

        try {
            const injectedProvider = await getProvider();
            // Check Chain ID before proceeding
            try {
                const chainId = await injectedProvider.request({ method: 'eth_chainId' });
                const parsedChainId = typeof chainId === 'string' && chainId.startsWith('0x') ? parseInt(chainId, 16) : parseInt(chainId, 10);
                if (parsedChainId !== 296) {
                    console.warn(`Chain ID mismatch. Expected 296, got ${chainId}. Continuing anyway...`);
                }
            } catch (e) {
                console.warn("Could not verify chain ID, continuing...", e);
            }

            console.log("CRITICAL: Executing HTS Precompile Launch v4.0", currentUserNative);
            
            const ethersProvider = new BrowserProvider(injectedProvider);
            const signer = await ethersProvider.getSigner();

            // Goal: HTS Token Creation
            console.log("Step 1: HTS Token Creation via Precompile");
            btn.innerHTML = `<span>Approving Meme Launch...</span>`;

            const name = document.getElementById('tokenName')?.value || "My Meme";
            const symbol = document.getElementById('ticker')?.value || "MEME";
            const supplyInput = document.getElementById('initialSupply')?.value || "1000000000";
            let cleanSupply = parseInt(supplyInput.replace(/,/g, '')) || 0;
            cleanSupply = cleanSupply * 100000000; // 8 decimals multiplier
            const memo = `ipfs://bafybeidmeme${Math.random().toString(36).substring(7)}`;

            const contract = new Contract(CONTRACT_ADDRESS_V2, ABI_V2, signer);
            
            // Call the contract without passing any value! This avoids the decimal panic in HashPack.
            const createTx = await contract.createMemeToken(name, symbol, cleanSupply, memo, {
                gasLimit: 3000000 // High gas limit for HTS ops
            });
            
            console.log("Creation Tx Response:", createTx.hash);
            btn.innerHTML = `<span>Finalizing...</span>`;
            
            const receipt = await createTx.wait();
            console.log("Transaction Confirmed:", receipt);

            alert(`SUCCESS! Your Meme Token is live.\nTransaction Hash: ${receipt.hash}`);
            window.location.href = 'markets.html';

        } catch (err) {
            console.error("Native Launch Error:", err);
            alert(`Launch Failed: ${err.message || "User rejected or wallet error"}`);
            btn.disabled = false;
            btn.innerHTML = `<span>Launch Meme</span>`;
        }
    });

    const photoUploadArea = document.getElementById('photo-upload-area');
    const memePhotoInput = document.getElementById('memePhoto');
    const photoPreview = document.getElementById('photo-preview');
    const uploadPlaceholder = document.getElementById('upload-placeholder');

    if (photoUploadArea && memePhotoInput) {
        photoUploadArea.addEventListener('click', () => memePhotoInput.click());

        memePhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    photoPreview.src = event.target.result;
                    photoPreview.style.display = 'block';
                    uploadPlaceholder.style.display = 'none';
                    photoUploadArea.style.borderStyle = 'solid';
                };
                reader.readAsDataURL(file);
            }
        });

        // Drag and drop support
        photoUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            photoUploadArea.style.borderColor = '#FFD700';
            photoUploadArea.style.background = 'rgba(255, 215, 0, 0.05)';
        });

        photoUploadArea.addEventListener('dragleave', () => {
            photoUploadArea.style.borderColor = 'rgba(255, 215, 0, 0.3)';
            photoUploadArea.style.background = 'rgba(255, 255, 255, 0.02)';
        });

        photoUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            photoUploadArea.style.borderColor = 'rgba(255, 215, 0, 0.3)';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                memePhotoInput.files = e.dataTransfer.files;
                const reader = new FileReader();
                reader.onload = (event) => {
                    photoPreview.src = event.target.result;
                    photoPreview.style.display = 'block';
                    uploadPlaceholder.style.display = 'none';
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Portfolio Page Logic
    const portfolioGrid = document.getElementById('portfolio-grid');
    const portfolioStatus = document.getElementById('portfolio-status');
    const profileArea = document.getElementById('profile-area');
    const pfpInput = document.getElementById('pfp-input');
    const pfpUploadBtn = document.getElementById('pfp-upload-btn');
    const pfpImg = document.getElementById('pfp-img');
    const pfpPlaceholder = document.getElementById('pfp-placeholder');

    if (portfolioGrid) {
        window.refreshPortfolioUI = () => {
            if (currentUserNative && currentUserEvm) {
                if (portfolioStatus) portfolioStatus.style.display = 'none';
                if (profileArea) profileArea.style.display = 'block';

                // Load PFP
                const savedPfp = localStorage.getItem(`pfp_${currentUserEvm.toLowerCase()}`);
                if (savedPfp) {
                    pfpImg.src = savedPfp;
                    pfpImg.style.display = 'block';
                    pfpPlaceholder.style.display = 'none';
                }

                loadPortfolio(currentUserEvm);
            } else {
                if (portfolioStatus) portfolioStatus.style.display = 'block';
                if (profileArea) profileArea.style.display = 'none';
                portfolioGrid.innerHTML = '';
            }
        };

        // PFP Upload Logic
        if (pfpUploadBtn && pfpInput) {
            pfpUploadBtn.addEventListener('click', () => pfpInput.click());
            pfpInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const address = currentUserEvm;
                if (!address) return;

                // Show loading state
                pfpPlaceholder.style.opacity = '0.3';

                try {
                    const formData = new FormData();
                    formData.append('image', file);
                    const response = await fetch('https://api.imgbb.com/1/upload?key=6712b7a421b471676e7300c015b6028a', {
                        method: 'POST',
                        body: formData
                    });
                    const data = await response.json();
                    if (data.success) {
                        const url = data.data.url;
                        localStorage.setItem(`pfp_${address.toLowerCase()}`, url);
                        pfpImg.src = url;
                        pfpImg.style.display = 'block';
                        pfpPlaceholder.style.display = 'none';
                    }
                } catch (err) {
                    console.error("PFP upload failed:", err);
                    alert("Failed to upload profile picture.");
                } finally {
                    pfpPlaceholder.style.opacity = '1';
                }
            });
        }
    }

    async function loadPortfolio(userAddress) {
        try {
            console.log("Fetching your memes...", userAddress);
            const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${CONTRACT_ADDRESS_V2}/results/logs?order=desc`);
            if (!response.ok) throw new Error("Failed to fetch logs");

            const data = await response.json();
            const iface = new Interface(ABI_V2);

            portfolioGrid.innerHTML = '';
            let count = 0;

            // Load hidden memes
            const hiddenKey = `hidden_memes_${userAddress.toLowerCase()}`;
            const hiddenMemes = JSON.parse(localStorage.getItem(hiddenKey) || "[]");

            data.logs.forEach(log => {
                try {
                    const parsedLog = iface.parseLog({
                        data: log.data,
                        topics: log.topics
                    });

                    if (parsedLog.name === 'MemeLaunched') {
                        const { creator, tokenAddress, name, symbol, imageUrl } = parsedLog.args;

                        // Check if user is creator AND token isn't hidden
                        if (creator.toLowerCase() === userAddress.toLowerCase() && !hiddenMemes.includes(tokenAddress.toLowerCase())) {
                            count++;

                            const tokenCard = document.createElement('div');
                            tokenCard.className = 'token-card';
                            tokenCard.style.position = 'relative';

                            const displayImage = imageUrl && imageUrl.startsWith('http') ? imageUrl : 'https://placehold.co/400x400/1a1a2e/ffd700?text=MEME';

                            tokenCard.innerHTML = `
                                <!-- Delete Button -->
                                <button class="delete-meme-btn" data-address="${tokenAddress}" style="position: absolute; top: 15px; right: 15px; background: rgba(255, 77, 77, 0.1); border: 1px solid rgba(255, 77, 77, 0.2); color: #ff4d4d; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; transition: all 0.2s ease;">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                                </button>

                                <div class="card-header">
                                    <div class="token-avatar" style="background: url('${displayImage}') center/cover no-repeat; border-radius: 12px; width: 60px; height: 60px; border: 2px solid rgba(255, 215, 0, 0.2);">
                                    </div>
                                    <div class="token-info">
                                        <div class="token-name-row">
                                            <span class="token-name">${name}</span>
                                            <span class="hot-badge" style="background: rgba(74, 222, 128, 0.2); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3);">Founder</span>
                                        </div>
                                        <span class="token-symbol">${symbol.startsWith('$') ? symbol : `$${symbol}`}</span>
                                    </div>
                                </div>
                                <div class="card-stats">
                                    <div class="stat-group">
                                        <span class="stat-label">Token Address</span>
                                        <span class="stat-value" style="font-size: 0.7rem;">${tokenAddress}</span>
                                    </div>
                                    <div class="stat-group">
                                        <span class="stat-label">Platform Fee</span>
                                        <span class="stat-value">1% Paid</span>
                                    </div>
                                </div>
                                <div style="margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                    <a href="https://hashscan.io/testnet/token/${tokenAddress}" target="_blank" class="filter-btn" style="text-align: center; text-decoration: none; padding: 10px; font-size: 0.8rem;">HashScan</a>
                                    <button class="filter-btn" style="padding: 10px; font-size: 0.8rem;" onclick="alert('Trading coming soon!')">Trade</button>
                                </div>
                            `;

                            // Delete Click Handler
                            const deleteBtn = tokenCard.querySelector('.delete-meme-btn');
                            deleteBtn.addEventListener('click', () => {
                                if (confirm(`Hide ${name} from your portfolio? This only hides it from your view, the token still exists on Hedera.`)) {
                                    hiddenMemes.push(tokenAddress.toLowerCase());
                                    localStorage.setItem(hiddenKey, JSON.stringify(hiddenMemes));
                                    tokenCard.style.opacity = '0';
                                    tokenCard.style.transform = 'scale(0.9)';
                                    setTimeout(() => loadPortfolio(userAddress), 300);
                                }
                            });

                            portfolioGrid.appendChild(tokenCard);
                        }
                    }
                } catch (e) { }
            });

            if (count === 0) {
                portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.6;">You haven\'t launched any memes yet. 🚀</div>';
            }
        } catch (error) {
            console.error("Error loading portfolio:", error);
            portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ff4d4d;">Error loading portfolio data.</div>';
        }
    }


    const primaryBtn = document.querySelector('.primary-btn');
    if (primaryBtn) {
        primaryBtn.addEventListener('click', () => {
            alert('Redirecting to trading interface...');
        });
    }

    // Markets Page Logic
    const tokensGrid = document.getElementById('tokens-grid');
    if (tokensGrid) {
        loadMarkets();
    }

    // Leaderboard Page Logic
    const topCreatorsList = document.getElementById('top-creators-list');
    const topMemesList = document.getElementById('top-memes-list');
    if (topCreatorsList && topMemesList) {
        loadLeaderboard();
    }
    async function loadMarkets() {
        try {
            console.log("Fetching launched memes...");
            const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${CONTRACT_ADDRESS_V2}/results/logs?order=desc`);
            if (!response.ok) throw new Error("Failed to fetch logs");

            const data = await response.json();
            const iface = new Interface(ABI_V2);

            // Clear existing placeholders
            tokensGrid.innerHTML = '';

            if (data.logs.length === 0) {
                tokensGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.7;">No tokens launched yet. Be the first!</div>';
                return;
            }

            data.logs.forEach(log => {
                try {
                    const parsedLog = iface.parseLog({
                        data: log.data,
                        topics: log.topics
                    });

                    if (parsedLog.name === 'MemeLaunched') {
                        const { tokenAddress, name, symbol, imageUrl } = parsedLog.args;

                        const tokenCard = document.createElement('a');
                        tokenCard.href = `https://hashscan.io/testnet/token/${tokenAddress}`;
                        tokenCard.target = "_blank";
                        tokenCard.className = 'token-card';

                        // Use stored image or default
                        const displayImage = imageUrl && imageUrl.startsWith('http') ? imageUrl : 'https://placehold.co/400x400/1a1a2e/ffd700?text=MEME';

                        // Fix: Check if symbol already has $
                        const cleanSymbol = symbol.startsWith('$') ? symbol : `$${symbol}`;

                        tokenCard.innerHTML = `
                            <div class="card-header">
                                <div class="token-avatar" style="background: url('${displayImage}') center/cover no-repeat; border-radius: 12px; width: 60px; height: 60px; border: 2px solid rgba(255, 215, 0, 0.2);">
                                </div>
                                <div class="token-info">
                                    <div class="token-name-row">
                                        <span class="token-name">${name}</span>
                                        <span class="hot-badge">New</span>
                                    </div>
                                    <span class="token-symbol">${cleanSymbol}</span>
                                </div>
                            </div>
                            <div class="card-stats">
                                <div class="stat-group">
                                    <span class="stat-label">Address</span>
                                    <span class="stat-value" style="font-size: 0.7rem; opacity: 0.6;">${tokenAddress.substring(0, 10)}...</span>
                                </div>
                                <div class="stat-group">
                                    <span class="stat-label">Initial Supply</span>
                                    <span class="stat-value positive">Verified</span>
                                </div>
                            </div>
                        `;
                        tokensGrid.appendChild(tokenCard);
                    }
                } catch (e) { }
            });
        } catch (error) {
            console.error("Error loading markets:", error);
            tokensGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ff4d4d;">Error loading market data.</div>';
        }
    }

    async function loadLeaderboard() {
        try {
            const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/contracts/${CONTRACT_ADDRESS_V2}/results/logs?order=desc`);
            if (!response.ok) throw new Error("Failed to fetch logs");

            const data = await response.json();
            const iface = new Interface(ABI_V2);

            const creators = {}; // { address: count }
            const memes = [];    // [ { name, symbol, address, imageUrl } ]

            data.logs.forEach(log => {
                try {
                    const parsedLog = iface.parseLog({ data: log.data, topics: log.topics });
                    if (parsedLog.name === 'MemeLaunched') {
                        const { creator, tokenAddress, name, symbol, imageUrl } = parsedLog.args;

                        // Count for creators
                        creators[creator] = (creators[creator] || 0) + 1;

                        // Add to memes list
                        memes.push({ name, symbol, address: tokenAddress, imageUrl });
                    }
                } catch (e) { }
            });

            // 1. Render Top Creators
            const sortedCreators = Object.entries(creators)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);

            topCreatorsList.innerHTML = '';
            for (let i = 0; i < sortedCreators.length; i++) {
                const [address, count] = sortedCreators[i];
                const nativeId = await getHederaNativeId(address) || address.substring(0, 10) + '...';

                const item = document.createElement('div');
                item.className = `list-item ${i === 0 ? 'highlight-gold' : ''}`;
                item.innerHTML = `
                    <div class="item-rank">${i + 1}</div>
                    <div class="item-avatar"><span style="font-size:1.5rem">👤</span></div>
                    <div class="item-info">
                        <div class="item-primary">${nativeId}</div>
                        <div class="item-secondary">Creator</div>
                    </div>
                    <div class="item-stats text-right">
                        <div class="stat-primary text-gold">${count} Memes</div>
                        <div class="stat-secondary">Launched</div>
                    </div>
                `;
                topCreatorsList.appendChild(item);
            }

            // 2. Render Top Memes (By Holders)
            topMemesList.innerHTML = '<div style="text-align: center; padding: 40px; opacity: 0.6;">Fetching holder data...</div>';

            // Fetch holder counts in parallel
            const memeStats = await Promise.all(memes.slice(0, 15).map(async (meme) => {
                try {
                    const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/tokens/${meme.address}/balances?limit=1`);
                    const balanceData = await res.json();
                    return { ...meme, holders: balanceData.balances.length > 0 ? balanceData.balances.length : 0 };
                } catch (e) {
                    return { ...meme, holders: 0 };
                }
            }));

            const sortedMemes = memeStats.sort((a, b) => b.holders - a.holders).slice(0, 10);

            topMemesList.innerHTML = '';
            sortedMemes.forEach((meme, i) => {
                const displayImage = meme.imageUrl && meme.imageUrl.startsWith('http') ? meme.imageUrl : 'https://placehold.co/400x400/1a1a2e/ffd700?text=MEME';

                const item = document.createElement('div');
                item.className = `list-item ${i === 0 ? 'highlight-green' : ''}`;
                item.innerHTML = `
                    <div class="item-rank">${i + 1}</div>
                    <div class="item-avatar-square" style="background: url('${displayImage}') center/cover no-repeat; width: 40px; height: 40px; border-radius: 8px;"></div>
                    <div class="item-info">
                        <div class="item-primary">${meme.name}</div>
                        <div class="item-secondary">${meme.symbol}</div>
                    </div>
                    <div class="item-stats text-right">
                        <div class="stat-primary text-green">${meme.holders} Holders</div>
                        <div class="stat-secondary">Live Data</div>
                    </div>
                `;
                topMemesList.appendChild(item);
            });

        } catch (error) {
            console.error("Error loading leaderboard:", error);
            topCreatorsList.innerHTML = '<div style="color: #ff4d4d; padding: 20px;">Error loading data.</div>';
            topMemesList.innerHTML = '<div style="color: #ff4d4d; padding: 20px;">Error loading data.</div>';
        }
    }



    const secondaryBtn = document.querySelector('.secondary-btn');
    if (secondaryBtn) {
        secondaryBtn.addEventListener('click', () => {
            window.location.href = 'launch.html';
        });
    }

    // Dropdown Logic
    const tradeDropdownBtn = document.getElementById('tradeDropdownBtn');
    const tradeDropdownMenu = document.getElementById('tradeDropdownMenu');

    if (tradeDropdownBtn && tradeDropdownMenu) {
        tradeDropdownBtn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent jump to top
            tradeDropdownMenu.classList.toggle('active');
        });

        // Close the dropdown if the user clicks outside of it
        document.addEventListener('click', (e) => {
            if (!tradeDropdownBtn.contains(e.target) && !tradeDropdownMenu.contains(e.target)) {
                tradeDropdownMenu.classList.remove('active');
            }
        });
    }
});
