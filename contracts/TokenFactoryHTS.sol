// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LiquidityPoolHTS.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
        int64 initialTotalSupply,
        int32 decimals
    ) external payable returns (int64 responseCode, address tokenAddress);
}

contract TokenFactoryHTS {
    address constant PRECOMPILE_ADDRESS = address(0x167);
    uint256 public CREATION_NETWORK_FEE = 40 ether; // ~40 HBAR for HTS creation fee
    uint256 public MIN_LAUNCH_VALUE = 100 ether; // 40 HBAR for fee, 60 HBAR for initial pool reserve

    event TokenCreated(address indexed tokenAddress, address indexed liquidityPool, string name, string symbol, string memo);

    function createToken(
        string memory name,
        string memory symbol,
        string memory memo,
        int64 initialSupply
    ) external payable returns (address, address) {
        require(msg.value >= MIN_LAUNCH_VALUE, "Must send at least 100 HBAR (Fee + Pool Liquidity)");
        address tokenAddress;
        {
            // Rule 2: Burn the Keys! 
            // We pass an empty TokenKey array. This sets no Admin, no Supply, no Wipe, no KYC keys.
            IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](0);

            IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry({
                second: 0,
                autoRenewAccount: address(this),
                autoRenewPeriod: 7776000 // 90 days
            });

            // 1. Mint the entire supply
            IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken({
                name: name,
                symbol: symbol,
                treasury: address(this), // Factory holds the initial supply temporarily
                memo: memo,
                tokenSupplyType: false,
                maxSupply: 0,
                freezeDefault: false,
                tokenKeys: keys,
                expiry: expiry
            });

            int64 responseCode;
            (responseCode, tokenAddress) = IHederaTokenService(PRECOMPILE_ADDRESS).createFungibleToken{value: CREATION_NETWORK_FEE}(
                token,
                initialSupply,
                8 // 8 Decimals is standard for HTS
            );

            require(responseCode == 22, "HTS token creation failed");
        }

        // 2. Deploy Liquidity Pool
        LiquidityPoolHTS pool = new LiquidityPoolHTS(tokenAddress);

        // 3. Dump every single token into the LiquidityPool
        IERC20(tokenAddress).transfer(address(pool), uint256(int256(initialSupply)));

        // Initial base pool liquidity
        uint256 basePoolLiquidity = 60 ether;
        require(msg.value >= CREATION_NETWORK_FEE + basePoolLiquidity, "Must send at least 100 HBAR");
        
        uint256 extraHbarForBuy = msg.value - CREATION_NETWORK_FEE - basePoolLiquidity;

        // Send the initial HBAR liquidity to the pool
        payable(address(pool)).transfer(basePoolLiquidity);

        // Sync the pool reserves to reflect initial state
        pool.sync();

        // Perform atomic buy for the creator if they sent extra HBAR
        if (extraHbarForBuy > 0) {
            pool.buyTokens{value: extraHbarForBuy}(0, msg.sender, payable(address(0)));
        }

        emit TokenCreated(tokenAddress, address(pool), name, symbol, memo);

        return (tokenAddress, address(pool));
    }

    // Required to receive HBAR
    receive() external payable {}
}
