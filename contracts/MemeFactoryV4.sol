// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract MemeToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 8;
    uint256 public override totalSupply;
    
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply, address dex, address treasury) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply * 10 ** uint256(decimals);
        
        // 1% Launch Fee (Token Supply)
        uint256 taxAmount = totalSupply / 100; 
        uint256 dexAmount = totalSupply - taxAmount;

        // Mint 99% to the dex
        balanceOf[dex] = dexAmount;
        emit Transfer(address(0), dex, dexAmount);

        // Mint 1% to the platform treasury (Launch Fee)
        balanceOf[treasury] = taxAmount;
        emit Transfer(address(0), treasury, taxAmount);
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external override returns (bool) {
        require(balanceOf[sender] >= amount, "Insufficient balance");
        require(allowance[sender][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        allowance[sender][msg.sender] -= amount;
        
        emit Transfer(sender, recipient, amount);
        return true;
    }
}

interface IMemeDex {
    function initializePool(address token) external;
}

contract MemeFactoryV4 {
    address public treasury;
    address public dexAddress;

    event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl);

    constructor(address _treasury, address _dexAddress) {
        treasury = _treasury;
        dexAddress = _dexAddress;
    }

    function createMemeToken(string memory name, string memory symbol, uint256 initialSupply, string memory imageUrl) external payable returns (address) {
        // Create token with 1% supply sent to treasury as launch fee, and 99% sent to Dex
        MemeToken newToken = new MemeToken(name, symbol, initialSupply, dexAddress, treasury);
        
        // Initialize the pool in the Dex
        IMemeDex(dexAddress).initializePool(address(newToken));

        emit MemeLaunched(msg.sender, address(newToken), name, symbol, imageUrl);
        
        // Explicitly refund ANY HBAR sent as a buffer
        uint256 excess = msg.value;
        if (excess > 0) {
            (bool success, ) = msg.sender.call{value: excess}("");
            require(success, "HBAR Buffer Refund Failed");
        }
        
        return address(newToken);
    }
}
