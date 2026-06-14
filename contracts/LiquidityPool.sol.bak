import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./TokenFactory.sol";

contract LiquidityPool {
    address public tokenAddress;
    address public factoryAddress;
    uint256 public constant PRECISION = 1e18;

    uint256 public immutable FEE_RATE;
    address public immutable FEE_RECEIVER;

    constructor(address _token, uint256 _feeRate, address _feeReceiver) {
        tokenAddress = _token;
        factoryAddress = msg.sender;
        FEE_RATE = _feeRate;
        FEE_RECEIVER = _feeReceiver;
    }

    function getTokensOut(uint256 ethIn) public view returns (uint256) {
        require(ethIn > 0, "Invalid input amount");

        IERC20 token = _getErc20Instance();

        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = token.balanceOf(address(this));

        uint256 tokensOut = (tokenReserve * ethIn) / (ethReserve + ethIn);

        return tokensOut;
    }

    function getEthOut(uint256 tokensIn) public view returns (uint256) {
        require(tokensIn > 0, "Invalid input amount");

        IERC20 token = _getErc20Instance();

        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = token.balanceOf(address(this));

        uint256 ethOut = (ethReserve * tokensIn) / (tokenReserve + tokensIn);

        return ethOut;
    }

    function _getTokensOut(uint256 ethIn) internal view returns (uint256) {
        require(ethIn > 0, "Invalid input amount");

        IERC20 token = _getErc20Instance();

        uint256 ethReserve = address(this).balance - msg.value;
        uint256 tokenReserve = token.balanceOf(address(this));

        uint256 tokensOut = (tokenReserve * ethIn) / (ethReserve + ethIn);

        return tokensOut;
    }

    function checkLiquidity() internal view returns (bool) {
        IERC20 token = _getErc20Instance();
        uint256 nativeBalance = address(this).balance - msg.value;
        uint256 tokenBalance = token.balanceOf(address(this));

        return nativeBalance > 0 && tokenBalance > 0;
    }

    function _calculateFee(uint256 amount) internal view returns (uint256) {
        return (amount * FEE_RATE) / 100;
    }

    function _transferFee(uint256 amount) internal {
        (bool success, ) = FEE_RECEIVER.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    function buyTokens() external payable {
        require(msg.value > 0, "No ETH sent");
        require(checkLiquidity(), "No liquidity");

        IERC20 token = _getErc20Instance();

        uint256 feeAmount = _calculateFee(msg.value);
        uint256 amountAfterFee = msg.value - feeAmount;
        uint256 tokenAmount = _getTokensOut(amountAfterFee);

        require(
            token.transfer(msg.sender, tokenAmount),
            "Token transfer failed"
        );

        _transferFee(feeAmount);

        TokenFactory tokenFactory = _getTokenFactoryInstance();

        tokenFactory.swapEvent(
            msg.sender,
            amountAfterFee,
            0,
            0,
            tokenAmount,
            msg.sender
        );

        tokenFactory.syncEvent(
            address(this).balance,
            token.balanceOf(address(this))
        );
    }

    function _getErc20Instance() internal view returns (IERC20) {
        return IERC20(tokenAddress);
    }

    function _getTokenFactoryInstance() internal view returns (TokenFactory) {
        return TokenFactory(factoryAddress);
    }

    function sellTokens(uint256 tokenAmount) external {
        require(tokenAmount > 0, "No tokens sent");
        require(checkLiquidity(), "No liquidity");

        IERC20 token = _getErc20Instance();

        uint256 senderBalance = token.balanceOf(msg.sender);
        require(senderBalance >= tokenAmount, "Insufficient balance");

        uint256 ethOut = getEthOut(tokenAmount);
        uint256 feeAmount = _calculateFee(ethOut);
        uint256 amountAfterFee = ethOut - feeAmount;

        _transferFee(feeAmount);

        require(
            token.transferFrom(msg.sender, address(this), tokenAmount),
            "Token transfer failed"
        );

        (bool success, ) = msg.sender.call{value: amountAfterFee}("");
        require(success, "ETH transfer failed");

        TokenFactory tokenFactory = _getTokenFactoryInstance();

        tokenFactory.swapEvent(
            msg.sender,
            0,
            tokenAmount,
            amountAfterFee,
            0,
            msg.sender
        );

        tokenFactory.syncEvent(
            address(this).balance,
            token.balanceOf(address(this))
        );
    }

    function getPrice() public view returns (uint256) {
        IERC20 token = _getErc20Instance();
        uint256 tokenBalance = token.balanceOf(address(this));
        uint256 nativeBalance = address(this).balance;

        if (tokenBalance == 0 || nativeBalance == 0) return 0;

        return (nativeBalance * 1e18) / tokenBalance;
    }

    function getReserves()
        external
        view
        returns (uint256 _tokenBalance, uint256 _ethBalance)
    {
        IERC20 token = _getErc20Instance();
        uint256 tokenBalance = token.balanceOf(address(this));
        uint256 nativeBalance = address(this).balance;

        return (tokenBalance, nativeBalance);
    }

    receive() external payable {}
}
