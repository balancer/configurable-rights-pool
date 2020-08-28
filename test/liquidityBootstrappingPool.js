/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const { time } = require('@openzeppelin/test-helpers');
const { assert } = require('chai');
const Decimal = require('decimal.js');

// Refer to this article for background:
// https://medium.com/balancer-protocol/building-liquidity-into-token-distribution-a49d4286e0d4

contract('Liquidity Bootstrapping', async (accounts) => {
    const admin = accounts[0];
    const { toWei, fromWei } = web3.utils;

    const MAX = web3.utils.toTwosComplement(-1);
    const SYMBOL = 'LBP';
    const NAME = 'Balancer Pool Token';

    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: true,
        canAddRemoveTokens: false,
        canWhitelistLPs: false,
        canChangeCap: false,
    };

    describe('Factory_LBP (linear)', () => {
        let bFactory;
        let crpFactory;
        let controller;
        let CONTROLLER;
        let XYZ;
        let DAI;
        let dai;
        let xyz;
        let startBlock;

        /* A Liquidity Bootstrapping Pool normally has two tokens:
           A project token - here called XYZ, with initially no or low value
           And a collateral coin used to purchase it (usually a stable coin; DAI in this case)
           (It could theoretically have multiple collateral coins; see paper)

           We want to start by weighting it heavily toward the project token,
           to minimize the upfront capital required to create liquidity in the
           project token with low slippage. 

           Without this mechanism, a prohibitively large Dai starting balance would be 
           required to achieve acceptably low levels of price slippage. 

           Here we're starting with an 80/20% split. 
           The project token is at 80%: 32/(32 + 8) denormalized weights
           And Dai is 20%: 8/(32 + 8).
           This allows 4,000 project tokens (at $1), to be bootstrapped for $1,000 in DAI

           The total max denormalized weight is 50 - you could do 40/10, for instance
           However, if you're going to be updating weights manually, it's best to stay
           away from the "edges," and use a lower total, like 40. Otherwise it's possible
           the token transfers necessary to change the weights might fail due to ratio
           constraints, or having weights temporarily over the maximum.
        */

        const startWeights = [toWei('32'), toWei('8')];
        const startBalances = [toWei('4000'), toWei('1000')];
        const swapFee = 10**15;
        let blockRange;

        before(async () => {
            bFactory = await BFactory.deployed();
            crpFactory = await CRPFactory.deployed();
            xyz = await TToken.new('XYZ', 'Example Project Token', 18);
            dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
 
            XYZ = xyz.address;
            DAI = dai.address;

            // admin balances
            // These should be higher than the initial amount supplied
            // Changing weights pushes/pulls tokens as necessary to keep the prices stable
            await dai.mint(admin, toWei('10000'));
            await xyz.mint(admin, toWei('40000'));
 
            const poolParams = {
                poolTokenSymbol: SYMBOL,
                poolTokenName: NAME,
                constituentTokens: [XYZ, DAI],
                tokenBalances: startBalances,
                tokenWeights: startWeights,
                swapFee: swapFee,
            }
    
            CONTROLLER = await crpFactory.newCrp.call(
                bFactory.address,
                poolParams,
                permissions,
            );

            await crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            );

            controller = await ConfigurableRightsPool.at(CONTROLLER);

            const CONTROLLER_ADDRESS = controller.address;

            await dai.approve(CONTROLLER_ADDRESS, MAX);
            await xyz.approve(CONTROLLER_ADDRESS, MAX);

            await controller.createPool(toWei('1000'), 10, 10);
        });

        // Change weights linearly over the given block period
        // They "flip" from heavily favoring the project token, to heavily favoring the collateral coin
        describe('Linear LBP example', () => {
            it('Controller should be able to call updateWeightsGradually()', async () => {
                blockRange = 50;
                // get current block number
                const block = await web3.eth.getBlock('latest');
                console.log(`Block of updateWeightsGradually() called at ${block.number}`);
                startBlock = block.number;
                const endBlock = startBlock + blockRange;
                // "Flip" weights, from 80/20% to 20/80% by the end
                const endWeights = [toWei('8'), toWei('32')];
                console.log(`Start block for XYZ bootstrapping: ${startBlock}`);
                console.log(`End   block for XYZ bootstrapping: ${endBlock}`);

                await controller.updateWeightsGradually(endWeights, startBlock, endBlock);
            });

            it('Should be able to pokeWeights()', async () => {
                let i;
                let weightXYZ;
                let weightDAI;

                let block = await web3.eth.getBlock('latest');
                console.log(`Block: ${block.number}`);                        
                while (block.number < startBlock) {
                    // Wait for the start block, if necessary
                    block = await web3.eth.getBlock('latest');
                    console.log(`Still waiting. Block: ${block.number}`);
                    await time.advanceBlock();
                }
               
                for (i = 0; i < blockRange + 3; i++) {
                    weightXYZ = await controller.getDenormalizedWeight(XYZ);
                    weightDAI = await controller.getDenormalizedWeight(DAI);
                    block = await web3.eth.getBlock("latest");
                    console.log('Block: ' + block.number + '. Weights -> XYZ: ' +
                        (fromWei(weightXYZ)*2.5).toFixed(4) + '%\tDAI: ' +
                        (fromWei(weightDAI)*2.5).toFixed(4) + '%');

                    // Cause the weights to change
                    // Since a smart contract can do nothing on its own, an external caller
                    //   needs to poke it with a stick now and then for the weights to change
                    await controller.pokeWeights();
                }
            });
        });      
    });

    /* Here we want to implement a non-linear curve, as describe in the paper - 
       essentially "flipping" the weights faster.

       This could be done by calling updateWeightsGradually repeatedly, with short-term
       endpoints calculated so that the succession of linear trajectories coincides with
       tangents to the desired exponential curve.

       Or, as we do here, you can simply set the weights directly to points on the curve
       during the non-linear phase, then call updateWeightsGradually once after it flattens
       out.
    */
    describe('Factory_LBP (nonlinear)', () => {
        let controller;
        let CONTROLLER;
        let XYZ;
        let DAI;
        let dai;
        let xyz;

        const startWeights = [toWei('32'), toWei('8')];
        const startBalances = [toWei('4000'), toWei('1000')];
        const swapFee = 10**15;

        before(async () => {
            bFactory = await BFactory.deployed();
            crpFactory = await CRPFactory.deployed();
            xyz = await TToken.new('XYZ', 'Example Project Token', 18);
            dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
 
            XYZ = xyz.address;
            DAI = dai.address;

            // admin balances
            // These should be higher than the initial amount supplied
            // Changing weights pushes/pulls tokens as necessary to keep the prices stable
            await dai.mint(admin, toWei('10000'));
            await xyz.mint(admin, toWei('40000'));

            const poolParams = {
                poolTokenSymbol: SYMBOL,
                poolTokenName: NAME,
                constituentTokens: [XYZ, DAI],
                tokenBalances: startBalances,
                tokenWeights: startWeights,
                swapFee: swapFee,
                }

            CONTROLLER = await crpFactory.newCrp.call(
                bFactory.address,
                poolParams,
                permissions,
            );

            await crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            );

            controller = await ConfigurableRightsPool.at(CONTROLLER);

            const CONTROLLER_ADDRESS = controller.address;

            await dai.approve(CONTROLLER_ADDRESS, MAX);
            await xyz.approve(CONTROLLER_ADDRESS, MAX);

            await controller.createPool(toWei('1000'), 10, 10);
        });

        describe('Nonlinear LBP example', () => {
            it('Should be able to update weights directly', async () => {
                let i;

                let weightXYZ = await controller.getDenormalizedWeight(XYZ);
                let weightDAI = await controller.getDenormalizedWeight(DAI);
                const startWeightXYZ = weightXYZ;
                const startWeightDAI = weightDAI;

                let total = Decimal(fromWei(weightXYZ)).plus(Decimal(fromWei(weightDAI)));
                let pctXYZ = Decimal(fromWei(weightXYZ)).div(total);
                let pctDAI = Decimal(fromWei(weightDAI)).div(total);
                assert.equal(pctXYZ.toString(), '0.8');
                assert.equal(pctDAI.toString(), '0.2');
                // Steepness parameter
                const b = 1;

                const bPoolAddr = await controller.bPool();
                const underlyingPool = await BPool.at(bPoolAddr);
    
                /* Exponential curve formula (for 80/20%)
                   "b" parameterizes the "steepness" of the curve
                   Higher values of b mean weights converge to the asymptotes faster
                  
                   pctXYZ = 0.2 + 0.6^(bx)
                   pctDAI = 0.8 - 0.6^(bx)
                 
                   To generalize, HP=0.8, LP=0.2
                   pctXYZ = LP + (HP-LP)^(bx)
                   pctDAI = HP - (HP-LP)^(bx) */

                /* Follow it for 25 blocks/weight changes
                   In a real example, weights might change every 1000 or 10000 blocks
                   For the first 10 blocks, set the weights manually, since they're not linear
                   For the last 15 blocks, the curve is close enough to the asymptote to be nearly linear,
                   So make it easier and use the updateWeightsGradually call */

                for (i = 1; i <= 10; i++) {
                    weightXYZ = await controller.getDenormalizedWeight(XYZ);
                    weightDAI = await controller.getDenormalizedWeight(DAI);
                    block = await web3.eth.getBlock("latest");
                    console.log('Block: ' + block.number + '. Weights -> XYZ: ' +
                        (fromWei(weightXYZ)*2.5).toFixed(4) + '%\tDAI: ' +
                        (fromWei(weightDAI)*2.5).toFixed(4) + '%');
                    await time.advanceBlock();

                    // Calculate the percentages (rounded to 3 decimals to avoid numeric issues)
                    pctXYZ = Math.floor((0.2 + 0.6**(b*i)) * 1000)/1000;
                    pctDAI = Math.floor((0.8 - 0.6**(b*i)) * 1000)/1000;

                    // Convert the percentages to denormalized weights
                    normXYZ = Math.floor(pctXYZ*40*1000)/1000;
                    normDAI = Math.floor(pctDAI*40*1000)/1000;

                    console.log(`\nNew weights: XYZ weight: ${normXYZ}; DAI weight: ${normDAI}`);

                    // Changing weghts transfers tokens!         
                    await controller.updateWeight(XYZ, toWei(normXYZ.toFixed(4)));
                    await controller.updateWeight(DAI, toWei(normDAI.toFixed(4)));

                    const adminXYZ = await xyz.balanceOf.call(admin);
                    const adminDAI = await dai.balanceOf.call(admin);
                    console.log(`Admin balances after: ${Decimal(fromWei(adminXYZ)).toFixed(2)} XYZ; ${Decimal(fromWei(adminDAI)).toFixed(2)} DAI`);
                    const poolXYZ = await xyz.balanceOf.call(underlyingPool.address);
                    const poolDAI = await dai.balanceOf.call(underlyingPool.address);
                    console.log(`Pool balances after: ${Decimal(fromWei(poolXYZ)).toFixed(2)} XYZ; ${Decimal(fromWei(poolDAI)).toFixed(2)} DAI`);
                }

                // End weights are the reverse of the starting weights
                const endWeights = [startWeightDAI, startWeightXYZ]
                // Do linear for the rest of the curve
                await controller.updateWeightsGradually(endWeights, block.number, block.number + 15);

                for (i = 1; i <= 15; i++) {
                    weightXYZ = await controller.getDenormalizedWeight(XYZ);
                    weightDAI = await controller.getDenormalizedWeight(DAI);
                    block = await web3.eth.getBlock("latest");
                    console.log('Block: ' + block.number + '. Weights -> XYZ: ' +
                        (fromWei(weightXYZ)*2.5).toFixed(4) + '%\tDAI: ' +
                        (fromWei(weightDAI)*2.5).toFixed(4) + '%');

                    await controller.pokeWeights();
                }
            });
        });        
    });
});
