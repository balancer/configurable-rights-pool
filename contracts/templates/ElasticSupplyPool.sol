// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.6.12;

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
 * @notice This is a subclass/extension of the Configurable Rights Pool
 * @dev Rights are defined as follows (index values into the array)
 *      0: canPauseSwapping - can setPublicSwap back to false after turning it on
 *                            by default, it is off on initialization and can only be turned on
 *      1: canChangeSwapFee - can setSwapFee after initialization (by default, it is fixed at create time)
 *      2: canChangeWeights - can resyncWeight - Elastic supply pools change weights without transferring tokens
 *                            the base class methods of changing weights, which do transfer tokens, are disabled
 *      3: canAddRemoveTokens - can bind/unbind tokens (allowed by default in base pool)
 *      4: canWhitelistLPs - can restrict LPs to a whitelist
 *      5: canChangeCap - can change the BSP cap (max # of pool tokens)
 *
 * Note that functions called on bPool may look like internal calls,
 *   but since they are contracts accessed through an interface, they are really external.
 * To make this explicit, we could write "IBPool(address(bPool)).function()" everywhere,
 *   instead of "bPool.function()".
 */
contract ElasticSupplyPool is ConfigurableRightsPool {
    using BalancerSafeMath for uint;

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
     * @param poolParams - CRP pool parameters
     * @param rightsParams - Set of permissions we are assigning to this smart pool
     */
    constructor(
        address factoryAddress,
        ConfigurableRightsPool.PoolParams memory poolParams,
        RightsManager.Rights memory rightsParams
    )
        // solhint-disable-next-line visibility-modifier-order
        public
        ConfigurableRightsPool(factoryAddress, poolParams, rightsParams)
        // solhint-disable-next-line no-empty-blocks
    {
        // Nothing to do after initializing the base class
    }

    // External functions

    /**
     * @notice ElasticSupply pools don't have updateWeightsGradually, so cannot call this
     * param initialSupply starting token balance
     * param minimumWeightChangeBlockPeriod - Enforce a minimum time between the start and end blocks
     * param addTokenTimeLockInBlocks - Enforce a mandatory wait time between updates
     *                                   This is also the wait time between committing and applying a new token
     */
    function createPool(
        uint, // initialSupply
        uint, // minimumWeightChangeBlockPeriod
        uint // addTokenTimeLockInBlocks
    )
        external
        override
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
        needsBPool
        override
    {
       revert("ERR_UNSUPPORTED_OPERATION");
    }

    /**
     * @notice Update the weight of a token without changing the price (or transferring tokens)
     * @dev bPool is a contract interface; function calls on it are external
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
        require(ConfigurableRightsPool.getStartBlock() == 0, "ERR_NO_UPDATE_DURING_GRADUAL");
        require(IBPool(address(bPool)).isBound(token), "ERR_NOT_BOUND");

        // get cached balance
        uint tokenBalanceBefore = IBPool(address(bPool)).getBalance(token);

        // Sync balance
        IBPool(address(bPool)).gulp(token);

        // get new balance
        uint tokenBalanceAfter = IBPool(address(bPool)).getBalance(token);

        // No-Op
        if(tokenBalanceBefore == tokenBalanceAfter) {
            return;
        }

        uint weightBefore = IBPool(address(bPool)).getDenormalizedWeight(token);

        uint weightAfter = BalancerSafeMath.bdiv(
            BalancerSafeMath.bmul(weightBefore, tokenBalanceAfter),
            tokenBalanceBefore
        );

        IBPool(address(bPool)).rebind(token, tokenBalanceAfter, weightAfter);
    }
}
