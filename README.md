# Configurable Rights Pool

This is a smart pool factory that allows anyone to deploy smart pools with (in the reference implementation) five 
different rights that can be individually chosen:

1) canPauseSwapping: pool creator can pause swaps (base pools can turn swapping on, but not off)
2) canChangeSwapFee: pool creator can change trading fees (subject to min/max values)
3) canChangeWeights: pool creator can change weights, either individually, or following a plan for gradual updates
4) canAddRemoveTokens: pool creator can add/remove tokens (subject to the base pool limits)
5) canWhitelistLPs: pool creator can specify a list of addresses allowed to add/remove liquidity

### CRPFactory.sol

Creates new ConfigurableRightsPools & stores their addresses in a registry.

#### `newCrp`

Creates new ConfigurableRightsPools with the caller as the contract controller.

##### Params
* `address factoryAddress` - BFactory address.
* `string symbol` - The symbol used for the pool token.
* `address[] tokens` - Array of 2-8 token addresses. The pool will hold these.
* `uint256[] startBalances` - Array of initial balances for the tokens specified above.
* `uint256[] startWeights` - Array of initial weights for the tokens specified above.
* `uint swapFee` - Initial swap fee for the pool (subject to min/max limits)
* `RightsManager.Rights rights` - Structure defined in an external linked library, with boolean flags for each right

##### Response
```
Returns address of the new ConfigurableRightsPool.
```
##### Example Code

Note that the weights are "denormalized" values, from 1 to 50 (really 49, as there must be at least two tokens, and the sum must be <= 50>). <br>The denormalized weight of a token is half of its proportional weight (as a percentage). <br>So, a 98% / 2% pool's tokens would have denormalized weights of 49 and 1.

```javascript
const permissions = {
    canPauseSwapping: false,
    canChangeSwapFee: true,
    canChangeWeights: false,
    canAddRemoveTokens: false,
    canWhitelistLPs: false,
};

await crpFactory.newCrp(
    bfactory.address,
    [XYZ, WETH, DAI],
    [toWei('80000'), toWei('40'), toWei('10000')],
    [toWei('12'), toWei('1.5'), toWei('1.5')],
    toWei('0.003'),
    10,
    10,
    permissions
);
```

### ConfigurableRightsPool.sol

> **Pause Swapping Right**

`setPublicSwap(bool publicSwap)`

Turn swapping on (if publicSwap is true), or off - if the pool has that right assigned.

> **Change Swap Fee Right**

`setSwapFee(uint swapFee)`

Set the pool's swap fee (within min/max limits set by the underlying pool)

> **Change weights Right**

`upDateWeight(address token, uint newWeight)`

Updates weight for a given token, while keeping prices the same.
<br>This will change the token balances, and cause tokens to be transferred to or from the caller's wallet
<br>NB: This cannot be done while a gradual update is underway (see below)

`updateWeightsGradually(uint[] newWeights, uint startBlock, uint endBlock)`

Transform all weights gradually and linearly from their present values to those specified in newWeights.
<br>The weights are actually changed, between the specified start and end blocks, by pokeWeights.
<br>This is very flexible. For instance, to halt the update sequence, call this function again with current weights.

`pokeWeights()`

Can be called by anyone (e.g., every block), to move the weights along the scheduled trajectory.

> **Add/Remove tokens Right**

`commitAddToken(address token, uint balance, uint denormalizedWeight)`

Precommits a new token that can be applied addTokenTimeLockInBlocks blocks in the future.

`applyAddToken()`

Applies the token committed in the step above, and mints pool shares -
<br>(if at least addTokenTimeLockInBlocks blocks have passed since the commit).

`removeToken(address token)`

Removes an existing token and returns the balance to the controller.

> **Whitelist Liquidity Provider Right**

`whitelistLiquidityProvider(address provider)`

Add an address, after which this address can join a pool. (Initially, no one can add liquidity, including the controller)

> Creating a pool from the Factory

`createPool(uint initialSupply)`

Creates a pool with the given initial supply of Pool Tokens (with the asset allocation and weights specified by the factory)
<br>Use this constructor if you canChangeWeights is false, or you accept the default block time parameters for gradual weight change

`createPool(uint initialSupply, uint minimumWeightChangeBlockPeriod, uint addTokenTimeLockInBlocks)`

This overload allows you to specify the block timing parameters (within limits), at pool creation time. They are fixed thereafter.
<br>So you cannot call updateWeightsGradually with a duration <em>(endBlock - startBlock) < minimumWeightChangeBlockPeriod</em>.
<br><em>addTokenTimeLockInBlocks</em> is the total number of blocks that have to pass before a new commited token can be applied

> Adding/Removing Liquidity

`joinPool(uint poolAmountOut, uint[] maxAmountsIn)`

Deposit at most the token amounts specified in <em>maxAmountsIn</em>, and receive <em>poolAmountOut</em> pool tokens in return.

`exitPool(uint poolAmountIn, uint[] minAmountsOut)`

Redeem <em>poolAmountIn</em> pool tokens for at least the token amounts specified in <em>minAmountsOut</em>

There are additional variations for specifying exact amounts (Uniswap-style)

### PCToken.sol

Balancer Smart Pool token. A standard ERC-20 with some extra math functions. Note that the math is normalized such that "1" is 10^18

### IBFactory.sol

Interface for the [Balancer Factory](https://github.com/balancer-labs/balancer-core/blob/master/contracts/BFactory.sol).

## NOTE

You cannot exit 100% using Pool Tokens (rebind will revert). It is possible to do using unbind with special permissions, but the trade-off is a potential loss of security.

## Balancer Pool Templates

Our vision is to provide a set of configurable Balancer Pools that are feature-rich and flexible enough to be used "out of the box" in most cases, and easily extended otherwise.
<br><br>Beyond the standard Configurable Rights Pool, the first such template (used by [Ampleforth](https://ampleforth.org)) is designed for pools containing tokens with "Elastic Supply" (e.g., AMPL). With "Fixed Supply" tokens, notably Bitcoin, your wallet balance remains constant (one hopes), but the price responds to supply and demand. <br><br>By contrast, Elastic Supply tokens expand and contract the **supply** in response to demand. The balance in your wallet <em>can change</em> (after each daily **rebase**) - but you always own a fixed proportion of the total number of tokens.

<br>These go in the [templates](https://github.com/balancer-labs/configurable-rights-pool/tree/master/contracts/templates) directory. The first is `ElasticSupplyPool` (and corresponding `ESPFactory`)

<br>All the current projects (that we know about) based on Balancer are featured on our main [web site](https://balancer.finance). Want to add yours to the list? Drop us a line at 
<contact@balancer.finance>

## Getting Started - Local Testing

`yarn`

`yarn testrpc`

`yarn test`
