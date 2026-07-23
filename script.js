import { Buffer } from 'buffer';
import { supabase } from './supabase.js';
import { formatUnits } from 'ethers';
import { appkit } from './wallet.js';
import { evmAddressToHederaId, fetchTopTokensByVolume, fetchTokenMarketStats } from './mirror-trades.js';
import { isWatchlisted, toggleWatchlist } from './watchlist.js';
import { wrapProviderForLegacyFees } from './provider-fee-fix.js';

// @hashgraph/sdk and @buidlerlabs/memejob-sdk-js (which pulls in viem) are
// ~3.5MB combined - dynamically imported only where actually needed (the
// launch handler below) so pages that never launch a token don't pay for it.

let selectedMemeFile = null;

// Global Error Handler for Debugging
window.onerror = function(msg, url, line, col, error) {
    alert(`GLOBAL ERROR: ${msg}\nAt: ${url}:${line}:${col}`);
    return false;
};

// Global check for debugging
console.log("Onyc.meme script v6.0 (Pure ERC20 Contract) loaded!");

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
        if (/^0\.0\.\d+$/.test(evmAddress)) return evmAddress;
        
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
                        window.currentHbarBalance = hbarBalance;
                        
                        const balanceDisplay = document.getElementById('wallet-balance-display');
                        if (balanceDisplay) {
                            balanceDisplay.innerText = `${hbarBalance} ℏ |`;
                        }
                        
                        // Dynamically update trade panel balance if on coin page
                        const tradeBalance = document.getElementById('trade-balance');
                        if (tradeBalance && tradeBalance.textContent.includes('HBAR')) {
                            tradeBalance.textContent = `${hbarBalance} HBAR`;
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
    
    // EIP-6963 Provider Discovery (Passive listen only, no active dispatch)
    window.addEventListener("eip6963:announceProvider", (event) => {
        if (event.detail?.info?.name?.toLowerCase().includes('hashpack')) {
            hashpackProvider = event.detail.provider;
        }
    });

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

    // Expose for other modules like coin.js
    window.getUniversalProvider = async () => {
        let universalProvider = null;
        if (appkit && typeof appkit.getProvider === 'function') {
            universalProvider = appkit.getProvider('eip155') || appkit.getProvider('hedera');
        }
        if (!universalProvider) {
            universalProvider = await getProvider();
        }
        return universalProvider;
    };

    const connectWallet = async () => {
        try {
            if (!appkit) throw new Error("AppKit failed to initialize on page load");
            if (typeof appkit.open === 'function') {
                await appkit.open();
                return true;
            } else {
                throw new Error("appkit.open is not a function");
            }
        } catch (err) {
            console.error("Connection error:", err);
            alert("Failed to connect wallet: " + err.message);
        }
        return false;
    };

    const syncAppKitState = async () => {
        try {
            let isConnected = false;
            let address = null;

            try {
                if (appkit && typeof appkit.getAccount === 'function') {
                    const account = appkit.getAccount();
                    isConnected = account.isConnected;
                    address = account.address;
                }
            } catch (internalErr) {
                console.warn("AppKit getAccount internal error:", internalErr);
            }

            if (!isConnected && appkit) {
                isConnected = appkit.getIsConnectedState ? appkit.getIsConnectedState() : (appkit.getIsConnected ? appkit.getIsConnected() : false);
                address = appkit.getAddress ? appkit.getAddress() : null;
            }

            if (!isConnected && window.ethereum && window.ethereum.selectedAddress) {
                isConnected = true;
                address = window.ethereum.selectedAddress;
            }


            if (address) {
                // Forcefully strip CAIP-10 prefixes via Regex
                address = address.replace(/eip155:/gi, '').replace(/hedera:/gi, '').replace(/testnet:/gi, '').replace(/mainnet:/gi, '');
                if (address.includes(':')) {
                    const parts = address.split(':');
                    address = parts[parts.length - 1];
                }
            }
            
            if (isConnected && address) {
                currentUserEvm = address;
                
                try {
                    currentUserNative = await getHederaNativeId(address);
                } catch(e) {
                    console.warn("getHederaNativeId threw an error:", e);
                }

                // UI Fallback: If mirror node lookup fails, use the raw address
                if (!currentUserNative) {
                    if (address.startsWith('0x') && address.length > 20) {
                        currentUserNative = address.substring(0, 5) + '...' + address.substring(address.length - 4);
                    } else {
                        currentUserNative = address;
                    }
                }

                console.log('Parsed ID:', currentUserNative, '| EVM:', address);
            } else {
                console.log('Wallet disconnected or missing address:', { isConnected, address });
                currentUserEvm = null;
                currentUserNative = null;
            }
        } catch (e) {
            console.warn("AppKit state sync error:", e);
            currentUserEvm = null;
            currentUserNative = null;
        }
        
        console.log("updateWalletUI about to run. State:", {
            currentUserEvm,
            currentUserNative,
            btnFound: !!document.getElementById('custom-wallet-btn')
        });
        updateWalletUI();
    };

    try {
        if (appkit && typeof appkit.subscribeAccount === 'function') {
            appkit.subscribeAccount(syncAppKitState);
            console.log("Subscribed to appkit account changes.");
        } else {
            console.warn("appkit.subscribeAccount is not available.");
        }
    } catch (e) {
        console.error("Failed to subscribe to AppKit:", e);
    }
    
    // Initial sync
    try {
        setTimeout(syncAppKitState, 500);
    } catch (e) {
        console.error("Initial sync error:", e);
    }

    // Explicitly bind the wallet connection logic strictly by ID/class to avoid global popup spam
    const customWalletBtn = document.getElementById('custom-wallet-btn');
    if (customWalletBtn) {
        customWalletBtn.addEventListener('click', async (e) => {
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

            e.preventDefault();
            if (currentUserNative) {
                if (confirm("Disconnect?")) {
                    try { await appkit.disconnect(); } catch(err){}
                    currentUserEvm = null;
                    currentUserNative = null;
                    updateWalletUI();
                }
            } else {
                connectWallet();
            }
        });
    }

    document.querySelectorAll('.connect-wallet-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!currentUserNative) connectWallet();
        });
    });

    // Mobile nav menu toggle
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const navLinksEl = document.querySelector('.nav-links');
    if (mobileMenuToggle && navLinksEl) {
        mobileMenuToggle.addEventListener('click', () => {
            navLinksEl.classList.toggle('mobile-open');
        });
        navLinksEl.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => navLinksEl.classList.remove('mobile-open'));
        });
    }

    // Explicitly bind the launch submit button
    const launchSubmitBtnElem = document.querySelector('.launch-submit-btn');
    if (launchSubmitBtnElem) {
        launchSubmitBtnElem.addEventListener('click', async (e) => {
            e.preventDefault();
            
            if (!currentUserNative) {
                const connected = await connectWallet();
                if (!connected) return;
            }

            console.log("CRITICAL: Executing Pure Extension Launch v3.0", currentUserNative);

            const btn = launchSubmitBtnElem;
            btn.disabled = true;
            btn.innerHTML = `<span>Preparing Launch...</span>`;

        try {
            console.log("CRITICAL: Executing Native Launch via UniversalProvider v5.0", currentUserNative);
            const name = document.getElementById('tokenName')?.value || "My Awesome Meme";
            const symbol = document.getElementById('ticker')?.value || "$MEME";
            const supplyInput = document.getElementById('initialSupply')?.value || "1000000000";
            const cleanSupply = parseInt(supplyInput.replace(/,/g, '')) || 0;
            
            const desc = document.getElementById('tokenDescription')?.value || "";
            const twitter = document.getElementById('socialTwitter')?.value || "";
            const telegram = document.getElementById('socialTelegram')?.value || "";
            const website = document.getElementById('socialWebsite')?.value || "";
            
            let memo = '';
            let finalDbImageUrl = '';
            let imageUri = null; // real ipfs:// image URI, only set if the image pin succeeded
            let ipfsPinSucceeded = false; // whether the JSON metadata (the on-chain memo) is real

            if (selectedMemeFile) {
                btn.innerHTML = `<span>Uploading Image...</span>`;
                const formData = new FormData();
                formData.append('file', selectedMemeFile);
                try {
                    // Upload Image (via serverless proxy so the Pinata JWT never reaches the browser)
                    const imgRes = await fetch('/api/pinata-upload', {
                        method: 'POST',
                        body: formData
                    });
                    const imgData = await imgRes.json();
                    if (imgData?.IpfsHash) {
                        imageUri = `ipfs://${imgData.IpfsHash}`;
                        finalDbImageUrl = `https://ipfs.io/ipfs/${imgData.IpfsHash}`;
                    } else {
                        console.warn("Pinata image upload failed (no hash returned).");
                    }
                } catch (err) {
                    console.error("Pinata image upload failed:", err);
                }
            }

            // Always attempt to pin JSON metadata (with or without an image) -
            // this becomes the on-chain memo, so it needs to be real content,
            // not a fake placeholder.
            btn.innerHTML = `<span>Uploading Metadata...</span>`;
            try {
                const jsonMetadata = {
                    name: name,
                    description: desc,
                    image: imageUri || undefined,
                    properties: {
                        twitter: twitter,
                        telegram: telegram,
                        website: website
                    }
                };

                const jsonRes = await fetch('/api/pinata-metadata', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pinataContent: jsonMetadata,
                        pinataMetadata: { name: `${symbol}_metadata.json` }
                    })
                });
                const jsonData = await jsonRes.json();
                if (jsonData?.IpfsHash) {
                    memo = `ipfs://${jsonData.IpfsHash}`;
                    ipfsPinSucceeded = true;
                } else {
                    console.warn("Pinata metadata upload failed (no hash returned).");
                }
            } catch (err) {
                console.error("Pinata metadata upload failed:", err);
            }

            if (!ipfsPinSucceeded) {
                // Honest, short fallback. Hedera memos are capped at 100 bytes,
                // and this deliberately does NOT look like a real IPFS pointer.
                const fallback = (desc || name || symbol || 'Meme token').trim();
                memo = fallback.length > 90 ? fallback.slice(0, 90) : fallback;
            }

            btn.innerHTML = `<span>Approving Meme Launch...</span>`;

            if (window.ensureHederaTestnet) await window.ensureHederaTestnet();

            // Setup MJClient
            const [{ ContractId }, { CONTRACT_DEPLOYMENTS, createAdapter, getChain, MJClient, EvmAdapter }] = await Promise.all([
                import('@hashgraph/sdk'),
                import('@buidlerlabs/memejob-sdk-js')
            ]);
            const chain = getChain('testnet');
            const universalProvider = await window.getUniversalProvider();
            if (!universalProvider) throw new Error("Wallet provider not initialized or not found.");
            const adapter = createAdapter(EvmAdapter, {
                ethereumProvider: wrapProviderForLegacyFees(universalProvider || window.ethereum)
            });
            const client = new MJClient(adapter, {
                chain: chain,
                contractId: ContractId.fromEvmAddress(0, 0, CONTRACT_DEPLOYMENTS.testnet.evmAddress),
            });

            console.log("Creating Token with SDK...");
            const mjToken = await client.createToken({
                name: name,
                symbol: symbol,
                memo: memo
            }, {
                amount: 500000000n // 5 HBAR in tinybars to act as initial buy buffer and prevent OVERFLOW(17)
            });
            
            console.log("Token Created!", mjToken.tokenId);
            const tokenIdStr = mjToken.tokenId.toString();
            const parts = tokenIdStr.split('.');
            let newTokenAddress = `0x000000000000000000000000${parseInt(parts[2]).toString(16).padStart(16, '0')}`;

            // Fire-and-forget: treasury acquires 1% of supply server-side.
            // Never blocks or fails the user's launch flow.
            fetch('/api/treasury-buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenId: tokenIdStr })
            }).catch(err => console.warn('Treasury buy request failed:', err));

            btn.innerHTML = `<span>Finalizing...</span>`;

            if (selectedMemeFile && newTokenAddress !== "Unknown") {
                try {
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const img = new Image();
                            img.onload = () => {
                                const canvas = document.createElement('canvas');
                                const MAX_SIZE = 300;
                                let width = img.width;
                                let height = img.height;
                                if (width > height) {
                                    if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                                } else {
                                    if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
                                }
                                canvas.width = width;
                                canvas.height = height;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(img, 0, 0, width, height);
                                resolve(canvas.toDataURL('image/jpeg', 0.8));
                            };
                            img.onerror = reject;
                            img.src = e.target.result;
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(selectedMemeFile);
                    });
                    
                    try {
                        localStorage.setItem(`meme_image_${newTokenAddress.toLowerCase()}`, dataUrl);
                    } catch(err) { console.warn("localStorage full"); }
                    
                    // If the image itself didn't pin to IPFS, use the compressed
                    // Base64 copy for Supabase so the token's image still displays.
                    if (!imageUri) {
                        finalDbImageUrl = dataUrl;
                    }
                } catch(e) {
                    console.error("Image processing error:", e);
                }
            }

            try {
                
                try {
                    const payload = {
                        token_address: newTokenAddress.toLowerCase(),
                        creator_address: (await signer.getAddress()).toLowerCase(),
                        name: name,
                        symbol: symbol,
                        image_url: finalDbImageUrl,
                        description: desc,
                        twitter_url: twitter
                    };
                    console.log("Payload being sent to Supabase:", { token_address: payload.token_address, creator_address: payload.creator_address });
                    const { error } = await supabase.from('meme_tokens').insert([payload]);
                    if (error) {
                        console.error("Supabase insert error details:", error);
                        throw error;
                    }
                    console.log("Successfully indexed in Supabase!");
                } catch (dbError) {
                    console.error("Failed to write to Supabase database:", dbError);
                }
                // 1. Dynamically grab the elements only when needed
                const successModal = document.getElementById('successModal');
                const viewMarketBtn = document.getElementById('viewMarketBtn');
                const closeModalBtn = document.getElementById('closeModalBtn');
                // Safely find the form, even if the ID is different
                const formToReset = document.getElementById('launchForm') || document.querySelector('.launch-form');

                // 2. Ensure the modal actually exists in the DOM before manipulating it
                if (successModal) {
                    const modalText = document.getElementById('modalText');
                    if (modalText) {
                        if (ipfsPinSucceeded) {
                            modalText.textContent = 'Your meme token is now live on Hedera and securely pinned to IPFS.';
                        } else {
                            modalText.textContent = "Your meme token is now live on Hedera. Your metadata couldn't be pinned to IPFS right now, but your token details are saved and will still display in the app.";
                        }
                    }

                    successModal.classList.add('active');

                    viewMarketBtn.onclick = () => { window.location.href = 'markets.html'; };
                    
                    closeModalBtn.onclick = () => {
                        successModal.classList.remove('active');
                        if (formToReset) {
                            formToReset.reset(); // Safely clear the inputs
                        }
                        document.getElementById('photo-preview').style.display = 'none';
                        document.getElementById('upload-placeholder').style.display = 'block';
                        btn.innerHTML = `<span>Launch Meme</span>`;
                        btn.disabled = false;
                    };
                } else {
                    console.error("Success modal HTML is missing from the page!");
                }
            } catch (e) {
                console.error("Supabase Insert Failed:", e);
                // Fallback if supabase fails but token is created
                alert(`SUCCESS! Your Meme Token is live. (Note: Database indexing failed, image might not appear)`);
                window.location.href = 'markets.html';
            }

            } catch (err) {
                console.error("Native Launch Error:", err);
                alert(`Launch Failed: ${err.message || "User rejected or wallet error"}`);
            } finally {
                try {
                    // If it succeeded, the modal handles button reset. 
                    // But just in case, we ensure it's not permanently disabled!
                    btn.disabled = false;
                    if (!document.getElementById('successModal')?.classList.contains('active')) {
                        btn.innerHTML = `<span>Launch Meme</span>`;
                    }
                } catch (cleanupError) {
                    console.error("Error resetting launch UI:", cleanupError);
                }
            }
        });
    }

    const photoUploadArea = document.getElementById('photo-upload-area');
    const memePhotoInput = document.getElementById('memePhoto');
    const photoPreview = document.getElementById('photo-preview');
    const uploadPlaceholder = document.getElementById('upload-placeholder');

    if (photoUploadArea && memePhotoInput) {
        photoUploadArea.addEventListener('click', () => memePhotoInput.click());

        memePhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                selectedMemeFile = file;
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
                selectedMemeFile = file;
                try {
                    memePhotoInput.files = e.dataTransfer.files;
                } catch(e) {} // Some browsers block this
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
    const portfolioTabsContainer = document.getElementById('portfolio-tabs-container');
    const profileAddressDisplay = document.getElementById('profile-address-display');
    const copyAddressText = document.getElementById('copy-address-text');
    const copyAddressBtn = document.getElementById('copy-address-btn');
    const pfpImg = document.getElementById('pfp-img');
    const tabPortfolio = document.getElementById('tab-portfolio');
    const tabLaunched = document.getElementById('tab-launched');
    const statTokensHeld = document.getElementById('stat-tokens-held');
    const statTokensLaunched = document.getElementById('stat-tokens-launched');

    let currentPortfolioTab = 'held'; // 'held' or 'launched'

    if (portfolioGrid) {
        window.refreshPortfolioUI = () => {
            if (currentUserNative && currentUserEvm) {
                if (portfolioStatus) portfolioStatus.style.display = 'none';
                if (profileArea) profileArea.style.display = 'flex';
                if (portfolioTabsContainer) portfolioTabsContainer.style.display = 'flex';

                // Truncate address for display
                const addr = currentUserEvm;
                const truncated = addr.substring(0, 6) + '...' + addr.substring(addr.length - 4);
                if (profileAddressDisplay) profileAddressDisplay.innerText = truncated;
                if (copyAddressText) copyAddressText.innerText = truncated;

                // Generate Blockie Avatar
                if (pfpImg && window.blockies) {
                    try {
                        const icon = window.blockies.create({
                            seed: addr.toLowerCase(),
                            size: 8,
                            scale: 10
                        });
                        pfpImg.src = icon.toDataURL();
                    } catch (e) {
                        console.error("Blockie generation failed", e);
                    }
                }

                if (copyAddressBtn) {
                    copyAddressBtn.onclick = () => {
                        navigator.clipboard.writeText(addr);
                        const oldText = copyAddressText.innerText;
                        copyAddressText.innerText = 'Copied!';
                        setTimeout(() => copyAddressText.innerText = oldText, 2000);
                    };
                }

                if (tabPortfolio && tabLaunched) {
                    tabPortfolio.onclick = () => {
                        currentPortfolioTab = 'held';
                        tabPortfolio.classList.add('active');
                        tabLaunched.classList.remove('active');
                        loadTokensHeld(addr);
                    };
                    tabLaunched.onclick = () => {
                        currentPortfolioTab = 'launched';
                        tabLaunched.classList.add('active');
                        tabPortfolio.classList.remove('active');
                        loadLaunchedMemes(addr);
                    };
                }

                // Initial Load
                if (currentPortfolioTab === 'held') {
                    loadTokensHeld(addr);
                } else {
                    loadLaunchedMemes(addr);
                }
                
                // Always fetch launched count to update the header stat
                updateLaunchedCount(addr);
            } else {
                if (portfolioStatus) portfolioStatus.style.display = 'block';
                if (profileArea) profileArea.style.display = 'none';
                if (portfolioTabsContainer) portfolioTabsContainer.style.display = 'none';
                portfolioGrid.innerHTML = '';
            }
        };

        async function updateLaunchedCount(userAddress) {
            try {
                
                const { count, error } = await supabase
                    .from('meme_tokens')
                    .select('*', { count: 'exact', head: true })
                    .eq('creator_address', userAddress.toLowerCase());
                
                if (!error && count !== null) {
                    if (statTokensLaunched) statTokensLaunched.innerText = count.toString();
                }
            } catch (e) {
                console.error("Failed to fetch launched count", e);
            }
        }

        async function loadTokensHeld(userAddress) {
            try {
                portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.6;">Loading your portfolio...</div>';

                if (!currentUserNative) {
                    portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.6;">Could not resolve your Hedera account.</div>';
                    return;
                }

                // Ask mirror node what this account actually holds instead of
                // probing every platform token's balanceOf individually - that
                // doesn't scale as the number of launched tokens grows.
                const heldBalances = new Map(); // hedera token id -> raw balance
                let url = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${currentUserNative}/tokens?limit=100`;
                while (url) {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error('Failed to fetch account token balances');
                    const data = await res.json();
                    for (const t of data.tokens || []) {
                        if (Number(t.balance) > 0) heldBalances.set(t.token_id, t.balance);
                    }
                    url = data.links && data.links.next ? `https://testnet.mirrornode.hedera.com${data.links.next}` : null;
                }

                if (heldBalances.size === 0) {
                    portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.6;">You don\'t hold any tokens yet. Start trading!</div>';
                    if (statTokensHeld) statTokensHeld.innerText = "0";
                    return;
                }

                const { data: allTokens, error } = await supabase.from('meme_tokens').select('*');
                if (error) throw error;

                const hiddenKey = `hidden_memes_${userAddress.toLowerCase()}`;
                const hiddenMemes = JSON.parse(localStorage.getItem(hiddenKey) || "[]");

                portfolioGrid.innerHTML = '';
                let tokensHeldCount = 0;

                for (const token of allTokens || []) {
                    if (hiddenMemes.includes(token.token_address.toLowerCase())) continue;
                    const rawBalance = heldBalances.get(evmAddressToHederaId(token.token_address));
                    if (!rawBalance) continue;

                    tokensHeldCount++;
                    // Hedera tokens standardly use 8 decimals, not 18
                    const formattedBalance = parseFloat(formatUnits(BigInt(rawBalance), 8)).toLocaleString(undefined, { maximumFractionDigits: 2 });
                    renderTokenCard(token, formattedBalance, 'held', hiddenMemes, hiddenKey, userAddress);
                }

                if (statTokensHeld) statTokensHeld.innerText = tokensHeldCount.toString();

                if (tokensHeldCount === 0) {
                    portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.6;">You don\'t hold any tokens yet. Start trading!</div>';
                }
            } catch (error) {
                console.error("Error loading portfolio:", error);
                portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ff4d4d;">Error loading portfolio data.</div>';
            }
        }

        async function loadLaunchedMemes(userAddress) {
            try {
                portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.6;">Loading your launched memes...</div>';
                

                // Fetch tokens where user is creator
                const { data: launchedTokens, error } = await supabase
                    .from('meme_tokens')
                    .select('*')
                    .eq('creator_address', userAddress.toLowerCase());
                
                console.log("Raw Launched Tokens from Supabase:", launchedTokens, "Error if any:", error);

                if (error) throw error;

                if (!launchedTokens || launchedTokens.length === 0) {
                    portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.6;">You haven\'t launched any memes yet. 🚀</div>';
                    if (statTokensLaunched) statTokensLaunched.innerText = "0";
                    return;
                }

                if (statTokensLaunched) statTokensLaunched.innerText = launchedTokens.length.toString();
                portfolioGrid.innerHTML = '';

                // Load hidden memes
                const hiddenKey = `hidden_memes_${userAddress.toLowerCase()}`;
                const hiddenMemes = JSON.parse(localStorage.getItem(hiddenKey) || "[]");

                let displayCount = 0;
                launchedTokens.forEach(token => {
                    if (!hiddenMemes.includes(token.token_address.toLowerCase())) {
                        displayCount++;
                        renderTokenCard(token, 'Creator', 'launched', hiddenMemes, hiddenKey, userAddress);
                    }
                });

                if (displayCount === 0) {
                    portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.6;">All your launched memes are hidden.</div>';
                }
            } catch (error) {
                console.error("Error loading launched memes:", error);
                portfolioGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ff4d4d;">Error loading launched data.</div>';
            }
        }

        function renderTokenCard(token, balanceLabel, tabType, hiddenMemes, hiddenKey, userAddress) {
            const tokenCard = document.createElement('div');
            tokenCard.className = 'token-card';
            tokenCard.style.position = 'relative';

            let displayImage = token.image_url && token.image_url.startsWith('http') ? token.image_url : 'https://placehold.co/400x400/1a1a2e/ffd700?text=MEME';
            const localImage = localStorage.getItem(`meme_image_${token.token_address.toLowerCase()}`);
            if (localImage) {
                displayImage = localImage;
            } else if (token.image_url && token.image_url.startsWith('ipfs://') && !token.image_url.includes('bafybeidmeme')) {
                displayImage = token.image_url.replace('ipfs://', 'https://ipfs.io/ipfs/');
            } else if (token.image_url && (token.image_url.startsWith('Qm') || token.image_url.startsWith('bafy'))) {
                displayImage = `https://ipfs.io/ipfs/${token.image_url}`;
            }
            displayImage = displayImage.replace('gateway.pinata.cloud', 'ipfs.io');

            const cleanSymbol = token.symbol.startsWith('$') ? token.symbol : `$${token.symbol}`;

            let badgeHtml = '';
            if (tabType === 'launched') {
                badgeHtml = `<span class="hot-badge" style="background: rgba(74, 222, 128, 0.2); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3);">Founder</span>`;
            }

            tokenCard.innerHTML = `
                <!-- Delete Button -->
                <button class="delete-meme-btn" data-address="${token.token_address}" style="position: absolute; top: 15px; right: 15px; background: rgba(255, 77, 77, 0.1); border: 1px solid rgba(255, 77, 77, 0.2); color: #ff4d4d; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; transition: all 0.2s ease;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                </button>

                <div class="card-header">
                    <div class="token-avatar" style="background: url('${displayImage}') center/cover no-repeat; border-radius: 12px; width: 60px; height: 60px; border: 2px solid rgba(255, 215, 0, 0.2);">
                    </div>
                    <div class="token-info">
                        <div class="token-name-row">
                            <span class="token-name">${token.name}</span>
                            ${badgeHtml}
                        </div>
                        <span class="token-symbol">${cleanSymbol}</span>
                    </div>
                </div>
                <div class="card-stats">
                    <div class="stat-group">
                        <span class="stat-label">Balance</span>
                        <span class="stat-value" style="color: #ffd700; font-weight: 600;">${balanceLabel}</span>
                    </div>
                    <div class="stat-group">
                        <span class="stat-label">Address</span>
                        <span class="stat-value" style="font-size: 0.7rem;">${token.token_address.substring(0,6)}...${token.token_address.substring(38)}</span>
                    </div>
                </div>
                <div style="margin-top: 20px; display: grid; grid-template-columns: 1fr; gap: 10px;">
                    <a href="/coin?address=${token.token_address}" class="filter-btn" style="text-align: center; text-decoration: none; padding: 10px; font-size: 0.8rem;">Trade</a>
                </div>
            `;

            // Delete Click Handler
            const deleteBtn = tokenCard.querySelector('.delete-meme-btn');
            deleteBtn.addEventListener('click', () => {
                if (confirm(`Hide ${token.name} from your portfolio? This only hides it from your view.`)) {
                    hiddenMemes.push(token.token_address.toLowerCase());
                    localStorage.setItem(hiddenKey, JSON.stringify(hiddenMemes));
                    tokenCard.style.opacity = '0';
                    tokenCard.style.transform = 'scale(0.9)';
                    setTimeout(() => {
                        if (currentPortfolioTab === 'held') loadTokensHeld(userAddress);
                        else loadLaunchedMemes(userAddress);
                    }, 300);
                }
            });

            portfolioGrid.appendChild(tokenCard);
        }
    }


    const primaryBtn = document.querySelector('.primary-btn');
    if (primaryBtn) {
        primaryBtn.addEventListener('click', () => {
            window.location.href = 'markets.html';
        });
    }

    // Markets Page Logic
    const tokensGrid = document.getElementById('tokens-grid');
    const marketsSearchInput = document.getElementById('markets-search');
    const marketsLoadMoreBtn = document.getElementById('markets-load-more');
    const marketsFilterBtns = document.querySelectorAll('.markets-filters .filter-btn');
    if (tokensGrid) {
        loadMarkets();
    }

    // Leaderboard Page Logic
    const topCreatorsList = document.getElementById('top-creators-list');
    const topMemesList = document.getElementById('top-memes-list');
    if (topCreatorsList && topMemesList) {
        loadLeaderboard();
    }

    let allMarketTokens = [];
    let marketsSortMode = 'trending';
    let marketsSearchTerm = '';
    let marketsVisibleCount = 12;
    const MARKETS_PAGE_SIZE = 12;

    const STAR_FILLED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    const STAR_OUTLINE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

    function renderMarketsList() {
        const term = marketsSearchTerm.trim().toLowerCase();
        let filtered = allMarketTokens.slice();

        if (marketsSortMode === 'watchlist') {
            filtered = filtered.filter(t => isWatchlisted(t.address));
        }
        if (term) {
            filtered = filtered.filter(t =>
                t.name.toLowerCase().includes(term) || t.symbol.toLowerCase().includes(term));
        }

        if (marketsSortMode === 'new') {
            filtered.sort((a, b) => b.createdMs - a.createdMs);
        } else if (marketsSortMode === 'gainers') {
            filtered.sort((a, b) => b.changePct - a.changePct);
        } else {
            // 'trending', 'volume', and 'watchlist' all rank by real trade volume
            filtered.sort((a, b) => (b.volumeHbar - a.volumeHbar));
        }

        tokensGrid.innerHTML = '';
        if (filtered.length === 0) {
            const emptyMsg = marketsSortMode === 'watchlist'
                ? 'Your watchlist is empty. Click the star on any token to add it.'
                : 'No tokens match.';
            tokensGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.7;">${emptyMsg}</div>`;
            marketsLoadMoreBtn.style.display = 'none';
            return;
        }

        const visible = filtered.slice(0, marketsVisibleCount);
        visible.forEach(token => {
            const cleanSymbol = token.symbol.startsWith('$') ? token.symbol : `$${token.symbol}`;
            const isNew = (Date.now() - token.createdMs) < (24 * 60 * 60 * 1000);
            const newBadgeHtml = isNew ? `<span class="hot-badge">New</span>` : '';

            const priceDisplay = token.hasTrades ? `${token.lastPrice.toFixed(8)} ℏ` : '—';
            const changeClass = token.hasTrades ? (token.changePct >= 0 ? 'positive' : 'negative') : '';
            const changeDisplay = token.hasTrades
                ? `${token.changePct >= 0 ? '↗' : '↘'} ${token.changePct.toFixed(1)}%`
                : '—';
            const volumeDisplay = token.hasTrades ? `${token.volumeHbar.toLocaleString(undefined, { maximumFractionDigits: 2 })} ℏ` : 'No trades yet';

            const watchlisted = isWatchlisted(token.address);

            const tokenCard = document.createElement('a');
            tokenCard.href = `coin.html?address=${token.address}`;
            tokenCard.className = 'token-card';
            tokenCard.innerHTML = `
                <button class="watchlist-star-btn ${watchlisted ? 'active' : ''}" aria-label="Toggle watchlist">${watchlisted ? STAR_FILLED : STAR_OUTLINE}</button>
                <div class="card-header">
                    <div class="token-avatar" style="background: url('${token.displayImage}') center/cover no-repeat; border-radius: 12px; width: 60px; height: 60px; border: 2px solid rgba(255, 215, 0, 0.2);"></div>
                    <div class="token-info">
                        <div class="token-name-row">
                            <span class="token-name">${token.name}</span>
                            ${newBadgeHtml}
                        </div>
                        <span class="token-symbol">${cleanSymbol}</span>
                    </div>
                </div>
                <div class="card-stats">
                    <div class="stat-group">
                        <span class="stat-label">Price</span>
                        <span class="stat-value">${priceDisplay}</span>
                    </div>
                    <div class="stat-group">
                        <span class="stat-label">Change</span>
                        <span class="stat-value ${changeClass}">${changeDisplay}</span>
                    </div>
                    <div class="stat-group">
                        <span class="stat-label">Volume</span>
                        <span class="stat-value">${volumeDisplay}</span>
                    </div>
                    <div class="stat-group">
                        <span class="stat-label">Initial Supply</span>
                        <span class="stat-value positive">${token.supplyDisplay}</span>
                    </div>
                </div>
            `;

            const starBtn = tokenCard.querySelector('.watchlist-star-btn');
            starBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const nowWatchlisted = toggleWatchlist(token.address);
                if (marketsSortMode === 'watchlist' && !nowWatchlisted) {
                    renderMarketsList();
                } else {
                    starBtn.classList.toggle('active', nowWatchlisted);
                    starBtn.innerHTML = nowWatchlisted ? STAR_FILLED : STAR_OUTLINE;
                }
            });

            tokensGrid.appendChild(tokenCard);
        });

        marketsLoadMoreBtn.style.display = filtered.length > marketsVisibleCount ? 'inline-flex' : 'none';
    }

    if (tokensGrid) {
        marketsSearchInput.addEventListener('input', (e) => {
            marketsSearchTerm = e.target.value;
            marketsVisibleCount = MARKETS_PAGE_SIZE;
            renderMarketsList();
        });

        marketsFilterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                marketsFilterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                marketsSortMode = btn.dataset.sort;
                marketsVisibleCount = MARKETS_PAGE_SIZE;
                renderMarketsList();
            });
        });

        marketsLoadMoreBtn.addEventListener('click', () => {
            marketsVisibleCount += MARKETS_PAGE_SIZE;
            renderMarketsList();
        });
    }

    async function loadMarkets() {
        try {
            const { data: tokens, error } = await supabase.from('meme_tokens').select('*');
            if (error) throw error;

            if (!tokens || tokens.length === 0) {
                tokensGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.7;">No tokens launched yet. Be the first!</div>';
                marketsLoadMoreBtn.style.display = 'none';
                return;
            }

            // Bounded by the number of launched tokens shown here, not by
            // total platform activity - safe to fetch in parallel per token.
            const supplyByAddress = new Map();
            await Promise.all(tokens.map(async (token) => {
                try {
                    const hederaId = evmAddressToHederaId(token.token_address);
                    const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/tokens/${hederaId}`);
                    if (res.ok) {
                        const info = await res.json();
                        if (info.total_supply) {
                            supplyByAddress.set(token.token_address.toLowerCase(), Math.floor(Number(info.total_supply) / 1e8).toLocaleString());
                        }
                    }
                } catch (e) { /* leave supply unknown for this token */ }
            }));

            allMarketTokens = tokens.map(token => {
                const address = token.token_address.toLowerCase();

                let displayImage = token.image_url && token.image_url.startsWith('http') ? token.image_url : 'https://placehold.co/400x400/1a1a2e/ffd700?text=MEME';
                const localImage = localStorage.getItem(`meme_image_${address}`);
                if (localImage) {
                    displayImage = localImage;
                } else if (token.image_url && token.image_url.startsWith('ipfs://') && !token.image_url.includes('bafybeidmeme')) {
                    displayImage = token.image_url.replace('ipfs://', 'https://ipfs.io/ipfs/');
                }
                displayImage = displayImage.replace('gateway.pinata.cloud', 'ipfs.io');

                return {
                    address,
                    name: token.name || 'Unknown',
                    symbol: token.symbol || 'UNK',
                    displayImage,
                    createdMs: token.created_at ? new Date(token.created_at).getTime() : 0,
                    supplyDisplay: supplyByAddress.get(address) || 'Unknown',
                    hasTrades: false,
                    lastPrice: 0,
                    changePct: 0,
                    volumeHbar: 0
                };
            });

            // Render the list immediately with what we have - don't block
            // on the trade-volume scan (a sequential multi-page mirror node
            // walk that can take several seconds). Merge real price/volume/
            // change in once it resolves, preserving whatever sort/search/
            // pagination the user is already looking at.
            marketsVisibleCount = MARKETS_PAGE_SIZE;
            renderMarketsList();

            fetchTokenMarketStats().then(marketStats => {
                allMarketTokens.forEach(token => {
                    const stats = marketStats.get(token.address);
                    if (!stats) return;
                    token.hasTrades = true;
                    token.lastPrice = stats.lastPrice;
                    token.changePct = stats.changePct;
                    token.volumeHbar = Number(stats.volumeTinybars) / 1e8;
                });
                renderMarketsList();
            }).catch(err => console.error('Failed to load market stats:', err));
        } catch (error) {
            console.error("Error loading markets:", error);
            tokensGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ff4d4d;">Error loading market data.</div>';
        }
    }

    async function loadLeaderboard() {
        try {
            const { data: allTokens, error } = await supabase.from('meme_tokens').select('*');
            if (error) throw error;

            // 1. Top Creators - real counts from our own launch records
            const creatorCounts = {};
            (allTokens || []).forEach(t => {
                if (!t.creator_address) return;
                creatorCounts[t.creator_address] = (creatorCounts[t.creator_address] || 0) + 1;
            });
            const sortedCreators = Object.entries(creatorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);

            topCreatorsList.innerHTML = '';
            if (sortedCreators.length === 0) {
                topCreatorsList.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.7;">No creators found yet.</div>';
            } else {
                sortedCreators.forEach(([address, count], index) => {
                    const truncated = address.substring(0, 6) + '...' + address.substring(address.length - 4);
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <div class="creator-rank">#${index + 1}</div>
                        <div class="creator-info">
                            <span class="creator-address">${truncated}</span>
                            <span class="creator-count">${count} Token${count > 1 ? 's' : ''} Launched</span>
                        </div>
                    `;
                    topCreatorsList.appendChild(li);
                });
            }

            // 2. Top Memes - ranked by real HBAR trade volume, not recency
            topMemesList.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.6;">Loading trade volume...</div>';
            const tokenByAddress = new Map((allTokens || []).map(t => [t.token_address.toLowerCase(), t]));
            const volumeRanked = await fetchTopTokensByVolume();
            const rankedMemes = volumeRanked
                .map(v => ({ ...v, token: tokenByAddress.get(v.tokenAddress) }))
                .filter(v => v.token)
                .slice(0, 10);

            topMemesList.innerHTML = '';
            if (rankedMemes.length === 0) {
                topMemesList.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.7;">No trading activity yet.</div>';
            } else {
                rankedMemes.forEach(({ token, hbarTinybars }, index) => {
                    let displayImage = token.image_url && token.image_url.startsWith('http') ? token.image_url : 'https://placehold.co/400x400/1a1a2e/ffd700?text=MEME';
                    const localImage = localStorage.getItem(`meme_image_${token.token_address.toLowerCase()}`);
                    if (localImage) {
                        displayImage = localImage;
                    } else if (token.image_url && token.image_url.startsWith('ipfs://') && !token.image_url.includes('bafybeidmeme')) {
                        displayImage = token.image_url.replace('ipfs://', 'https://ipfs.io/ipfs/');
                    }
                    displayImage = displayImage.replace('gateway.pinata.cloud', 'ipfs.io');

                    const volumeHbar = (Number(hbarTinybars) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 });
                    const symbol = token.symbol.startsWith('$') ? token.symbol : `$${token.symbol}`;

                    const li = document.createElement('li');
                    li.innerHTML = `
                        <div class="meme-rank">#${index + 1}</div>
                        <div class="meme-avatar" style="background: url('${displayImage}') center/cover; border-radius: 8px;"></div>
                        <div class="meme-info">
                            <span class="meme-name">${token.name}</span>
                            <span class="meme-symbol">${symbol} &middot; ${volumeHbar} ℏ volume</span>
                        </div>
                        <a href="coin.html?address=${token.token_address}" class="view-btn">View</a>
                    `;
                    topMemesList.appendChild(li);
                });
            }
        } catch (error) {
            console.error("Error loading leaderboard:", error);
            if (topCreatorsList) topCreatorsList.innerHTML = '<div style="color: #ff4d4d; text-align: center; padding: 20px;">Error loading data</div>';
            if (topMemesList) topMemesList.innerHTML = '<div style="color: #ff4d4d; text-align: center; padding: 20px;">Error loading data</div>';
        }
    }

    const secondaryBtn = document.querySelector('.secondary-btn');
    if (secondaryBtn) {
        secondaryBtn.addEventListener('click', () => {
            window.location.href = 'launch.html';
        });
    }

    // Helper to ensure wallet is on Hedera Testnet
    window.ensureHederaTestnet = async function() {
        const provider = typeof window.getUniversalProvider === 'function' ? await window.getUniversalProvider() : window.ethereum;
        if (!provider) return;

        const targetChainId = '0x128'; // 296
        const currentChainId = await provider.request({ method: 'eth_chainId' });
        if (currentChainId !== targetChainId) {
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: targetChainId }],
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    try {
                        await provider.request({
                            method: 'wallet_addEthereumChain',
                            params: [
                                {
                                    chainId: targetChainId,
                                    chainName: 'Hedera Testnet',
                                    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
                                    rpcUrls: ['https://testnet.hashio.io/api'],
                                    blockExplorerUrls: ['https://hashscan.io/testnet/'],
                                },
                            ],
                        });
                    } catch (addError) {
                        throw new Error("Failed to add Hedera Testnet to wallet");
                    }
                } else {
                    throw new Error("Please switch to Hedera Testnet in your wallet");
                }
            }
        }
    };

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
