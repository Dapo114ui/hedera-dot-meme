import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || '56b4ff1bce8f0f39d1087b98b8de75fe'; 
if (!projectId) {
  console.warn("VITE_REOWN_PROJECT_ID is not defined in .env, using fallback.");
}

const metadata = {
  name: 'Onyc.meme',
  description: 'The premier decentralized marketplace for meme tokens. Trade viral moments on Hedera Testnet.',
  url: window.location.origin,
  icons: [window.location.origin + '/onyc-icon.png']
};

// Define Hedera Testnet manually using standard EVM chain ID (296) to prevent eip155 string concatenation crashes
const hederaTestnet = {
  id: 296,
  name: 'Hedera Testnet',
  network: 'hedera-testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } },
  blockExplorers: { default: { name: 'Hashscan', url: 'https://hashscan.io/testnet' } },
};

export let appkit = null;

try {
  const ethersAdapter = new EthersAdapter();
  
  appkit = createAppKit({
    adapters: [ethersAdapter],
    networks: [hederaTestnet],
    defaultNetwork: hederaTestnet,
    metadata,
    projectId,
    features: {
      analytics: true,
      email: false, 
      socials: false 
    },
    featuredWalletIds: [
      'fd20d04085600c01d93a4b92b9508a56' // HashPack Wallet ID
    ],
    allWallets: 'SHOW',
    enableEIP6963: true,
    // This is a multi-page site - every nav-link click is a full reload, so
    // AppKit's default reconnect-on-init runs on every single navigation.
    // For an injected/EIP-6963 connector (e.g. HashPack's "Installed"
    // option) that reconnect calls eth_requestAccounts, not the silent
    // eth_accounts, and HashPack surfaces its own window for that call
    // every time - which is what was popping the wallet open on every
    // click. Disabling AppKit's own reconnect stops that; script.js
    // restores the "already connected" UI itself via a genuinely-silent
    // eth_accounts read instead (see syncAppKitState).
    enableReconnect: false
  });

} catch (err) {
  console.error("FATAL: Failed to initialize Reown AppKit:", err);
}
