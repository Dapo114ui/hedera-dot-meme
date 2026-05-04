import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { hederaTestnet } from '@reown/appkit/networks';

// 1. Get your Project ID from environment variables
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || '56b4ff1bce8f0f39d1087b98b8de75fe'; 
if (!projectId) {
  console.warn("VITE_REOWN_PROJECT_ID is not defined in .env, using fallback.");
}

// 2. Define AppKit Metadata
const metadata = {
  name: 'Hedera.Meme',
  description: 'The premier decentralized marketplace for meme tokens. Trade viral moments on Hedera Testnet.',
  url: window.location.origin, // Must match your domain & subdomain
  icons: ['https://avatars.githubusercontent.com/u/37784886'] // Consider replacing with your actual logo
};

// 3. Create the AppKit instance with the Ethers adapter
export const appkit = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [hederaTestnet],
  defaultNetwork: hederaTestnet,
  metadata,
  projectId,
  features: {
    analytics: true,
    email: false, // Optional: Disable email login if not needed
    socials: false // Optional: Disable social login if not needed
  },
  featuredWalletIds: [
    'fd20d04085600c01d93a4b92b9508a56' // HashPack Wallet ID
  ],
  allWallets: 'SHOW', // Ensure all wallets are accessible if needed
  enableEIP6963: true // Prioritize browser extensions like HashPack
});
