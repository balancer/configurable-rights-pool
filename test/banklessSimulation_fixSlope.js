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

contract('Bankless Simulation (mid-stream adjustment)', async (accounts) => {
    const admin = accounts[0];
    const user = accounts[1];
 
    const { toWei, fromWei } = web3.utils;
    const MAX = web3.utils.toTwosComplement(-1);
    const errorDelta = 10 ** -8;
    const numPoolTokens = '1000';

    let crpFactory; 
    let bFactory;
    let crpPool;
    let CRPPOOL;
    let DAI;
    let dai;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    const minSwapFee = toWei('0.000001');
    const initialDaiDeposit = '3000';

    // 2/38 is 5%/95%  Dai/Bap0
    const startWeights = [toWei('2'), toWei('38')];
    // 38 weight and 38 tokens is a coincidence
    const startBalances = [toWei(initialDaiDeposit), toWei('38')];
    const SYMBOL = 'BAP';
    const NAME = 'Balancer Pool Token';

    const permissions = {
        canPauseSwapping: true,
        canChangeSwapFee: true,
        canChangeWeights: true,
        canAddRemoveTokens: false,
        canWhitelistLPs: false,
        canChangeCap: true,
    };

    before(async () => {
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        bap0 = await TToken.new('BAP Gen 0', 'BAP0', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        BAP0 = bap0.address;
        DAI = dai.address;

        // admin balances
        await bap0.mint(admin, toWei('38'));
        await dai.mint(admin, toWei('3000'));

        await dai.mint(user, toWei('200000'));

        // Initially 5% DAI / 95% BAP0
        const tokenAddresses = [DAI, BAP0];

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
        await dai.approve(CRPPOOL_ADDRESS, MAX);

        await crpPool.approve(user, MAX);

        await crpPool.createPool(toWei(numPoolTokens), 10, 10);
    });

    it('crpPool should have correct rights set', async () => {
        let x;
        for (x = 0; x < permissions.length; x++) {
            const perm = await crpPool.hasPermission(x);
            if (x == 3 || x == 4 || x == 6) {
                assert.isFalse(perm);
            }
            else {
                assert.isTrue(perm)
            }
        }
    });

    describe('BAP0 shirt auction with mid-stream adjustment', () => {
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

        it('Should revert because too early to pokeWeights()', async () => {
            const block = await web3.eth.getBlock('latest');
            console.log(`Block: ${block.number}`);
            await truffleAssert.reverts(
                crpPool.pokeWeights(),
                'ERR_CANT_POKE_YET',
            );
        });

        it('Should be able to poke weights (and buy shirts)', async () => {
            let i;
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
 
            await dai.approve(underlyingPool.address, MAX, { from: user });
           
            for (i = 0; i < 5; i++) {
                weightBap0 = await crpPool.getDenormalizedWeight(BAP0);
                weightDai = await crpPool.getDenormalizedWeight(DAI);
                block = await web3.eth.getBlock("latest");
                console.log('\nBlock: ' + block.number + '. Weights -> BAP0: ' +
                    (weightBap0*2.5/10**18).toFixed(4) + '%\tDAI: ' +
                    (weightDai*2.5/10**18).toFixed(2) + '%');
                console.log(`Raw weights: ${Decimal(fromWei(weightBap0)).toFixed(4)} / ${Decimal(fromWei(weightDai)).toFixed(2)}`);

                const tokenInBalance = await dai.balanceOf.call(underlyingPool.address);
                const tokenInWeight = await underlyingPool.getDenormalizedWeight(DAI);
                const tokenOutBalance = await bap0.balanceOf.call(underlyingPool.address);
                const tokenOutWeight = await underlyingPool.getDenormalizedWeight(BAP0);
                
                const daiBalance = await dai.balanceOf.call(user);
                const bap0Balance = await bap0.balanceOf.call(user);
                console.log(`User has ${Decimal(fromWei(daiBalance)).toFixed(2)} Dai and ${Decimal(fromWei(bap0Balance)).toFixed(1)} shirts.`);
                console.log(`Pool has ${Decimal(fromWei(tokenOutBalance)).toFixed(1)} shirts / ${Decimal(fromWei(tokenInBalance)).toFixed(2)} Dai left`);

                // Buy 1-3 shirts at a time - get "ahead" of the curve
                let amountOut = (Math.floor(Math.random() * 3) + 1).toString();

                const expectedTotalIn = calcInGivenOut(
                    fromWei(tokenInBalance),
                    fromWei(tokenInWeight),
                    fromWei(tokenOutBalance),
                    fromWei(tokenOutWeight),
                    amountOut,
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

                console.log(`Cost: ${Decimal(fromWei(tokenAmountIn)).toFixed(2)}`);

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
            
                await crpPool.pokeWeights();
            }
        });

        it('Should allow fast weight adjustment mid-stream', async () => {
            weightBap0 = await crpPool.getDenormalizedWeight(BAP0);
            weightDai = await crpPool.getDenormalizedWeight(DAI);

            newBap0Weight = Decimal(fromWei(weightBap0)).minus(10);
            newDaiWeight = Decimal(fromWei(weightDai)).plus(10);

            const startBlock = await web3.eth.getBlock('latest');
            console.log(`Block of updateWeightsGradually() call: ${startBlock.number}`);
            const endBlock = startBlock.number + 10; // 10 is the minimum
            const adjustmentEndWeights = [toWei(newDaiWeight.toString()), toWei(newBap0Weight.toString())];
            console.log(`Start block for fast adjustment: ${startBlock.number}`);
            console.log(`End   block for fast adjustment: ${endBlock}`);

            await crpPool.updateWeightsGradually(adjustmentEndWeights, startBlock.number, endBlock);

            let block = await web3.eth.getBlock('latest');
            console.log(`Block: ${block.number}`);                        
            while (block.number < startBlock.number) {
                block = await web3.eth.getBlock('latest');
                console.log(`Still waiting. Block: ${block.number}`);
                await time.advanceBlock();
            }

            // Now pokeWeights until they match the target
            let adjusting = true;
            let lastBap0Weight = 0;

            while (adjusting) {
                await crpPool.pokeWeights();

                block = await web3.eth.getBlock('latest');
                console.log(`Poked at block: ${block.number}`);

                weightBap0 = await crpPool.getDenormalizedWeight(BAP0);
                weightDai = await crpPool.getDenormalizedWeight(DAI);
                console.log(`Raw weights: ${Decimal(fromWei(weightBap0)).toFixed(4)} / ${Decimal(fromWei(weightDai)).toFixed(4)}`);

                let weightDiff = Decimal(fromWei(weightBap0)).minus(lastBap0Weight);
                console.log(`Weight diff: ${weightDiff.toFixed(4)}`);

                if (weightDiff == 0) {
                    adjusting = false;
                }
                else {
                    lastBap0Weight = newBap0Weight;
                }

                await time.advanceBlock();
            }
        });

        it('Should allow resumption of schedule', async () => {
            weightBap0 = await crpPool.getDenormalizedWeight(BAP0);
            weightDai = await crpPool.getDenormalizedWeight(DAI);

            const bPoolAddr = await crpPool.bPool();
            const underlyingPool = await BPool.at(bPoolAddr);

            blockRange = 50;
            // get current block number
            const startBlock = await web3.eth.getBlock('latest');
            console.log(`Block of resumption updateWeightsGradually() call: ${startBlock.number}`);
            const endBlock = startBlock.number + blockRange;
            const endWeights = [toWei('39'), toWei('1')];

            console.log(`Start block for schedule resumption: ${startBlock.number}`);
            console.log(`End   block for schedule resumption: ${endBlock}`);

            await crpPool.updateWeightsGradually(endWeights, startBlock.number, endBlock);

            let block = await web3.eth.getBlock('latest');
            console.log(`Block: ${block.number}`);                        
            while (block.number < startBlock.number) {
                block = await web3.eth.getBlock('latest');
                console.log(`Still waiting. Block: ${block.number}`);
                await time.advanceBlock();
            }

            for (i = 0; i < 5; i++) {
                weightBap0 = await crpPool.getDenormalizedWeight(BAP0);
                weightDai = await crpPool.getDenormalizedWeight(DAI);
                block = await web3.eth.getBlock("latest");
                console.log('\nBlock: ' + block.number + '. Weights -> BAP0: ' +
                    (weightBap0*2.5/10**18).toFixed(4) + '%\tDAI: ' +
                    (weightDai*2.5/10**18).toFixed(2) + '%');
                console.log(`Raw weights: ${Decimal(fromWei(weightBap0)).toFixed(4)} / ${Decimal(fromWei(weightDai)).toFixed(4)}`);

                const tokenInBalance = await dai.balanceOf.call(underlyingPool.address);
                const tokenInWeight = await underlyingPool.getDenormalizedWeight(DAI);
                const tokenOutBalance = await bap0.balanceOf.call(underlyingPool.address);
                const tokenOutWeight = await underlyingPool.getDenormalizedWeight(BAP0);
                
                const daiBalance = await dai.balanceOf.call(user);
                const bap0Balance = await bap0.balanceOf.call(user);
                console.log(`User has ${Decimal(fromWei(daiBalance)).toFixed(2)} Dai and ${Decimal(fromWei(bap0Balance)).toFixed(1)} shirts.`);
                console.log(`Pool has ${Decimal(fromWei(tokenOutBalance)).toFixed(1)} shirts / ${Decimal(fromWei(tokenInBalance)).toFixed(2)} Dai left`);

                let amountOut = '1';

                const expectedTotalIn = calcInGivenOut(
                    fromWei(tokenInBalance),
                    fromWei(tokenInWeight),
                    fromWei(tokenOutBalance),
                    fromWei(tokenOutWeight),
                    amountOut,
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

                console.log(`Cost: ${Decimal(fromWei(tokenAmountIn)).toFixed(2)}`);

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
            
                await crpPool.pokeWeights();
            }    
        });
    });
});
