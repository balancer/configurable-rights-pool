// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.6;

// Needed to handle structures externally
pragma experimental ABIEncoderV2;

// Imports

import "./ElasticSupplyPool.sol";

// Contracts

/**
 * @author Balancer Labs
 * @title Configurable Rights Pool Factory - create parameterized smart pools
 * @dev Rights are held in a corresponding struct in ConfigurableRightsPool
 *      Index values are as follows:
 *      0: canPauseSwapping - can setPublicSwap back to false after turning it on
 *                            by default, it is off on initialization and can only be turned on
 *      1: canChangeSwapFee - can setSwapFee after initialization (by default, it is fixed at create time)
 *      2: canChangeWeights - can bind new token weights (allowed by default in base pool)
 *      3: canAddRemoveTokens - can bind/unbind tokens (allowed by default in base pool)
 *      4: canWhitelistLPs - if set, only whitelisted addresses can join pools
 *                           (enables private pools with more than one LP)
 */
contract ESPFactory {
    // State variables

    // Keep a list of all Elastic Supply Pools
    mapping(address => bool) private _isEsp;

    // Event declarations

    // Log the address of each new smart pool, and its creator
    event LogNewEsp(
        address indexed caller,
        address indexed pool
    );

    // Function declarations

    /**
     * @notice Create a new ESP
     * @dev emits a LogNewESP event
     * @param factoryAddress - the BFactory instance used to create the underlying pool
     * @param tokens - initial set of tokens
     * @param startBalances - initial balances (parallel array)
     * @param startWeights - initial weights (parallal array)
     * @param swapFee - initial swap fee
     * @param rights - struct of permissions, configuring this CRP instance (see above for definitions)
     */
    function newEsp(
        address factoryAddress,
        string calldata symbol,
        address[] calldata tokens,
        uint[] calldata startBalances,
        uint[] calldata startWeights,
        uint swapFee,
        RightsManager.Rights calldata rights
    )
        external
        returns (ElasticSupplyPool)
    {
        require(tokens.length >= BalancerConstants.MIN_ASSET_LIMIT, "ERR_TOO_FEW_TOKENS");

        // Arrays must be parallel
        require(startBalances.length == tokens.length, "ERR_START_BALANCES_MISMATCH");
        require(startWeights.length == tokens.length, "ERR_START_WEIGHTS_MISMATCH");

        // We have two parameters that could cause mischief: the string symbol, and the rights struct
        // With well-behaved arguments, the size of the calldata should vary only proportionally to the
        // length of the 3 token arrays (32 bytes per slot * 3 arrays * length of arrays = 96 * number of tokens)
        // So we can calculated the expected size with a fixed offset + linear token measure
        uint expectedCalldataLength = 516 + 96 * tokens.length;
        // The symbol will fit unless it exceeds 32 characters (tricky to get the length of a UTF8 string directly)
        // The struct should be handled by the optimizer, but it may be possible to choose an input value or size
        // that would cause trouble.
        // Therefore, enforce that the calldata is the expected size, as a general defensive measure
        require(msg.data.length == expectedCalldataLength, "ERR_INVALID_PARAMETERS");

        ElasticSupplyPool esp = new ElasticSupplyPool(
            factoryAddress,
            symbol,
            tokens,
            startBalances,
            startWeights,
            swapFee,
            rights
        );

        _isEsp[address(esp)] = true;
        esp.setController(msg.sender);

        emit LogNewEsp(msg.sender, address(esp));

        return esp;
    }

    /**
     * @notice Check to see if a given address is a CRP
     * @param addr - address to check
     * @return boolean indicating whether it is a CRP
     */
    function isEsp(address addr) external view returns (bool) {
        return _isEsp[addr];
    }
}
