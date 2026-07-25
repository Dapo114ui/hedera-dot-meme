// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHederaTokenService, HTS_SUCCESS} from "../IHederaTokenService.sol";

/// @notice A bare ERC20-shaped token standing in for a real HTS token in
/// tests. Deployed fresh by MockHederaTokenService on every
/// createFungibleToken call, exactly the way real HTS mints a genuinely
/// new token address each time. Only MockHederaTokenService may move
/// balances (via precompileTransfer) or mint - regular ERC20 transfer()
/// is deliberately NOT exposed, since production code never calls it
/// directly either (all moves go through the HTS precompile).
contract MockHtsToken {
    address public immutable precompile;
    string public name;
    string public symbol;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        precompile = msg.sender;
        name = _name;
        symbol = _symbol;
    }

    modifier onlyPrecompile() {
        require(msg.sender == precompile, "only precompile");
        _;
    }

    function mint(address to, uint256 amount) external onlyPrecompile {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    /// @notice Standard ERC20 approve - real HTS tokens are reachable
    /// through an ERC20 facade that supports this directly (not gated
    /// behind the 0x167 precompile), so this mock exposes it the same way.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /// @notice Moves `amount` from `from` to `to`. `actualCaller` is
    /// whoever really invoked HTS's transferToken (passed through by
    /// MockHederaTokenService, which sees it as its own msg.sender) -
    /// mirrors standard ERC20 transferFrom semantics: no allowance needed
    /// if actualCaller IS from (moving its own funds), otherwise
    /// actualCaller must have been approved by from.
    function precompileTransfer(
        address actualCaller,
        address from,
        address to,
        uint256 amount
    ) external onlyPrecompile {
        require(balanceOf[from] >= amount, "insufficient balance");
        if (actualCaller != from) {
            uint256 allowed = allowance[from][actualCaller];
            require(allowed >= amount, "insufficient allowance");
            allowance[from][actualCaller] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @notice Test double for the real 0x167 HTS precompile. Implements just
/// enough of IHederaTokenService for OnycBondingCurve's own logic (curve
/// math, fees, graduation, access control) to be exercised end-to-end on
/// a standard local EVM, which has no real HTS precompile at all. This is
/// NOT a claim that it faithfully reproduces every real HTS behavior -
/// only the parts OnycBondingCurve depends on.
contract MockHederaTokenService is IHederaTokenService {
    /// @dev Stand-in for HTS's real ~$1-equivalent network creation cost.
    /// Whatever of the caller's forwarded value exceeds this gets refunded
    /// immediately, mirroring real Hedera's documented behavior of only
    /// consuming the actual cost and returning the rest to the caller.
    /// @dev A plain local EVM (unlike real Hedera) does not rescale
    /// msg.value, so this mock's own units just need to match whatever
    /// scale OnycBondingCurve uses internally - tinybars (8 decimals),
    /// confirmed against a real deployment (see
    /// contracts/test/ValueScaleProbe.sol).
    uint256 public constant MOCK_REAL_HTS_COST = 15 * 10 ** 8;

    function createFungibleToken(
        HederaToken memory token,
        uint256 initialTotalSupply,
        uint256 /* decimals */
    ) external payable override returns (int64 responseCode, address tokenAddress) {
        MockHtsToken newToken = new MockHtsToken(token.name, token.symbol);
        newToken.mint(token.treasury, initialTotalSupply);

        if (msg.value > MOCK_REAL_HTS_COST) {
            (bool ok, ) = msg.sender.call{value: msg.value - MOCK_REAL_HTS_COST}("");
            require(ok, "mock refund failed");
        }

        return (HTS_SUCCESS, address(newToken));
    }

    function transferToken(
        address token,
        address sender,
        address recipient,
        int64 amount
    ) external override returns (int64 responseCode) {
        MockHtsToken(token).precompileTransfer(msg.sender, sender, recipient, uint256(uint64(amount)));
        return HTS_SUCCESS;
    }
}
