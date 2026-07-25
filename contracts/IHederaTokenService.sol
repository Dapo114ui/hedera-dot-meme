// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// HTS response code for a successful call. File-level constant, not inside
// the interface - Solidity interfaces cannot hold state (constants included).
int64 constant HTS_SUCCESS = 22;

/// @title IHederaTokenService
/// @notice The subset of Hedera's native HTS system-contract interface
/// (precompiled at address 0x167) this project actually uses. Struct
/// layout and the createFungibleToken/transferToken signatures match
/// what this project's own earlier, archived contract attempts confirmed
/// working end-to-end on testnet (see git log: "Fix HTS Signature Issue",
/// "Fix HTS Contract Keys", "Fix HTS token treasury bug") - copied
/// exactly rather than re-derived, since getting this struct layout
/// subtly wrong is exactly what those fixes were for.
interface IHederaTokenService {
    struct TokenKey {
        uint256 keyType;
        KeyValue key;
    }

    struct KeyValue {
        bool inheritAccountKey;
        address contractId;
        bytes ed25519;
        bytes ECDSA_secp256k1;
        address delegatableContractId;
    }

    struct Expiry {
        uint32 second;
        address autoRenewAccount;
        uint32 autoRenewPeriod;
    }

    struct HederaToken {
        string name;
        string symbol;
        address treasury;
        string memo;
        bool tokenSupplyType;
        uint32 maxSupply;
        bool freezeDefault;
        TokenKey[] tokenKeys;
        Expiry expiry;
    }

    function createFungibleToken(
        HederaToken memory token,
        uint256 initialTotalSupply,
        uint256 decimals
    ) external payable returns (int64 responseCode, address tokenAddress);

    function transferToken(
        address token,
        address sender,
        address recipient,
        int64 amount
    ) external returns (int64 responseCode);
}
