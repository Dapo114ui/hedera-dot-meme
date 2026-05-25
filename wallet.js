import { createAppKit } from '@reown/appkit';

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

// Define Hedera Testnet manually to enforce hedera namespace instead of eip155
const hederaTestnet = {
  id: 'hedera:testnet',
  name: 'Hedera Testnet',
  network: 'hedera:testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 8 },
  rpcUrls: { default: { http: ['https://testnet.hashio.io/api'] } },
};

export const appkit = createAppKit({
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

// Disconnect Cleanup: Add an explicit session disconnect routine on page load 
// if a stale, misconfigured EVM-style HashPack session is detected.
setTimeout(() => {
    try {
        const provider = appkit.getWalletProvider();
        if (provider && provider.session && provider.session.namespaces && provider.session.namespaces['eip155']) {
            console.warn("Stale eip155 session detected! Forcing disconnect for clean Hedera-native handshake.");
            appkit.disconnect();
        }
    } catch (e) {
        console.error("Cleanup error:", e);
    }
}, 1000);
