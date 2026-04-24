import { appkit } from './wallet.js';

document.addEventListener('DOMContentLoaded', () => {
    // Custom Wallet Button Logic
    const customWalletBtn = document.getElementById('custom-wallet-btn');
    if (customWalletBtn) {
        customWalletBtn.addEventListener('click', (e) => {
            // Check if user clicked the copy button
            const copyBtn = e.target.closest('.copy-btn');
            if (copyBtn) {
                e.preventDefault();
                e.stopPropagation();
                const addressToCopy = copyBtn.dataset.address;
                if (addressToCopy) {
                    navigator.clipboard.writeText(addressToCopy);
                    // Show confirmation icon temporarily
                    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                    setTimeout(() => {
                        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                    }, 2000);
                }
                return;
            }
            appkit.open();
        });

        async function getHederaNativeId(evmAddress) {
            // 1. Handle Long-Zero Address automatically
            if (evmAddress.toLowerCase().startsWith('0x000000000000000000000000')) {
                const hexNum = evmAddress.substring(26);
                const accountNum = parseInt(hexNum, 16);
                return `0.0.${accountNum}`;
            }

            // 2. Read from Cache to improve performance
            const cacheKey = `hedera_id_${evmAddress.toLowerCase()}`;
            const cachedId = localStorage.getItem(cacheKey);
            if (cachedId && !cachedId.toLowerCase().startsWith('0x')) return cachedId;

            // 3. Mirror Node Fetch (testnet fallback to mainnet)
            try {
                // Testing mainnet public
                let response = await fetch(`https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`);
                if (!response.ok) {
                    // Try testnet as secondary fallback since site states "Testnet"
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

        const updateWalletButtonState = async (state) => {
            if (state.isConnected && state.address) {
                const evmAddress = state.address;
                
                const cacheKey = `hedera_id_${evmAddress.toLowerCase()}`;
                const cachedId = localStorage.getItem(cacheKey);
                if (!cachedId || cachedId.toLowerCase().startsWith('0x')) {
                    customWalletBtn.innerHTML = `Connecting...`;
                }
                
                const nativeId = await getHederaNativeId(evmAddress);
                if (nativeId) {
                    const copyHtml = `
                        <span class="copy-btn" data-address="${nativeId}" title="Copy Hedera Address" style="margin-left: 6px; padding: 2px; cursor: pointer; display: inline-flex; align-items: center; opacity: 0.8;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </span>`;
                    customWalletBtn.innerHTML = `HBAR ${nativeId} ${copyHtml}`;
                } else {
                    customWalletBtn.innerHTML = `HBAR Connected`;
                }
            } else {
                customWalletBtn.innerHTML = `Connect Wallet`;
            }
        };

        // Subscribe to account state changes
        appkit.subscribeAccount(state => {
            updateWalletButtonState(state);
        });
    }
    const primaryBtn = document.querySelector('.primary-btn');
    if (primaryBtn) {
        primaryBtn.addEventListener('click', () => {
            alert('Redirecting to trading interface...');
        });
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
