// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.6.6;

interface IBPool {
    function isBound(address token) external view returns(bool);
    function getBalance(address token) external view returns (uint);
    function totalSupply() external view returns (uint);
    function rebind(address token, uint balance, uint denorm) external;
    function setSwapFee(uint swapFee) external;
    function setPublicSwap(bool publicSwap) external;
    function isPublicSwap() external view returns (bool);
    function bind(address token, uint balance, uint denorm) external;
    function unbind(address token) external;
    function getDenormalizedWeight(address token) external view returns (uint);
    function getTotalDenormalizedWeight() external view returns (uint);
    function gulp(address token) external;

    function calcPoolOutGivenSingleIn(
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint poolSupply,
        uint totalWeight,
        uint tokenAmountIn,
        uint swapFee
    )
        external pure
        returns (uint poolAmountOut);

    function calcSingleInGivenPoolOut(
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint poolSupply,
        uint totalWeight,
        uint poolAmountOut,
        uint swapFee
    )
        external pure
        returns (uint tokenAmountIn);

    function calcSingleOutGivenPoolIn(
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint poolSupply,
        uint totalWeight,
        uint poolAmountIn,
        uint swapFee
    )
        external pure
        returns (uint tokenAmountOut);

    function calcPoolInGivenSingleOut(
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint poolSupply,
        uint totalWeight,
        uint tokenAmountOut,
        uint swapFee
    )
        external pure
        returns (uint poolAmountIn);

    function getCurrentTokens()
        external view
        returns (address[] memory tokens);
}

interface IBFactory {

    function isBPool(address b) external view returns (bool);
    function newBPool() external returns (IBPool);
    function getBLabs() external view returns (address);
    function setBLabs(address b) external;
    function collect(IBPool pool) external;

}
