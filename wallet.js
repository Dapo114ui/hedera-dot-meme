import { HashConnect } from 'hashconnect';
import { LedgerId } from '@hashgraph/sdk';

// 1. App Metadata
const metadata = {
    name: "Hedera dot Meme",
    description: "The premier decentralized marketplace for meme tokens on Hedera Testnet.",
    icons: ["https://avatars.githubusercontent.com/u/37784886"],
    url: window.location.origin
};

// 2. Initialize HashConnect (Using Testnet by default)
// Note: WC Project ID is optional for direct extension pairing but we pass null to be explicit
export const hc = new HashConnect(LedgerId.TESTNET, "56b4ff1bce8f0f39d1087b98b8de75fe", metadata, true);

// 3. Connection State Helper
export const getHcState = () => {
    return {
        isConnected: hc.connected,
        accountIds: hc.accountIds,
        mainAccount: hc.accountIds[0] || null
    };
};

// 4. Initialize Connection
export const initHashConnect = async () => {
    try {
        await hc.init();
        console.log("HashConnect Initialized");
    } catch (err) {
        console.error("HashConnect Init Error:", err);
    }
};

// 5. Connect/Pair Helper
export const connectHashConnect = async () => {
    if (hc.connected) return;
    try {
        await hc.openPairingModal();
    } catch (err) {
        console.error("HashConnect Pairing Error:", err);
    }
};

// 6. Disconnect Helper
export const disconnectHashConnect = async () => {
    try {
        await hc.disconnect();
        window.location.reload();
    } catch (err) {
        console.error("HashConnect Disconnect Error:", err);
    }
};
