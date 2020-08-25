// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.6.12;

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
     * @param poolParams - CRP pool parameters
     * @param rights - struct of permissions, configuring this CRP instance (see above for definitions)
     */
    function newEsp(
        address factoryAddress,
        ConfigurableRightsPool.PoolParams calldata poolParams,
        RightsManager.Rights calldata rights
    )
        external
        returns (ElasticSupplyPool)
    {
        require(poolParams.constituentTokens.length >= BalancerConstants.MIN_ASSET_LIMIT, "ERR_TOO_FEW_TOKENS");

        // Arrays must be parallel
        require(poolParams.tokenBalances.length == poolParams.constituentTokens.length, "ERR_START_BALANCES_MISMATCH");
        require(poolParams.tokenWeights.length == poolParams.constituentTokens.length, "ERR_START_WEIGHTS_MISMATCH");

        ElasticSupplyPool esp = new ElasticSupplyPool(
            factoryAddress,
            poolParams,
            rights
        );

        emit LogNewEsp(msg.sender, address(esp));

        _isEsp[address(esp)] = true;
        esp.setController(msg.sender);

        return esp;
    }

    /**
     * @notice Check to see if a given address is an ESP
     * @param addr - address to check
     * @return boolean indicating whether it is an ESP
     */
    function isEsp(address addr) external view returns (bool) {
        return _isEsp[addr];
    }
}
