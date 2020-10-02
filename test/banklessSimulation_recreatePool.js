/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');
const { assert } = require('chai');
const BPool = artifacts.require('BPool')
const { time } = require('@openzeppelin/test-helpers');
const { calcInGivenOut, calcOutGivenIn, calcRelativeDiff } = require('../lib/calc_comparisons');
const Decimal = require('decimal.js');

contract('Bankless Simulation (recreate pool)', async (accounts) => {
    const admin = accounts[0];
    const user1 = accounts[1];
    const user2 = accounts[2];
    const user3 = accounts[3];

    const { toWei, fromWei } = web3.utils;
    const MAX = web3.utils.toTwosComplement(-1);
    const MaxBig256 = '115792089237316195423570985008687907853269984665640564039457.584007913129639935';
    const errorDelta = 10 ** -8;
    const numPoolTokens = '1000';

    let crpFactory; 
    let bFactory;
    let crpPool;
    let CRPPOOL;
    let DAI;
    let dai;
    let bap0;
    let bap1;
    let BAP0;
    let BAP1;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    const minSwapFee = toWei('0.000001');
    const initialDaiDeposit = '3000';

    // 2/38 is 5%/95%  Dai/Bap0
    const startWeights = [toWei('2'), toWei('38')];
    // 38 weight and 38 tokens is a coincidence
    const startBalances = [toWei(initialDaiDeposit), toWei('38')];
    const SYMBOL = 'BAPPT';
    const NAME = 'Bankless Apparel 0 BPT';

    let tokenAddresses;

    const permissions = {
        canPauseSwapping: true,
        canChangeSwapFee: true,
        canChangeWeights: true,
        canAddRemoveTokens: true,
        canWhitelistLPs: true,
        canChangeCap: false,
    };

    before(async () => {
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        bap0 = await TToken.new('BAP Gen 0', 'BAP0', 18);
        bap1 = await TToken.new('BAP Gen 1', 'BAP1', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        BAP0 = bap0.address;
        BAP1 = bap1.address;
        DAI = dai.address;

        // Initially 5% DAI / 95% BAP0
        tokenAddresses = [DAI, BAP0];

        // admin balances
        await bap0.mint(admin, toWei('38'));
        await bap1.mint(admin, toWei('150'));
        await dai.mint(admin, toWei('3000'));

        await dai.mint(user1, toWei('100000'));
        await dai.mint(user2, toWei('100000'));
        await dai.mint(user3, toWei('100000'));

        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: tokenAddresses,
            tokenBalances: startBalances,
            tokenWeights: startWeights,
            swapFee: swapFee,
        }

        CRPPOOL = await crpFactory.newCrp.call(
            bFactory.address,
            poolParams,
            permissions,
        );

        await crpFactory.newCrp(
            bFactory.address,
            poolParams,
            permissions,
        );

        crpPool = await ConfigurableRightsPool.at(CRPPOOL);

        const CRPPOOL_ADDRESS = crpPool.address;

        await bap0.approve(CRPPOOL_ADDRESS, MAX);
        await bap1.approve(CRPPOOL_ADDRESS, MAX);
        await dai.approve(CRPPOOL_ADDRESS, MAX);

        await crpPool.approve(user1, MAX);
        await crpPool.approve(user2, MAX);
        await crpPool.approve(user3, MAX);

        await crpPool.createPool(toWei(numPoolTokens), 0, 0);
    });

    it('crpPool should have correct rights set', async () => {
        let x;
        for (x = 0; x < permissions.length; x++) {
            const perm = await crpPool.hasPermission(x);
            if (x == 5) {
                assert.isFalse(perm);
            }
            else {
                assert.isTrue(perm)
            }
        }
    });

    it('ConfigurableRightsPool cap should be MAX after creation', async () => {
        const currentCap = await crpPool.bspCap();
        assert.equal(MaxBig256, fromWei(currentCap).toString());
    });

    it('Should not allow anyone to add liquidity', async () => {
        await truffleAssert.reverts(
            crpPool.joinswapPoolAmountOut.call(DAI, toWei('1'), MAX),
            'ERR_NOT_ON_WHITELIST',
        );    

        await truffleAssert.reverts(
            crpPool.joinswapPoolAmountOut.call(DAI, toWei('1'), MAX, {from: user3}),
            'ERR_NOT_ON_WHITELIST',
        );    
    });

    describe('BAP0 shirt auction', () => {
        it('Should configure the pool (min swap fee)', async () => {
            // Drop the fee to the minimum (cannot be 0)
            await crpPool.setSwapFee(minSwapFee);
            const bPoolAddr = await crpPool.bPool();
            const underlyingPool = await BPool.at(bPoolAddr);
    
            const deployedSwapFee = await underlyingPool.getSwapFee();
            assert.equal(minSwapFee, deployedSwapFee);
        });

        it('Should call updateWeightsGradually() with valid range', async () => {
            blockRange = 50;
            // get current block number
            const block = await web3.eth.getBlock('latest');
            console.log(`Block of updateWeightsGradually() call: ${block.number}`);
            startBlock = block.number + 10;
            const endBlock = startBlock + blockRange;
            const endWeights = [toWei('34'), toWei('6')];
            console.log(`Start block for Dai -> Bap0 flipping: ${startBlock}`);
            console.log(`End   block for Dai -> Bap0 flipping: ${endBlock}`);

            await crpPool.updateWeightsGradually(endWeights, startBlock, endBlock);
        });

        it('Should be able to poke weights (and buy shirts)', async () => {
            let weightBap0;
            let weightDai;

            let block = await web3.eth.getBlock('latest');
            console.log(`Block: ${block.number}`);                        
            while (block.number < startBlock) {
                // Wait for the start block
                block = await web3.eth.getBlock('latest');
                console.log(`Still waiting. Block: ${block.number}`);
                await time.advanceBlock();
            }

            const bPoolAddr = await crpPool.bPool();
            const underlyingPool = await BPool.at(bPoolAddr);
            let tokenAmountIn;
            let spotPriceAfter;

            await dai.approve(underlyingPool.address, MAX, { from: user1 });
            await bap0.approve(underlyingPool.address, MAX, { from: user1 });
            await dai.approve(underlyingPool.address, MAX, { from: user2 });
            await dai.approve(underlyingPool.address, MAX, { from: user3 });
           
            const users = [user1, user2, user3];
            let userIdx = 0;
            let user;

            let shirtsLeft = true;

            while (shirtsLeft) {
                weightBap0 = await crpPool.getDenormalizedWeight(BAP0);
                weightDai = await crpPool.getDenormalizedWeight(DAI);
                block = await web3.eth.getBlock("latest");
                console.log('\nBlock: ' + block.number + '. Weights -> BAP0: ' +
                    (weightBap0*2.5/10**18).toString() + '%\tDAI: ' +
                    (weightDai*2.5/10**18).toString() + '%');

                    const tokenInBalance = await dai.balanceOf.call(underlyingPool.address);
                    const tokenInWeight = await underlyingPool.getDenormalizedWeight(DAI);
                    const tokenOutBalance = await bap0.balanceOf.call(underlyingPool.address);
                    const tokenOutWeight = await underlyingPool.getDenormalizedWeight(BAP0);

                    // Rotate users
                    user = users[userIdx];
                    
                    const daiBalance = await dai.balanceOf.call(user);
                    const bap0Balance = await bap0.balanceOf.call(user);
                    console.log(`User ${userIdx + 1} has ${Math.round(fromWei(daiBalance))} Dai and ${fromWei(bap0Balance)} shirts.`);
                    console.log(`Pool has ${fromWei(tokenOutBalance)} shirts / ${Math.round(fromWei(tokenInBalance))} Dai left`);

                    if (3 == ++userIdx) {
                        userIdx = 0;
                    }

                    const bap0SpotPrice = await underlyingPool.getSpotPrice(DAI, BAP0);
                    console.log(`Spot price of 1 BAP0 = ${Decimal(fromWei(bap0SpotPrice)).toFixed(4)}`);
                    let amountOut = '1';

                    if (2 == userIdx) {
                        // Shenanigans - partial shirt purchases
                        amountOut = '0.5';
                    }
                    const expectedTotalIn = calcInGivenOut(
                        fromWei(tokenInBalance),
                        fromWei(tokenInWeight),
                        fromWei(tokenOutBalance),
                        fromWei(tokenOutWeight),
                        amountOut, // we want one BAP0 token out
                        fromWei(minSwapFee),
                    );
            
                    // user buys a shirt
                    // Static call (no transaction yet), so that I can get the return values
                    const swapResult = await underlyingPool.swapExactAmountOut.call(
                        DAI, // tokenIn
                        MAX, // maxAmountIn
                        BAP0, // tokenOut
                        toWei(amountOut), // tokenAmountOut
                        MAX, // maxPrice
                        { from: user },
                    );

                    tokenAmountIn = swapResult[0];
                    spotPriceAfter = swapResult[1];

                    console.log(`Actual cost: ${Decimal(fromWei(tokenAmountIn)).toFixed(2)}; spot price after is ${Decimal(fromWei(spotPriceAfter)).toFixed(2)}`);

                    const relDiff = calcRelativeDiff(expectedTotalIn, fromWei(tokenAmountIn));
                    assert.isAtMost(relDiff.toNumber(), errorDelta);

                    // Now actually do the transaction, so that it performs the swap
                    await underlyingPool.swapExactAmountOut(
                        DAI, // tokenIn
                        MAX, // maxAmountIn
                        BAP0, // tokenOut
                        toWei(amountOut), // tokenAmountOut
                        MAX, // maxPrice
                        { from: user },
                    );

                // What if we swap the token back in?
                if (0 == userIdx) {
                    const daiSpotPrice = await underlyingPool.getSpotPrice(BAP0, DAI);
                    console.log(`Spot price of 1 DAI = ${Decimal(fromWei(daiSpotPrice)).toFixed(2)}`);

                    const bapInBalance = await bap0.balanceOf.call(underlyingPool.address);
                    const bapInWeight = await underlyingPool.getDenormalizedWeight(BAP0);
                    const daiOutBalance = await dai.balanceOf.call(underlyingPool.address);
                    const daiOutWeight = await underlyingPool.getDenormalizedWeight(DAI);
                    
                    const expectedTotalOut = calcOutGivenIn(
                        fromWei(bapInBalance),
                        fromWei(bapInWeight),
                        fromWei(daiOutBalance),
                        fromWei(daiOutWeight),
                        '1', // tokenAmountIn
                        fromWei(minSwapFee),
                    );

                    const daiAmountOut = await underlyingPool.swapExactAmountIn.call(
                        BAP0,
                        toWei('1'), // tokenAmountIn - return the shirt
                        DAI,
                        toWei('0'), // minAmountOut
                        MAX, // max price
                        { from: user1 },
                    );

                    console.log(`User put the token back, and got ${Decimal(fromWei(daiAmountOut[0])).toFixed(2)} Dai back`);

                    relDif = calcRelativeDiff(expectedTotalOut, fromWei(daiAmountOut[0]));
                    assert.isAtMost(relDif.toNumber(), errorDelta);

                    await underlyingPool.swapExactAmountIn(
                        BAP0,
                        toWei('1'), // tokenAmountIn
                        DAI,
                        toWei('0'), // minAmountOut
                        MAX, // max price
                        { from: user1 },
                    );
                }
                
                await crpPool.pokeWeights();
                
                const finalShirtBalance = await bap0.balanceOf.call(underlyingPool.address);
                // Can never go below 2
                shirtsLeft = fromWei(finalShirtBalance) > 2;
            }
        }).timeout(0);

        it('Controller should recover remaining tokens and proceeds', async () => {
            const bPoolAddr = await crpPool.bPool();
            const underlyingPool = await BPool.at(bPoolAddr);

            // Prevent trading
            await crpPool.setPublicSwap(false);

            poolDaiBalance = await dai.balanceOf.call(underlyingPool.address);
            console.log(`Final pool Dai balance: ${Decimal(fromWei(poolDaiBalance)).toFixed(2)}`);
            poolShirtBalance = await bap0.balanceOf.call(underlyingPool.address);
            console.log(`Final pool shirt balance: ${Decimal(fromWei(poolShirtBalance)).toFixed(4)}`);

            // Destroy the pool by simply removing both tokens
            // If we just remove both, the pool will be destroyed
            // We want to reuse it, and there are two ways:
            // 1) Don't remove tokens - do it by calling exitPool repeatedly (see banklessSimulation test)
            // 2) Remove and add so that we always have at least one token
            //    This also allows using other project tokens (e.g., BAP0 -> BAP1 -> BAP2)
            await crpPool.removeToken(DAI);

            const numTokens = await underlyingPool.getNumTokens.call();
            assert.equal(numTokens, 1);

            const adminDaiBalance = await dai.balanceOf.call(admin);
            console.log(`Final admin Dai balance: ${Decimal(fromWei(adminDaiBalance)).toFixed(2)}`);
 
            // Make sure they recovered all collateral
            assert.equal(poolDaiBalance - adminDaiBalance, 0);
         });

        it('Should allow adding a new project token, then recovering the old one', async () => {
            const bPoolAddr = await crpPool.bPool();
            const underlyingPool = await BPool.at(bPoolAddr);

            console.log(`DAI address = ${DAI}`);
            console.log(`BAP0 address = ${BAP0}`);
            console.log(`BAP1 address = ${BAP1}`);

            // The pool currently only contains BAP0, with the end weight of 6
            // Now add the new project token, with weight 38
            // And DAI, with weight 2
            // Finally, remove BAP0
            await crpPool.commitAddToken(BAP1, toWei('150'), toWei('38'));
            await time.advanceBlock();
            await crpPool.applyAddToken();

            // BAP0 and BAP1
            let numTokens = await underlyingPool.getNumTokens.call();
            console.log(`Num tokens = ${numTokens}`);

            assert.equal(numTokens, 2);
            let tokens = await underlyingPool.getCurrentTokens.call();
            let i;
            for (i = 0; i < tokens.length; i++) {
                console.log(tokens[i]);
            };

            console.log("Getting Bap0 balance");

            let poolBAP0Balance = await bap0.balanceOf.call(underlyingPool.address);
            console.log(`Pool BAP0 balance: ${Decimal(fromWei(poolBAP0Balance)).toFixed(2)}`);
            let poolBAP0Weight = await crpPool.getDenormalizedWeight(BAP0)
            console.log(`Pool BAP0 weight: ${Decimal(fromWei(poolBAP0Weight)).toFixed(2)}`);

            let poolBAP1Balance = await bap1.balanceOf.call(underlyingPool.address);
            console.log(`Pool BAP1 balance: ${Decimal(fromWei(poolBAP1Balance)).toFixed(2)}`);
            let poolBAP1Weight = await crpPool.getDenormalizedWeight(BAP1)
            console.log(`Pool BAP1 weight: ${Decimal(fromWei(poolBAP1Weight)).toFixed(2)}`);


            // Now add DAI collateral
            await crpPool.commitAddToken(DAI, toWei('3000'), toWei('2'));
            await time.advanceBlock();
            await crpPool.applyAddToken();

            // BAP0, BAP1, DAI
            numTokens = await underlyingPool.getNumTokens.call();
            assert.equal(numTokens, 3);
            tokens = await underlyingPool.getCurrentTokens.call();
            for (i = 0; i < tokens.length; i++) {
                console.log(tokens[i]);
            };

            poolBAP0Balance = await bap0.balanceOf.call(underlyingPool.address);
            console.log(`Pool BAP0 balance: ${Decimal(fromWei(poolBAP0Balance)).toFixed(2)}`);
            poolBAP0Weight = await crpPool.getDenormalizedWeight(BAP0)
            console.log(`Pool BAP0 weight: ${Decimal(fromWei(poolBAP0Weight)).toFixed(2)}`);

            poolBAP1Balance = await bap1.balanceOf.call(underlyingPool.address);
            console.log(`Pool BAP1 balance: ${Decimal(fromWei(poolBAP1Balance)).toFixed(2)}`);
            poolBAP1Weight = await crpPool.getDenormalizedWeight(BAP1)
            console.log(`Pool BAP1 weight: ${Decimal(fromWei(poolBAP1Weight)).toFixed(2)}`);

            let poolDAIBalance = await dai.balanceOf.call(underlyingPool.address);
            console.log(`Pool DAI balance: ${Decimal(fromWei(poolDAIBalance)).toFixed(2)}`);
            let poolDAIWeight = await crpPool.getDenormalizedWeight(DAI)
            console.log(`Pool DAI weight: ${Decimal(fromWei(poolDAIWeight)).toFixed(2)}`);

            // Finally, recover BAP0 tokens
            await crpPool.removeToken(BAP0);

            // BAP1, DAI
            numTokens = await underlyingPool.getNumTokens.call();
            assert.equal(numTokens, 2);
            tokens = await underlyingPool.getCurrentTokens.call();
            for (i = 0; i < tokens.length; i++) {
                console.log(tokens[i]);
            };

            adminBAP0Balance = await bap0.balanceOf.call(admin);
            console.log(`Admin BAP0 balance: ${Decimal(fromWei(adminBAP0Balance)).toFixed(2)}`);
            // Ensure we recovered all the original tokens
            assert.equal(Decimal(fromWei(adminBAP0Balance)), 2)
 
            poolBAP1Balance = await bap1.balanceOf.call(underlyingPool.address);
            console.log(`Pool BAP1 balance: ${Decimal(fromWei(poolBAP1Balance)).toFixed(2)}`);
            poolBAP1Weight = await crpPool.getDenormalizedWeight(BAP1)
            console.log(`Pool BAP1 weight: ${Decimal(fromWei(poolBAP1Weight)).toFixed(2)}`);
            assert.equal(Decimal(fromWei(poolBAP1Balance)), 150)
            assert.equal(Decimal(fromWei(poolBAP1Weight)), 38)

            poolDAIBalance = await dai.balanceOf.call(underlyingPool.address);
            console.log(`Pool DAI balance: ${Decimal(fromWei(poolDAIBalance)).toFixed(2)}`);
            poolDAIWeight = await crpPool.getDenormalizedWeight(DAI)
            console.log(`Pool DAI weight: ${Decimal(fromWei(poolDAIWeight)).toFixed(2)}`);
            assert.equal(Decimal(fromWei(poolDAIBalance)), 3000)
            assert.equal(Decimal(fromWei(poolDAIWeight)), 2)
        });

        it('Should allow a second auction for BAP1', async () => {
            blockRange = 50;
            // get current block number
            const block = await web3.eth.getBlock('latest');
            console.log(`Block of updateWeightsGradually() call: ${block.number}`);
            startBlock = block.number + 10;
            const endBlock = startBlock + blockRange;
            const endWeights = [toWei('34'), toWei('6')];
            console.log(`Start block for Dai -> Bap1 flipping: ${startBlock}`);
            console.log(`End   block for Dai -> Bap1 flipping: ${endBlock}`);

            await crpPool.updateWeightsGradually(endWeights, startBlock, endBlock);
            // Need to turn public swapping back on!
            await crpPool.setPublicSwap(true);
        });

        it('Should be able to poke weights (and buy BAP1 items)', async () => {
            let weightBap1;
            let weightDai;

            let block = await web3.eth.getBlock('latest');
            console.log(`Block: ${block.number}`);                        
            while (block.number < startBlock) {
                // Wait for the start block
                block = await web3.eth.getBlock('latest');
                console.log(`Still waiting. Block: ${block.number}`);
                await time.advanceBlock();
            }

            const bPoolAddr = await crpPool.bPool();
            const underlyingPool = await BPool.at(bPoolAddr);
            let tokenAmountIn;
            let spotPriceAfter;
           
            const users = [user1, user2, user3];
            let userIdx = 0;
            let user;

            let shirtsLeft = true;

            while (shirtsLeft) {
                weightBap1 = await crpPool.getDenormalizedWeight(BAP1);
                weightDai = await crpPool.getDenormalizedWeight(DAI);
                block = await web3.eth.getBlock("latest");
                console.log('\nBlock: ' + block.number + '. Weights -> BAP1: ' +
                    (weightBap1*2.5/10**18).toString() + '%\tDAI: ' +
                    (weightDai*2.5/10**18).toString() + '%');

                const tokenInBalance = await dai.balanceOf.call(underlyingPool.address);
                const tokenInWeight = await underlyingPool.getDenormalizedWeight(DAI);
                const tokenOutBalance = await bap1.balanceOf.call(underlyingPool.address);
                const tokenOutWeight = await underlyingPool.getDenormalizedWeight(BAP1);

                // Rotate users
                user = users[userIdx];
                
                const daiBalance = await dai.balanceOf.call(user);
                const bap1Balance = await bap1.balanceOf.call(user);
                console.log(`User ${userIdx + 1} has ${Math.round(fromWei(daiBalance))} Dai and ${fromWei(bap1Balance)} shirts.`);
                console.log(`Pool has ${fromWei(tokenOutBalance)} caps / ${Math.round(fromWei(tokenInBalance))} Dai left`);

                if (3 == ++userIdx) {
                    userIdx = 0;
                }

                const bap1SpotPrice = await underlyingPool.getSpotPrice(DAI, BAP1);
                console.log(`Spot price of 1 BAP1 = ${Decimal(fromWei(bap1SpotPrice)).toFixed(4)}`);
                let amountOut = '1';

                const expectedTotalIn = calcInGivenOut(
                    fromWei(tokenInBalance),
                    fromWei(tokenInWeight),
                    fromWei(tokenOutBalance),
                    fromWei(tokenOutWeight),
                    amountOut, // we want one BAP0 token out
                    fromWei(minSwapFee),
                );
        
                // user buys a shirt
                // Static call (no transaction yet), so that I can get the return values
                const swapResult = await underlyingPool.swapExactAmountOut.call(
                    DAI, // tokenIn
                    MAX, // maxAmountIn
                    BAP1, // tokenOut
                    toWei(amountOut), // tokenAmountOut
                    MAX, // maxPrice
                    { from: user },
                );

                tokenAmountIn = swapResult[0];
                spotPriceAfter = swapResult[1];

                console.log(`Actual cost: ${Decimal(fromWei(tokenAmountIn)).toFixed(2)}; spot price after is ${Decimal(fromWei(spotPriceAfter)).toFixed(2)}`);

                const relDiff = calcRelativeDiff(expectedTotalIn, fromWei(tokenAmountIn));
                assert.isAtMost(relDiff.toNumber(), errorDelta);

                // Now actually do the transaction, so that it performs the swap
                await underlyingPool.swapExactAmountOut(
                    DAI, // tokenIn
                    MAX, // maxAmountIn
                    BAP1, // tokenOut
                    toWei(amountOut), // tokenAmountOut
                    MAX, // maxPrice
                    { from: user },
                );
                
                await crpPool.pokeWeights();
                
                const finalShirtBalance = await bap1.balanceOf.call(underlyingPool.address);
                // Can never go below 2
                shirtsLeft = fromWei(finalShirtBalance) > 2;
            }
        }).timeout(0);

        it('Controller should recover remaining tokens and proceeds from the second auction', async () => {
            const bPoolAddr = await crpPool.bPool();
            const underlyingPool = await BPool.at(bPoolAddr);

            // Prevent trading
            await crpPool.setPublicSwap(false);

            poolDaiBalance = await dai.balanceOf.call(underlyingPool.address);
            console.log(`Final pool Dai balance: ${Decimal(fromWei(poolDaiBalance)).toFixed(2)}`);
            poolShirtBalance = await bap1.balanceOf.call(underlyingPool.address);
            console.log(`Final pool cap balance: ${Decimal(fromWei(poolShirtBalance)).toFixed(4)}`);

            const initialAdminDaiBalance = await dai.balanceOf.call(admin);
            console.log(`Initial admin Dai balance: ${Decimal(fromWei(initialAdminDaiBalance)).toFixed(2)}`);

            // Destroy the pool by simply removing both tokens
            await crpPool.removeToken(DAI);
            await crpPool.removeToken(BAP1);

            const numTokens = await underlyingPool.getNumTokens.call();
            assert.equal(numTokens, 0);

            const adminDaiBalance = await dai.balanceOf.call(admin);
            console.log(`Final admin Dai balance: ${Decimal(fromWei(adminDaiBalance)).toFixed(2)}`);
            const adminBap1Balance = await bap1.balanceOf.call(admin);
            console.log(`Final admin BAP1 balance: ${Decimal(fromWei(adminBap1Balance)).toFixed(2)}`);
 
            // Make sure they recovered all collateral and tokens
            // Tolerate being 2 cents off (rounding, etc.)
            assert.isAtMost(adminDaiBalance - poolDaiBalance - initialAdminDaiBalance, 0.02);
            assert.equal(poolShirtBalance - adminBap1Balance, 0);
        });
    });
});
