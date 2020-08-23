// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

// Imports

import "../../libraries/BalancerSafeMath.sol";

// Contracts

/*
 * @author Balancer Labs
 * @title Wrap BalancerSafeMath for testing
*/
contract BalancerSafeMathMock {
    function bmul(uint a, uint b) external pure returns (uint) {
        return BalancerSafeMath.bmul(a, b);
    }

    function bdiv(uint a, uint b) external pure returns (uint) {
        return BalancerSafeMath.bdiv(a, b);
    }

    function bsub(uint a, uint b) external pure returns (uint) {
        return BalancerSafeMath.bsub(a, b);
    }

    function badd(uint a, uint b) external pure returns (uint) {
        return BalancerSafeMath.badd(a, b);
    }

    function bmod(uint a, uint b) external pure returns (uint) {
        return BalancerSafeMath.bmod(a, b);
    }

    function bmax(uint a, uint b) external pure returns (uint) {
        return BalancerSafeMath.bmax(a, b);
    }

    function bmin(uint a, uint b) external pure returns (uint) {
        return BalancerSafeMath.bmin(a, b);
    }

    function baverage(uint a, uint b) external pure returns (uint) {
        return BalancerSafeMath.baverage(a, b);
    }
}