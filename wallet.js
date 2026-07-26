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

// AppKit remembers which connector last connected under this key (see
// @reown/appkit-common's getSafeConnectorIdKey) - read before init so
// enableReconnect below can be decided per connector type, not globally.
let lastConnectorId = null;
try {
  lastConnectorId = localStorage.getItem('@appkit/eip155:connected_connector_id');
} catch (e) {
  // Storage inaccessible (private mode, etc.) - falls through to the
  // injected-safe default below, same as a first-ever visit.
}

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
    // AppKit's reconnect-on-init runs on every single navigation. What it
    // does there depends on which connector last connected:
    //  - WalletConnect (HashPack via pairing/QR): reconnect just re-reads
    //    the still-live session (reconnectWalletConnect() -> a silent
    //    call), no prompt.
    //  - injected/EIP-6963 (HashPack's "Installed" option): reconnect calls
    //    eth_requestAccounts, and HashPack pops its own window for that
    //    every time - the actual popup-on-every-click problem this flag
    //    was added for.
    // Disabling the flag globally to kill the injected popup also kills
    // WalletConnect users: @reown/appkit's client explicitly calls
    // universalProvider.disconnect() on init whenever enableReconnect is
    // false and a session exists, tearing down their real WC session on
    // every single navigation (the reported "wallet disconnects when
    // switching tabs" bug). Scoping it to the connector actually at fault
    // fixes that without bringing back the injected-popup spam - script.js
    // still restores the injected path's "already connected" UI itself via
    // a genuinely-silent eth_accounts read (see syncAppKitState).
    enableReconnect: lastConnectorId === 'walletConnect'
  });

} catch (err) {
  console.error("FATAL: Failed to initialize Reown AppKit:", err);
}
