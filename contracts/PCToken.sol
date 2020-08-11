// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.6;

// Imports

import "../libraries/BalancerSafeMath.sol";
import "../libraries/BalancerConstants.sol";

// Interface declarations

/* solhint-disable func-order */

interface IERC20 {
    // Emitted when the allowance of a spender for an owner is set by a call to approve.
    // Value is the new allowance
    event Approval(address indexed owner, address indexed spender, uint value);

    // Emitted when value tokens are moved from one account (from) to another (to).
    // Note that value may be zero
    event Transfer(address indexed from, address indexed to, uint value);

    // Returns the amount of tokens in existence
    function totalSupply() external view returns (uint);

    // Returns the amount of tokens owned by account
    function balanceOf(address account) external view returns (uint);

    // Returns the remaining number of tokens that spender will be allowed to spend on behalf of owner
    // through transferFrom. This is zero by default
    // This value changes when approve or transferFrom are called
    function allowance(address owner, address spender) external view returns (uint);

    // Sets amount as the allowance of spender over the caller’s tokens
    // Returns a boolean value indicating whether the operation succeeded
    // Emits an Approval event.
    function approve(address spender, uint amount) external returns (bool);

    // Moves amount tokens from the caller’s account to recipient
    // Returns a boolean value indicating whether the operation succeeded
    // Emits a Transfer event.
    function transfer(address recipient, uint amount) external returns (bool);

    // Moves amount tokens from sender to recipient using the allowance mechanism
    // Amount is then deducted from the caller’s allowance
    // Returns a boolean value indicating whether the operation succeeded
    // Emits a Transfer event
    function transferFrom(address sender, address recipient, uint amount) external returns (bool);
}

// Contracts

/**
 * @author Balancer Labs
 * @title Highly opinionated token implementation
*/
contract PCToken is IERC20 {
    using BalancerSafeMath for uint;

    // State variables
    string public constant NAME = "Balancer Smart Pool";
    uint8 public constant DECIMALS = 18;

    // No leading underscore per naming convention (non-private)
    // Cannot call totalSupply (name conflict)
    // solhint-disable-next-line private-vars-leading-underscore
    uint internal varTotalSupply;

    mapping(address => uint) private _balance;
    mapping(address => mapping(address => uint)) private _allowance;

    string private _symbol;

    // Event declarations

    // See definitions above; must be redeclared to be emitted from this contract
    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    // Function declarations

    /**
     * @notice Base token constructor
     * @param tokenSymbol - the token symbol
     */
    constructor (string memory tokenSymbol) public {
        _symbol = tokenSymbol;
    }

    // External functions

    /**
     * @notice Getter for allowance: amount spender will be allowed to spend on behalf of owner
     * @param owner - owner of the tokens
     * @param spender - entity allowed to spend the tokens
     * @return uint - remaining amount spender is allowed to transfer
     */
    function allowance(address owner, address spender) external view override returns (uint) {
        return _allowance[owner][spender];
    }

    /**
     * @notice Getter for current account balance
     * @param account - address we're checking the balance of
     * @return uint - token balance in the account
     */
    function balanceOf(address account) external view override returns (uint) {
        return _balance[account];
    }

    /**
     * @notice Approve owner (sender) to spend a certain amount
     * @dev emits an Approval event
     * @param spender - entity the owner (sender) is approving to spend his tokens
     * @param amount - number of tokens being approved
     * @return bool - result of the approval (will always be true if it doesn't revert)
     */
    function approve(address spender, uint amount) external override returns (bool) {
        // In addition to the increase/decreaseApproval functions, could
        //   avoid the "approval race condition" by only allowing calls to approve
        //   when the current approval amount is 0
        //
        // require(_allowance[msg.sender][spender] == 0, "ERR_RACE_CONDITION");

        _allowance[msg.sender][spender] = amount;

        emit Approval(msg.sender, spender, amount);

        return true;
    }

    /**
     * @notice Increase the amount the spender is allowed to spend on behalf of the owner (sender)
     * @dev emits an Approval event
     * @param spender - entity the owner (sender) is approving to spend his tokens
     * @param amount - number of tokens being approved
     * @return bool - result of the approval (will always be true if it doesn't revert)
     */
    function increaseApproval(address spender, uint amount) external returns (bool) {
        _allowance[msg.sender][spender] = BalancerSafeMath.badd(_allowance[msg.sender][spender], amount);

        emit Approval(msg.sender, spender, _allowance[msg.sender][spender]);

        return true;
    }

    /**
     * @notice Decrease the amount the spender is allowed to spend on behalf of the owner (sender)
     * @dev emits an Approval event
     * @dev If you try to decrease it below the current limit, it's just set to zero (not an error)
     * @param spender - entity the owner (sender) is approving to spend his tokens
     * @param amount - number of tokens being approved
     * @return bool - result of the approval (will always be true if it doesn't revert)
     */
    function decreaseApproval(address spender, uint amount) external returns (bool) {
        uint oldValue = _allowance[msg.sender][spender];
        // Gas optimization - if amount == oldValue (or is larger), set to zero immediately
        if (amount >= oldValue) {
            _allowance[msg.sender][spender] = 0;
        } else {
            _allowance[msg.sender][spender] = BalancerSafeMath.bsub(oldValue, amount);
        }

        emit Approval(msg.sender, spender, _allowance[msg.sender][spender]);

        return true;
    }

    /**
     * @notice Transfer the given amount from sender (caller) to recipient
     * @dev _move emits a Transfer event if successful
     * @param recipient - entity receiving the tokens
     * @param amount - number of tokens being transferred
     * @return bool - result of the transfer (will always be true if it doesn't revert)
     */
    function transfer(address recipient, uint amount) external override returns (bool) {
        require(recipient != address(0), "ERR_ZERO_ADDRESS");

        _move(msg.sender, recipient, amount);

        return true;
    }

    /**
     * @notice Transfer the given amount from sender to recipient
     * @dev _move emits a Transfer event if successful; may also emit an Approval event
     * @param sender - entity sending the tokens (must be caller or allowed to spend on behalf of caller)
     * @param recipient - recipient of the tokens
     * @param amount - number of tokens being transferred
     * @return bool - result of the transfer (will always be true if it doesn't revert)
     */
    function transferFrom(address sender, address recipient, uint amount) external override returns (bool) {
        require(recipient != address(0), "ERR_ZERO_ADDRESS");
        require(msg.sender == sender || amount <= _allowance[sender][msg.sender], "ERR_PCTOKEN_BAD_CALLER");

        _move(sender, recipient, amount);

        // memoize for gas optimization
        uint oldAllowance = _allowance[sender][msg.sender];

        // If the sender is not the caller, adjust the allowance by the amount transferred
        if (msg.sender != sender && oldAllowance != uint(-1)) {
            _allowance[sender][msg.sender] = BalancerSafeMath.bsub(oldAllowance, amount);

            emit Approval(msg.sender, recipient, _allowance[sender][msg.sender]);
        }

        return true;
    }

    // public functions

    /**
     * @notice Getter for the total supply
     * @dev declared external for gas optimization
     * @return uint - total number of tokens in existence
     */
    function totalSupply() external view override returns (uint) {
        return varTotalSupply;
    }

    // Public functions

    /**
     * @dev Returns the name of the token.
     */
    function name() external pure returns (string memory) {
        return NAME;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() external view returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the value {ERC20} uses, unless {_setupDecimals} is
     * called.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    // internal functions

    // Mint an amount of new tokens, and add them to the balance (and total supply)
    // Emit a transfer amount from the null address to this contract
    function _mint(uint amount) internal {
        _balance[address(this)] = BalancerSafeMath.badd(_balance[address(this)], amount);
        varTotalSupply = BalancerSafeMath.badd(varTotalSupply, amount);

        emit Transfer(address(0), address(this), amount);
    }

    // Burn an amount of new tokens, and subtract them from the balance (and total supply)
    // Emit a transfer amount from this contract to the null address
    function _burn(uint amount) internal {
        // Can't burn more than we have
        // Remove require for gas optimization - bsub will revert on underflow
        // require(_balance[address(this)] >= amount, "ERR_INSUFFICIENT_BAL");

        _balance[address(this)] = BalancerSafeMath.bsub(_balance[address(this)], amount);
        varTotalSupply = BalancerSafeMath.bsub(varTotalSupply, amount);

        emit Transfer(address(this), address(0), amount);
    }

    // Transfer tokens from sender to recipient
    // Adjust balances, and emit a Transfer event
    function _move(address sender, address recipient, uint amount) internal {
        // Can't send more than sender has
        // Remove require for gas optimization - bsub will revert on underflow
        // require(_balance[sender] >= amount, "ERR_INSUFFICIENT_BAL");

        _balance[sender] = BalancerSafeMath.bsub(_balance[sender], amount);
        _balance[recipient] = BalancerSafeMath.badd(_balance[recipient], amount);

        emit Transfer(sender, recipient, amount);
    }

    // Transfer from this contract to recipient
    // Emits a transfer event if successful
    function _push(address recipient, uint amount) internal {
        _move(address(this), recipient, amount);
    }

    // Transfer from recipient to this contract
    // Emits a transfer event if successful
    function _pull(address sender, uint amount) internal {
        _move(sender, address(this), amount);
    }
}
