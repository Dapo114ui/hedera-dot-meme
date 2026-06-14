// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract MemeDex {
    address public factory;
    address public treasury;
    
    // 30,000 HBAR virtual reserve
    uint256 public constant VIRTUAL_HBAR_RESERVE = 30_000 * 10**18;
    // 1,000,000,000 Tokens virtual reserve (assuming 8 decimals for tokens)
    uint256 public constant VIRTUAL_TOKEN_RESERVE = 1_000_000_000 * 10**8;

    struct Pool {
        uint256 virtualHbar;
        uint256 virtualToken;
        uint256 realHbar;
        uint256 realToken;
        bool isInitialized;
    }

    mapping(address => Pool) public pools;

    event PoolInitialized(address indexed token, uint256 virtualHbar, uint256 virtualToken);
    event TokenBought(address indexed buyer, address indexed token, uint256 hbarAmount, uint256 tokenAmount);
    event TokenSold(address indexed seller, address indexed token, uint256 tokenAmount, uint256 hbarAmount);

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory can call");
        _;
    }

    constructor(address _treasury) {
        treasury = _treasury;
    }

    function setFactory(address _factory) external {
        require(factory == address(0), "Factory already set");
        factory = _factory;
    }

    function initializePool(address token) external onlyFactory {
        require(!pools[token].isInitialized, "Pool already initialized");
        
        uint256 initialRealTokens = IERC20(token).balanceOf(address(this));
        
        pools[token] = Pool({
            virtualHbar: VIRTUAL_HBAR_RESERVE,
            virtualToken: VIRTUAL_TOKEN_RESERVE,
            realHbar: 0,
            realToken: initialRealTokens,
            isInitialized: true
        });

        emit PoolInitialized(token, VIRTUAL_HBAR_RESERVE, VIRTUAL_TOKEN_RESERVE);
    }

    // Returns amount of tokens out for a given hbar amount (after fee)
    function getAmountOutBuy(address token, uint256 hbarAmount) public view returns (uint256) {
        Pool memory pool = pools[token];
        require(pool.isInitialized, "Pool not initialized");
        
        uint256 fee = hbarAmount / 100; // 1% fee
        uint256 hbarInAfterFee = hbarAmount - fee;
        
        uint256 numerator = pool.virtualToken * hbarInAfterFee;
        uint256 denominator = pool.virtualHbar + hbarInAfterFee;
        return numerator / denominator;
    }

    // Returns amount of hbar out for a given token amount (before fee)
    // Then the fee is deducted from the hbar output.
    function getAmountOutSell(address token, uint256 tokenAmount) public view returns (uint256) {
        Pool memory pool = pools[token];
        require(pool.isInitialized, "Pool not initialized");

        uint256 numerator = pool.virtualHbar * tokenAmount;
        uint256 denominator = pool.virtualToken + tokenAmount;
        uint256 hbarOutBeforeFee = numerator / denominator;
        
        uint256 fee = hbarOutBeforeFee / 100; // 1% fee
        return hbarOutBeforeFee - fee;
    }

    function buyTokens(address token, uint256 minTokensOut) external payable {
        Pool storage pool = pools[token];
        require(pool.isInitialized, "Pool not initialized");
        require(msg.value > 0, "Must send HBAR");

        uint256 fee = msg.value / 100; // 1% fee
        uint256 hbarInAfterFee = msg.value - fee;

        uint256 numerator = pool.virtualToken * hbarInAfterFee;
        uint256 denominator = pool.virtualHbar + hbarInAfterFee;
        uint256 tokensOut = numerator / denominator;

        require(tokensOut >= minTokensOut, "Slippage tolerance exceeded");
        require(tokensOut <= pool.realToken, "Not enough real tokens in pool");

        // Update virtual reserves
        pool.virtualHbar += hbarInAfterFee;
        pool.virtualToken -= tokensOut;

        // Update real reserves
        pool.realHbar += hbarInAfterFee;
        pool.realToken -= tokensOut;

        // Send fee to treasury
        if (fee > 0) {
            (bool successFee, ) = treasury.call{value: fee}("");
            require(successFee, "Fee transfer failed");
        }

        // Send tokens to buyer
        require(IERC20(token).transfer(msg.sender, tokensOut), "Token transfer failed");

        emit TokenBought(msg.sender, token, msg.value, tokensOut);
    }

    function sellTokens(address token, uint256 tokenAmount, uint256 minHbarOut) external {
        Pool storage pool = pools[token];
        require(pool.isInitialized, "Pool not initialized");
        require(tokenAmount > 0, "Must sell tokens");

        // Pull tokens from seller
        require(IERC20(token).transferFrom(msg.sender, address(this), tokenAmount), "Token transferFrom failed");

        uint256 numerator = pool.virtualHbar * tokenAmount;
        uint256 denominator = pool.virtualToken + tokenAmount;
        uint256 hbarOutBeforeFee = numerator / denominator;
        
        uint256 fee = hbarOutBeforeFee / 100; // 1% fee
        uint256 hbarOut = hbarOutBeforeFee - fee;

        require(hbarOut >= minHbarOut, "Slippage tolerance exceeded");
        require(hbarOut <= address(this).balance - fee, "Not enough HBAR in pool");
        
        // Real hbar validation
        require(hbarOut <= pool.realHbar, "Not enough real HBAR in pool");

        // Update virtual reserves
        pool.virtualHbar -= hbarOutBeforeFee;
        pool.virtualToken += tokenAmount;

        // Update real reserves
        pool.realHbar -= hbarOutBeforeFee;
        pool.realToken += tokenAmount;

        // Send fee to treasury
        if (fee > 0) {
            (bool successFee, ) = treasury.call{value: fee}("");
            require(successFee, "Fee transfer failed");
        }

        // Send HBAR to seller
        (bool success, ) = msg.sender.call{value: hbarOut}("");
        require(success, "HBAR transfer failed");

        emit TokenSold(msg.sender, token, tokenAmount, hbarOut);
    }
}
