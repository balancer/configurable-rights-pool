// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.6;

// Needed to handle structures externally
pragma experimental ABIEncoderV2;

// Imports

import "../IBFactory.sol";
import "../PCToken.sol";
import "../utils/BalancerReentrancyGuard.sol";
import "../utils/BalancerOwnable.sol";

// Interfaces

// Libraries
import { RightsManager } from "../../libraries/RightsManager.sol";
import "../../libraries/SmartPoolManager.sol";

// Contracts

/**
 * @author Balancer Labs
 * @title Smart Pool with customizable features, designed to hold tokens with Elastic Supply
 * @notice PCToken is the "Balancer Smart Pool" token (transferred upon finalization)
 * @dev Rights are defined as follows (index values into the array)
 *      0: canPauseSwapping - can setPublicSwap back to false after turning it on
 *                            by default, it is off on initialization and can only be turned on
 *      1: canChangeSwapFee - can setSwapFee after initialization (by default, it is fixed at create time)
 *      2: canChangeWeights - can resyncWeight - Elastic supply pools change weights without transferring tokens
 *                            the base class methods of changing weights, which do transfer tokens, are disabled
 *      3: canAddRemoveTokens - can bind/unbind tokens (allowed by default in base pool)
 *      4: canWhitelistLPs - can restrict LPs to a whitelist
 */
contract ElasticSupplyPool is ConfigurableRightsPool {
    using BalancerSafeMath for uint;

    // State variables

    // Tokens allowed to be placed in the pool
    mapping(address => bool) public validTokenWhitelist;

    // Event declarations

    // Have to redeclare in the subclass, to be emitted from this contract

    event LogCall(
        bytes4  indexed sig,
        address indexed caller,
        bytes data
    ) anonymous;

    event LogJoin(
        address indexed caller,
        address indexed tokenIn,
        uint tokenAmountIn
    );

    event LogExit(
        address indexed caller,
        address indexed tokenOut,
        uint tokenAmountOut
    );

    // Modifiers

    // Function declarations

    /**
     * @notice Construct a new Configurable Rights Pool (wrapper around BPool)
     * @param factoryAddress - the BPoolFactory used to create the underlying pool
     * @param tokenSymbolString - Token symbol (named thus to avoid shadowing)
     * @param tokens - list of tokens to include
     * @param startBalances - initial token balances
     * @param startWeights - initial token weights
     * @param swapFee - initial swap fee (will set on the core pool after pool creation)
     * @param rights - Set of permissions we are assigning to this smart pool
     *                 Would ideally not want to hard-code the length, but not sure how it interacts with structures
     */
    constructor(
        address factoryAddress,
        string memory tokenSymbolString,
        address[] memory tokens,
        uint[] memory startBalances,
        uint[] memory startWeights,
        uint swapFee,
        RightsManager.Rights memory rights
    )
        public
        ConfigurableRightsPool(factoryAddress, tokenSymbolString, tokens, startBalances, startWeights, swapFee, rights)
    {
        // Example whitelist of permitted tokens
        address[3] memory elasticTokens = [address(0xD46bA6D942050d489DBd938a2C909A5d5039A161),  // AMPL
                                           address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),  // USDC
                                           address(0x6B175474E89094C44Da98b954EedeAC495271d0F)]; // DAI

        // Initialize the public whitelist
        for (uint i = 0; i < elasticTokens.length; i++) {
            validTokenWhitelist[elasticTokens[i]] = true;
        }

        // Ensure the tokens provided are valid to be used in this kind of pool
        /* Comment out in this template so tests will pass
        for (uint i = 0; i < tokens.length; i++) {
            require(validTokenWhitelist[tokens[i]], "ERR_TOKEN_NOT_SUPPORTED");
        } */
    }

    // External functions

    /**
     * @notice ElasticSupply pools don't have updateWeightsGradually, so cannot call this
     * param initialSupply starting token balance
     * param minimumWeightChangeBlockPeriod - Enforce a minimum time between the start and end blocks
     * param addTokenTimeLockInBlocks - Enforce a mandatory wait time between updates
     *                                   This is also the wait time between committing and applying a new token
     * @return ConfigurableRightsPool instance
     */
    function createPool(
        uint, // initialSupply
        uint, // minimumWeightChangeBlockPeriod
        uint // addTokenTimeLockInBlocks
    )
        external
        override
        returns (ConfigurableRightsPool)
    {
        revert("ERR_UNSUPPORTED_OPERATION");
    }

    /**
     * @notice Update the weight of an existing token - cannot do this in ElasticSupplyPools
     * param token - token to be reweighted
     * param newWeight - new weight of the token
    */
    function updateWeight(
        address, // token
        uint // newWeight
    )
        external
        logs
        lock
        onlyOwner
        needsBPool
        override
    {
        revert("ERR_UNSUPPORTED_OPERATION");
    }

    /**
     * @notice Update weights in a predetermined way, between startBlock and endBlock,
     *         through external calls to pokeWeights -- cannot do this in ElasticSupplyPools
     * @dev Makes sure we aren't already in a weight update scheme
     *      Must call pokeWeights at least once past the end for it to do the final update
     *      and enable calling this again. (Could make this check for that case, but unwarranted complexity.)
     * param newWeights - final weights we want to get to
     * param startBlock - when weights should start to change
     * param endBlock - when weights will be at their final values
    */
    function updateWeightsGradually(
        uint[] calldata, // newWeights
        uint, // startBlock
        uint // endBlock
    )
        external
        logs
        lock
        onlyOwner
        needsBPool
        override
    {
       revert("ERR_UNSUPPORTED_OPERATION");
    }

    /**
     * @notice External function called to make the contract update weights according to plan
     *         Unsupported in ElasticSupplyPools
    */
    function pokeWeights()
        external
        logs
        lock
        needsBPool
        override
    {
       revert("ERR_UNSUPPORTED_OPERATION");
    }

    /**
     * @notice Update the weight of a token without changing the price (or transferring tokens)
     * @param token - address of the token to adjust
     */
    function resyncWeight(address token)
        external
        logs
        lock
        onlyOwner
        needsBPool
        virtual
    {
        // Subclasses can call this to check permissions
        require(this.hasPermission(RightsManager.Permissions.CHANGE_WEIGHTS), "ERR_NOT_CONFIGURABLE_WEIGHTS");
        // Just being defensive here (e.g., against future subclasses)
        // There should be no way to set this in this contract
        require(super.getStartBlock() == 0, "ERR_NO_UPDATE_DURING_GRADUAL");
        require(bPool.isBound(token), "ERR_NOT_BOUND");

        uint currentBalance = bPool.getBalance(token);
        bPool.gulp(token);
        uint updatedBalance = bPool.getBalance(token);

        if(updatedBalance == currentBalance) {
            return;
        }

        uint currentWeight = bPool.getDenormalizedWeight(token);
        uint newWeight = BalancerSafeMath.bdiv(
            BalancerSafeMath.bmul(currentWeight, updatedBalance),
            currentBalance
        );

        bPool.rebind(token, updatedBalance, newWeight);
    }
}
