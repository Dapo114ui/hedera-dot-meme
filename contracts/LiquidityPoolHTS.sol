// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IHederaTokenServicePool {
    function associateTokens(address account, address[] memory tokens) external returns (int64 responseCode);
}

contract LiquidityPoolHTS {
    address public tokenAddress;
    address public factoryAddress;
    address constant PRECOMPILE_ADDRESS = address(0x167);

    uint256 public constant FEE_RATE = 1; // 1%
    address public constant FEE_RECEIVER = address(0);

    uint256 public constant MAX_LAUNCH_BUY = 3 ether; // 3 HBAR anti-sniper cap during launch
    uint256 public constant BONDING_CURVE_TARGET = 100000 ether; // 100,000 HBAR graduation

    uint256 public reserveHbar;
    uint256 public reserveToken;

    event Swap(address indexed sender, uint256 hbarIn, uint256 tokenIn, uint256 hbarOut, uint256 tokenOut);

    constructor(address _token) {
        tokenAddress = _token;
        factoryAddress = msg.sender;

        // Contract must associate with the HTS token to hold it
        address[] memory tokens = new address[](1);
        tokens[0] = _token;
        (bool success, ) = PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(IHederaTokenServicePool.associateTokens.selector, address(this), tokens)
        );
        require(success, "Association failed");
    }

    function buyTokens(uint256 minTokensOut, address receiver, address payable referrer) external payable {
        require(msg.value > 0, "Must send HBAR");

        if (reserveHbar < BONDING_CURVE_TARGET) {
            require(msg.value <= MAX_LAUNCH_BUY, "Exceeds max buy limit of 3 HBAR during launch");
        }

        uint256 hbarIn = msg.value;
        uint256 fee = (hbarIn * FEE_RATE) / 100;
        uint256 hbarInAfterFee = hbarIn - fee;

        uint256 tokensOut = (reserveToken * hbarInAfterFee) / (reserveHbar + hbarInAfterFee);
        require(tokensOut >= minTokensOut, "Slippage tolerance exceeded");

        uint256 referrerCut = 0;
        if (referrer != address(0)) {
            referrerCut = (hbarIn * 20) / 10000; // 0.2%
            fee = fee - referrerCut;
        }

        reserveHbar += hbarIn;
        reserveToken -= tokensOut;

        if (fee > 0 && FEE_RECEIVER != address(0)) {
            payable(FEE_RECEIVER).transfer(fee);
            reserveHbar -= fee; 
        }
        if (referrerCut > 0) {
            referrer.transfer(referrerCut);
            reserveHbar -= referrerCut;
        }

        // Send HTS tokens to the designated receiver
        IERC20(tokenAddress).transfer(receiver, tokensOut);
        
        emit Swap(receiver, hbarIn, 0, 0, tokensOut);
    }

    function sellTokens(uint256 tokensIn, uint256 minHbarOut, address payable referrer) external {
        require(tokensIn > 0, "Must send tokens");

        uint256 hbarOut = (reserveHbar * tokensIn) / (reserveToken + tokensIn);
        
        uint256 fee = (hbarOut * FEE_RATE) / 100;
        uint256 hbarOutAfterFee = hbarOut - fee;
        require(hbarOutAfterFee >= minHbarOut, "Slippage tolerance exceeded");

        uint256 referrerCut = 0;
        if (referrer != address(0)) {
            referrerCut = (hbarOut * 20) / 10000; // 0.2%
            fee = fee - referrerCut;
        }

        IERC20(tokenAddress).transferFrom(msg.sender, address(this), tokensIn);

        reserveToken += tokensIn;
        reserveHbar -= hbarOut;

        payable(msg.sender).transfer(hbarOutAfterFee);

        if (fee > 0 && FEE_RECEIVER != address(0)) {
            payable(FEE_RECEIVER).transfer(fee);
        }
        if (referrerCut > 0) {
            referrer.transfer(referrerCut);
        }
        
        emit Swap(msg.sender, 0, tokensIn, hbarOutAfterFee, 0);
    }

    function sync() external {
        reserveHbar = address(this).balance;
        reserveToken = IERC20(tokenAddress).balanceOf(address(this));
    }
    
    // Allow pool to receive initial HBAR liquidity directly from factory
    receive() external payable {}
}
