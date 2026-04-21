import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { hedera, hederaTestnet } from '@reown/appkit/networks';

// 1. Get your Project ID from https://cloud.reown.com/
const projectId = '56b4ff1bce8f0f39d1087b98b8de75fe'; 

// 2. Define AppKit Metadata
const metadata = {
  name: 'Hedera.Meme',
  description: 'The premier decentralized marketplace for meme tokens. Trade viral moments on Hedera Testnet.',
  url: window.location.origin, // Must match your domain & subdomain
  icons: ['https://avatars.githubusercontent.com/u/37784886'] // Consider replacing with your actual logo
};

// 3. Create the AppKit instance with the Ethers adapter
const appkit = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [hedera, hederaTestnet],
  metadata,
  projectId,
  features: {
    analytics: true // Optional: turns on Reown AppKit analytics
  }
});
