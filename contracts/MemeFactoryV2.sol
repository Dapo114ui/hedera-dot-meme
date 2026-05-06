// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal ERC20 Interface
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract MemeToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public override totalSupply;
    
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply, address creator, address treasury) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply * 10 ** uint256(decimals);
        
        uint256 taxAmount = totalSupply / 100; // 1% Platform Fee
        uint256 creatorAmount = totalSupply - taxAmount;

        // Mint 99% to the creator
        balanceOf[creator] = creatorAmount;
        emit Transfer(address(0), creator, creatorAmount);

        // Mint 1% to the platform treasury
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

    function approve(address spender, uint256 amount) external returns (bool) {
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

contract MemeFactory {
    // Treasury: 0.0.8809059 (0x9391d8058f85be7909972a57def213387b50bb11)
    address public treasury;

    // Added imageUrl to the event so the website can find it
    event MemeLaunched(address indexed creator, address tokenAddress, string name, string symbol, string imageUrl);

    uint256 public launchFee = 5 * 10**18; // 5 HBAR (assuming 18 decimals for HBAR in EVM)

    constructor(address _treasury) {
        treasury = _treasury;
    }

    // Added imageUrl as an input parameter and made it payable for the launch fee
    function createMemeToken(string memory name, string memory symbol, uint256 initialSupply, string memory imageUrl) external payable returns (address) {
        require(msg.value >= launchFee, "Insufficient launch fee (5 HBAR required)");

        // Create token with 1% tax sent to treasury
        MemeToken newToken = new MemeToken(name, symbol, initialSupply, msg.sender, treasury);
        
        // Emit the event with the image URL stored in the logs
        emit MemeLaunched(msg.sender, address(newToken), name, symbol, imageUrl);
        
        return address(newToken);
    }

    // Allow the treasury to withdraw collected fees
    function withdrawFees() external {
        require(msg.sender == treasury, "Only treasury can withdraw fees");
        payable(treasury).transfer(address(this).balance);
    }
}
