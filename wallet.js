import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || '56b4ff1bce8f0f39d1087b98b8de75fe'; 
if (!projectId) {
  console.warn("VITE_REOWN_PROJECT_ID is not defined in .env, using fallback.");
}

const metadata = {
  name: 'Hedera.Meme',
  description: 'The premier decentralized marketplace for meme tokens. Trade viral moments on Hedera Testnet.',
  url: window.location.origin, 
  icons: ['https://avatars.githubusercontent.com/u/37784886'] 
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

// Aggressively clear stale WalletConnect sessions that contain the malformed hedera:testnet CAIP-10 string
// This prevents AppKit from fatally crashing on page load when it tries to restore a bad session.
try {
  for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('wc@2:') || key.startsWith('@w3m') || key.startsWith('@appkit') || key.startsWith('wagmi'))) {
          const value = localStorage.getItem(key);
          if (value && value.includes('hedera:testnet')) {
              console.warn(`Wiping corrupted AppKit cache key: ${key}`);
              localStorage.removeItem(key);
              i--; // Adjust index after removal
          }
      }
  }
} catch (e) {
  console.error("Failed to clear localStorage:", e);
}

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
    enableEIP6963: true 
  });

} catch (err) {
  console.error("FATAL: Failed to initialize Reown AppKit:", err);
}
