/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');
const { time } = require('@openzeppelin/test-helpers');
const { calcRelativeDiff } = require('../lib/calc_comparisons');
const Decimal = require('decimal.js');

// Helper function to calculate new weights.
function newWeight(block, startBlock, endBlock, startWeight, endWeight) {
    let minBetweenEndBlockAndThisBlock; // This allows for pokes after endBlock that get weights to endWeights
    if (block.number > endBlock) {
        minBetweenEndBlockAndThisBlock = endBlock;
    } else {
        minBetweenEndBlockAndThisBlock = block.number;
    }

    const blockPeriod = endBlock - startBlock;

    if (startWeight >= endWeight) {
        const weightDelta = startWeight - endWeight;
        return startWeight - ((minBetweenEndBlockAndThisBlock - startBlock) * (weightDelta / blockPeriod));
    }
    const weightDelta = endWeight - startWeight;
    return startWeight + ((minBetweenEndBlockAndThisBlock - startBlock) * (weightDelta / blockPeriod));
}

contract('configurableWeights', async (accounts) => {
    const admin = accounts[0];
    const { toWei } = web3.utils;
    const { fromWei } = web3.utils;
    const errorDelta = 10 ** -8;
    const MAX = web3.utils.toTwosComplement(-1);

    let crpFactory;
    let bFactory;
    let crpPool;
    let CRPPOOL;
    let WETH;
    let DAI;
    let XYZ;
    let ABC;
    let weth;
    let dai;
    let xyz;
    let abc;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    let startingXyzWeight = '12';
    let startingWethWeight = '1.5';
    let startingDaiWeight = '1.5';
    const startWeights = [toWei(startingXyzWeight), toWei(startingWethWeight), toWei(startingDaiWeight)];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
    const minimumWeightChangeBlockPeriod = 10;
    const SYMBOL = 'BSP';
    const NAME = 'Balancer Pool Token';

    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: true,
        canAddRemoveTokens: false,
        canWhitelistLPs: false,
        canChangeCap: false,
    };

    let validEndBlock;
    let validStartBlock;
    const updatedWethWeight = '3';
    let endXyzWeight = '3';
    let endWethWeight = '6';
    let endDaiWeight = '6';

    describe('Weights permissions, etc', () => {
        before(async () => {
            bFactory = await BFactory.deployed();
            crpFactory = await CRPFactory.deployed();
            xyz = await TToken.new('XYZ', 'XYZ', 18);
            weth = await TToken.new('Wrapped Ether', 'WETH', 18);
            dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
            abc = await TToken.new('ABC', 'ABC', 18);

            WETH = weth.address;
            DAI = dai.address;
            XYZ = xyz.address;
            ABC = abc.address;

            // admin balances
            await weth.mint(admin, toWei('100'));
            await dai.mint(admin, toWei('15000'));
            await xyz.mint(admin, toWei('100000'));
            await abc.mint(admin, toWei('100000'));

            const tokenAddresses = [XYZ, WETH, DAI];

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

            await weth.approve(CRPPOOL_ADDRESS, MAX);
            await dai.approve(CRPPOOL_ADDRESS, MAX);
            await xyz.approve(CRPPOOL_ADDRESS, MAX);

            await crpPool.createPool(toWei('100'), 
                                     minimumWeightChangeBlockPeriod,
                                     minimumWeightChangeBlockPeriod);
        });

        it('crpPool should have correct rights set', async () => {
            const reweightRight = await crpPool.hasPermission(2);
            assert.isTrue(reweightRight);

            let x;
            for (x = 0; x < permissions.length; x++) {
                if (x !== 2) {
                    const otherPerm = await crpPool.hasPermission(x);
                    assert.isFalse(otherPerm);
                }
            }
        });

        it('Non Controller account should not be able to change weights', async () => {
            await truffleAssert.reverts(
                crpPool.updateWeight(WETH, toWei('3'), { from: accounts[1] }),
                'ERR_NOT_CONTROLLER',
            );
        });

        it('Should not change weights below min', async () => {
            await truffleAssert.reverts(
                crpPool.updateWeight(WETH, toWei('0.1')),
                'ERR_MIN_WEIGHT',
            );
        });

        it('Should not change weights above max', async () => {
            await truffleAssert.reverts(
                crpPool.updateWeight(WETH, toWei('50.1')),
                'ERR_MAX_WEIGHT',
            );
        });

        it('Should not change weights if brings total weight above max', async () => {
            await truffleAssert.reverts(
                crpPool.updateWeight(WETH, toWei('37.5')),
                'ERR_MAX_TOTAL_WEIGHT',
            );
        });

        it('Controller should be able to change weights with updateWeight()', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);

            let adminBPTBalance = await crpPool.balanceOf.call(admin);
            let adminWethBalance = await weth.balanceOf.call(admin);
            let bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
            let bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
            let bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

            assert.equal(adminBPTBalance, toWei('100'));
            assert.equal(adminWethBalance, toWei('60'));
            assert.equal(bPoolXYZBalance, toWei('80000'));
            assert.equal(bPoolWethBalance, toWei('40'));
            assert.equal(bPoolDaiBalance, toWei('10000'));

            let xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            let wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            let daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            const xyzStartSpotPrice = await bPool.getSpotPrice.call(weth.address, xyz.address);
            const daiStartSpotPrice = await bPool.getSpotPrice.call(weth.address, dai.address);
            const xdStartSpotPrice = await bPool.getSpotPrice.call(xyz.address, dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            await crpPool.updateWeight(WETH, toWei(updatedWethWeight)); // This should double WETH weight from 1.5 to 3.

            adminBPTBalance = await crpPool.balanceOf.call(admin);
            adminWethBalance = await weth.balanceOf.call(admin);
            bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
            bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
            bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

            // BPT Balance should go from 100 to 110 since total weight went from 15 to 16.5
            // WETH Balance should go from 60 to 20 (since 40 WETH are deposited to pool to get if from 40 to 80 WETH)
            assert.equal(adminBPTBalance, toWei('110'));
            assert.equal(adminWethBalance, toWei('20'));
            assert.equal(bPoolXYZBalance, toWei('80000'));
            assert.equal(bPoolWethBalance, toWei('80'));
            assert.equal(bPoolDaiBalance, toWei('10000'));

            xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(updatedWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            const xyzUpdatedSpotPrice = await bPool.getSpotPrice.call(weth.address, xyz.address);
            const daiUpdatedSpotPrice = await bPool.getSpotPrice.call(weth.address, dai.address);
            const xdUpdatedSpotPrice = await bPool.getSpotPrice.call(xyz.address, dai.address);

            assert.equal(fromWei(xyzStartSpotPrice), fromWei(xyzUpdatedSpotPrice));
            assert.equal(fromWei(daiStartSpotPrice), fromWei(daiUpdatedSpotPrice));
            assert.equal(fromWei(xdStartSpotPrice), fromWei(xdUpdatedSpotPrice));
        });

        it('Controller should not be able to change weights when they do not have enough tokens', async () => {
            // This should triple WETH weight from 1.5 to 4.5, requiring 80 WETH, but admin only has 60.
            await truffleAssert.reverts(
                crpPool.updateWeight(WETH, toWei('4.5')),
                'ERR_INSUFFICIENT_BAL',
            );
        });

        it('Should not be able to update weight for non-token', async () => {
            // This should triple WETH weight from 1.5 to 4.5, requiring 80 WETH, but admin only has 60.
            await truffleAssert.reverts(
                crpPool.updateWeight(ABC, toWei('4.5')),
                'ERR_NOT_BOUND',
            );
        });
    });

    describe('updateWeight', () => {
        beforeEach(async () => {
            bFactory = await BFactory.deployed();
            crpFactory = await CRPFactory.deployed();
            xyz = await TToken.new('XYZ', 'XYZ', 18);
            weth = await TToken.new('Wrapped Ether', 'WETH', 18);
            dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
            abc = await TToken.new('ABC', 'ABC', 18);

            WETH = weth.address;
            DAI = dai.address;
            XYZ = xyz.address;
            ABC = abc.address;

            // admin balances
            await weth.mint(admin, toWei('100'));
            await dai.mint(admin, toWei('15000'));
            await xyz.mint(admin, toWei('100000'));
            await abc.mint(admin, toWei('100000'));

            const tokenAddresses = [XYZ, WETH, DAI];

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

            await weth.approve(CRPPOOL_ADDRESS, MAX);
            await dai.approve(CRPPOOL_ADDRESS, MAX);
            await xyz.approve(CRPPOOL_ADDRESS, MAX);

            await crpPool.createPool(toWei('100'), 
                                     minimumWeightChangeBlockPeriod,
                                     minimumWeightChangeBlockPeriod);
        });

        it('Controller should be able to change weights (down) with updateWeight()', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);

            let adminBPTBalance = await crpPool.balanceOf.call(admin);
            let adminXyzBalance = await xyz.balanceOf.call(admin);
            let bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
            let bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
            let bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

            assert.equal(adminBPTBalance, toWei('100'));
            assert.equal(adminXyzBalance, toWei('20000'));
            assert.equal(bPoolXYZBalance, toWei('80000'));
            assert.equal(bPoolWethBalance, toWei('40'));
            assert.equal(bPoolDaiBalance, toWei('10000'));

            let xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            let wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            let daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            const xyzStartSpotPrice = await bPool.getSpotPrice.call(weth.address, xyz.address);
            const daiStartSpotPrice = await bPool.getSpotPrice.call(weth.address, dai.address);
            const xdStartSpotPrice = await bPool.getSpotPrice.call(xyz.address, dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            const updatedXyzWeight = '6';

            // This should double XYZ weight from 12 to 6.
            await crpPool.updateWeight(XYZ, toWei(updatedXyzWeight));

            adminBPTBalance = await crpPool.balanceOf.call(admin);
            adminXyzBalance = await xyz.balanceOf.call(admin);
            bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
            bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
            bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

            // BPT Balance should go from 100 to 60 since total weight went from 15 to 9
            // XYZ Balance should go from 20000 to 60000 (40000 (half of original balance) returned from pool)
            assert.equal(adminBPTBalance, toWei('60'));
            assert.equal(adminXyzBalance, toWei('60000'));
            assert.equal(bPoolXYZBalance, toWei('40000'));
            assert.equal(bPoolWethBalance, toWei('40'));
            assert.equal(bPoolDaiBalance, toWei('10000'));

            xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(xyzWeight, toWei(updatedXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            const xyzUpdatedSpotPrice = await bPool.getSpotPrice.call(weth.address, xyz.address);
            const daiUpdatedSpotPrice = await bPool.getSpotPrice.call(weth.address, dai.address);
            const xdUpdatedSpotPrice = await bPool.getSpotPrice.call(xyz.address, dai.address);

            assert.equal(fromWei(xyzStartSpotPrice), fromWei(xyzUpdatedSpotPrice));
            assert.equal(fromWei(daiStartSpotPrice), fromWei(daiUpdatedSpotPrice));
            assert.equal(fromWei(xdStartSpotPrice), fromWei(xdUpdatedSpotPrice));
        });

        it('Controller should be able to change weights with updateWeight()', async () => {
            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);

            let adminBPTBalance = await crpPool.balanceOf.call(admin);
            let adminWethBalance = await weth.balanceOf.call(admin);
            let bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
            let bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
            let bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

            assert.equal(adminBPTBalance, toWei('100'));
            assert.equal(adminWethBalance, toWei('60'));
            assert.equal(bPoolXYZBalance, toWei('80000'));
            assert.equal(bPoolWethBalance, toWei('40'));
            assert.equal(bPoolDaiBalance, toWei('10000'));

            let xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            let wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            let daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            const xyzStartSpotPrice = await bPool.getSpotPrice.call(weth.address, xyz.address);
            const daiStartSpotPrice = await bPool.getSpotPrice.call(weth.address, dai.address);
            const xdStartSpotPrice = await bPool.getSpotPrice.call(xyz.address, dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            // This should double WETH weight from 1.5 to 3.
            await crpPool.updateWeight(WETH, toWei(updatedWethWeight));

            adminBPTBalance = await crpPool.balanceOf.call(admin);
            adminWethBalance = await weth.balanceOf.call(admin);
            bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
            bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
            bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

            // BPT Balance should go from 100 to 110 since total weight went from 15 to 16.5
            // WETH Balance should go from 60 to 20 (since 40 WETH are deposited to pool to get if from 40 to 80 WETH)
            assert.equal(adminBPTBalance, toWei('110'));
            assert.equal(adminWethBalance, toWei('20'));
            assert.equal(bPoolXYZBalance, toWei('80000'));
            assert.equal(bPoolWethBalance, toWei('80'));
            assert.equal(bPoolDaiBalance, toWei('10000'));

            xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
            wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
            daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(updatedWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            const xyzUpdatedSpotPrice = await bPool.getSpotPrice.call(weth.address, xyz.address);
            const daiUpdatedSpotPrice = await bPool.getSpotPrice.call(weth.address, dai.address);
            const xdUpdatedSpotPrice = await bPool.getSpotPrice.call(xyz.address, dai.address);

            assert.equal(fromWei(xyzStartSpotPrice), fromWei(xyzUpdatedSpotPrice));
            assert.equal(fromWei(daiStartSpotPrice), fromWei(daiUpdatedSpotPrice));
            assert.equal(fromWei(xdStartSpotPrice), fromWei(xdUpdatedSpotPrice));
        });
    });

    describe('updateWeightsGradually', () => {
        it('Non Controller account should not be able to change weights gradually', async () => {
            const blockRange = 10;
            const block = await web3.eth.getBlock('latest');

            const startBlock = block.number + 6;
            const endBlock = startBlock + blockRange;
            const endWeights = [toWei('3'), toWei('6'), toWei('6')];

            await truffleAssert.reverts(
                crpPool.updateWeightsGradually(endWeights, startBlock, endBlock, { from: accounts[1] }),
                'ERR_NOT_CONTROLLER',
            );
        });

        it('updateWeightsGradually() with block period < minimumWeightChangeBlockPeriod', async () => {
            const blockRange = minimumWeightChangeBlockPeriod - 1;
            const block = await web3.eth.getBlock('latest');
            const startBlock = block.number;
            const endBlock = startBlock + blockRange;

            await truffleAssert.reverts(
                crpPool.updateWeightsGradually([toWei('3'), toWei('6'), toWei('6')], startBlock, endBlock),
                'ERR_WEIGHT_CHANGE_TIME_BELOW_MIN',
            );
        });

        it('Should not be able to call updateWeightsGradually() with invalid weights', async () => {
            const blockRange = minimumWeightChangeBlockPeriod;
            const block = await web3.eth.getBlock('latest');
            const startBlock = block.number;
            const endBlock = startBlock + blockRange;

            await truffleAssert.reverts(
                crpPool.updateWeightsGradually([toWei('51'), toWei('6'), toWei('6')], startBlock, endBlock),
                'ERR_WEIGHT_ABOVE_MAX',
            );

            await truffleAssert.reverts(
                crpPool.updateWeightsGradually([toWei('0.999'), toWei('6'), toWei('6')], startBlock, endBlock),
                'ERR_WEIGHT_BELOW_MIN',
            );

            await truffleAssert.reverts(
                crpPool.updateWeightsGradually([toWei('20'), toWei('20'), toWei('11')], startBlock, endBlock),
                'ERR_MAX_TOTAL_WEIGHT',
            );
        });

        it('Controller should be able to call updateWeightsGradually() with valid range', async () => {
            const block = await web3.eth.getBlock('latest');
            const startBlock = block.number + 10;
            const endBlock = startBlock + minimumWeightChangeBlockPeriod;
            validEndBlock = endBlock;
            validStartBlock = startBlock;
            console.log(`Gradual Update: ${startingXyzWeight}->${endXyzWeight}, ${startingWethWeight}->${endWethWeight}, ${startingDaiWeight}->${endDaiWeight}`);
            console.log(`Latest Block: ${block.number}, Start Update: ${startBlock} End Update: ${endBlock}`);
            const endWeights = [toWei(endXyzWeight), toWei(endWethWeight), toWei(endDaiWeight)];
            await crpPool.updateWeightsGradually(endWeights, startBlock, endBlock);
        });

        it('Should not be able to pokeWeights until valid start block reached', async () => {
            let block = await web3.eth.getBlock('latest');
            assert(block.number < validStartBlock, 'Block Should Be Less Than Valid Block At Start Of Test');

            while (block.number < (validStartBlock - 1)) {
                await truffleAssert.reverts(
                    crpPool.pokeWeights(),
                    'ERR_CANT_POKE_YET',
                );

                block = await web3.eth.getBlock('latest');
                console.log(`${block.number} Can't Poke Yet Valid start block ${validStartBlock}`);
            }
        });

        it('Should run full update cycle, no missed blocks. (anyone can pokeWeights())', async () => {
            // Adjust weights from 12, 3, 1.5 to 3, 6, 6
            let xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
            let wethWeight = await crpPool.getDenormalizedWeight(WETH);
            let daiWeight = await crpPool.getDenormalizedWeight(DAI);
            let block = await web3.eth.getBlock('latest');
            console.log(`${block.number} weights: ${fromWei(xyzWeight)} ${fromWei(wethWeight)} ${fromWei(daiWeight)}`);

            // Starting weights
            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(updatedWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            while (block.number < validEndBlock) {
                await crpPool.pokeWeights({ from: accounts[1] });

                xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
                wethWeight = await crpPool.getDenormalizedWeight(WETH);
                daiWeight = await crpPool.getDenormalizedWeight(DAI);

                block = await web3.eth.getBlock('latest');
                const newXyzW = newWeight(
                    block,
                    validStartBlock,
                    validEndBlock,
                    Number(startingXyzWeight),
                    Number(endXyzWeight),
                );
                const newWethW = newWeight(block, validStartBlock, validEndBlock, Number(updatedWethWeight), Number(endWethWeight));
                const newDaiW = newWeight(block, validStartBlock, validEndBlock, Number(startingDaiWeight), Number(endDaiWeight));
                console.log(`${block.number} Weights: ${newXyzW}/${fromWei(xyzWeight)}, ${newWethW}/${fromWei(wethWeight)}, ${newDaiW}/${fromWei(daiWeight)}`);

                let relDif = calcRelativeDiff(newXyzW, fromWei(xyzWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
                relDif = calcRelativeDiff(newWethW, fromWei(wethWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
                relDif = calcRelativeDiff(newDaiW, fromWei(daiWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
            }

            assert.equal(xyzWeight, toWei(endXyzWeight));
            assert.equal(wethWeight, toWei(endWethWeight));
            assert.equal(daiWeight, toWei(endDaiWeight));
        });

        it('poking weights after end date should have no effect', async () => {
            for (let i = 0; i < 10; i++) {
                await crpPool.pokeWeights();
                const xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
                const wethWeight = await crpPool.getDenormalizedWeight(WETH);
                const daiWeight = await crpPool.getDenormalizedWeight(DAI);
                assert.equal(xyzWeight, toWei(endXyzWeight));
                assert.equal(wethWeight, toWei(endWethWeight));
                assert.equal(daiWeight, toWei(endDaiWeight));
            }
        });

        it('Confirm update weights can be run again', async () => {
            // Adjust weights from 3, 6, 6 to 7, 6.1, 17
            let block = await web3.eth.getBlock('latest');
            const startBlock = block.number + 10;
            const endBlock = startBlock + minimumWeightChangeBlockPeriod;

            startingXyzWeight = '3';
            startingWethWeight = '6';
            startingDaiWeight = '6';
            endXyzWeight = '7';
            endWethWeight = '6.1';
            endDaiWeight = '17';

            console.log(`Gradual Update: ${startingXyzWeight}->${endXyzWeight}, ${startingWethWeight}->${endWethWeight}, ${startingDaiWeight}->${endDaiWeight}`);
            console.log(`Latest Block: ${block.number}, Start Update: ${startBlock} End Update: ${endBlock}`);

            const endWeights = [toWei(endXyzWeight), toWei(endWethWeight), toWei(endDaiWeight)];
            await crpPool.updateWeightsGradually(endWeights, startBlock, endBlock);

            let xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
            let wethWeight = await crpPool.getDenormalizedWeight(WETH);
            let daiWeight = await crpPool.getDenormalizedWeight(DAI);
            block = await web3.eth.getBlock('latest');
            console.log(`${block.number} Weights: ${fromWei(xyzWeight)}
              ${fromWei(wethWeight)} ${fromWei(daiWeight)}`);

            // Starting weights
            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            while (block.number < endBlock) {
                try {
                    await crpPool.pokeWeights({ from: accounts[3] });
                } catch (err) {
                    block = await web3.eth.getBlock('latest');
                    console.log(`${block.number} Can't Poke Yet Valid start block ${startBlock}`);
                    continue;
                }

                xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
                wethWeight = await crpPool.getDenormalizedWeight(WETH);
                daiWeight = await crpPool.getDenormalizedWeight(DAI);

                block = await web3.eth.getBlock('latest');

                const newXyzW = newWeight(block, startBlock, endBlock, Number(startingXyzWeight), Number(endXyzWeight));
                const newWethW = newWeight(block, startBlock, endBlock, Number(startingWethWeight), Number(endWethWeight));
                const newDaiW = newWeight(block, startBlock, endBlock, Number(startingDaiWeight), Number(endDaiWeight));
                console.log(`${block.number} Weights: ${newXyzW}/${fromWei(xyzWeight)}, ${newWethW}/${fromWei(wethWeight)}, ${newDaiW}/${fromWei(daiWeight)}`);

                let relDif = calcRelativeDiff(newXyzW, fromWei(xyzWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
                relDif = calcRelativeDiff(newWethW, fromWei(wethWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
                relDif = calcRelativeDiff(newDaiW, fromWei(daiWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
            }

            assert.equal(xyzWeight, toWei(endXyzWeight));
            assert.equal(wethWeight, toWei(endWethWeight));
            assert.equal(daiWeight, toWei(endDaiWeight));
        });

        it('Confirm update weights can be run with expired start block', async () => {
            // When the start block has already expired then poking has to catch up
            // Adjust weights from 7, 6.1, 17 to 1, 1, 1
            let block = await web3.eth.getBlock('latest');
            const startBlock = block.number - 2;
            // When updateWeightsGradually is called with start block < current block it sets start block to current
            const realStartingBlock = block.number + 1;
            const endBlock = startBlock + 2 * minimumWeightChangeBlockPeriod;

            startingXyzWeight = '7';
            startingWethWeight = '6.1';
            startingDaiWeight = '17';
            endXyzWeight = '1';
            endWethWeight = '1';
            endDaiWeight = '1';

            console.log(`Gradual Update: ${startingXyzWeight}->${endXyzWeight}, ${startingWethWeight}->${endWethWeight}, ${startingDaiWeight}->${endDaiWeight}`);
            console.log(`Latest Block: ${block.number}, Start Update: ${startBlock} End Update: ${endBlock}`);
            const endWeights = [toWei(endXyzWeight), toWei(endWethWeight), toWei(endDaiWeight)];
            await crpPool.updateWeightsGradually(endWeights, startBlock, endBlock);

            // Move blocks on passed starting block
            let advanceBlocks = 7;
            while (--advanceBlocks) await time.advanceBlock();

            let xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
            let wethWeight = await crpPool.getDenormalizedWeight(WETH);
            let daiWeight = await crpPool.getDenormalizedWeight(DAI);
            block = await web3.eth.getBlock('latest');
            console.log('Poking...');
            console.log(`${block.number} Weights: ${Decimal(fromWei(xyzWeight)).toFixed(4)} ${Decimal(fromWei(wethWeight)).toFixed(4)} ${Decimal(fromWei(daiWeight)).toFixed(4)}`);

            // Starting weights
            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));

            while (block.number < endBlock) {
                try {
                    await crpPool.pokeWeights({ from: accounts[3] });
                } catch (err) {
                    block = await web3.eth.getBlock('latest');
                    console.log(`${block.number} Can't Poke Yet Valid start block ${startBlock}`);
                    continue;
                }

                xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
                wethWeight = await crpPool.getDenormalizedWeight(WETH);
                daiWeight = await crpPool.getDenormalizedWeight(DAI);

                block = await web3.eth.getBlock('latest');
                const newXyzW = newWeight(block, realStartingBlock, endBlock, Number(startingXyzWeight), Number(endXyzWeight));
                const newWethW = newWeight(block, realStartingBlock, endBlock, Number(startingWethWeight), Number(endWethWeight));
                const newDaiW = newWeight(block, realStartingBlock, endBlock, Number(startingDaiWeight), Number(endDaiWeight));
                console.log(`${block.number} Weights: ${newXyzW}/${fromWei(xyzWeight)}, ${newWethW}/${fromWei(wethWeight)}, ${newDaiW}/${fromWei(daiWeight)}`);

                let relDif = calcRelativeDiff(newXyzW, fromWei(xyzWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
                relDif = calcRelativeDiff(newWethW, fromWei(wethWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
                relDif = calcRelativeDiff(newDaiW, fromWei(daiWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
            }

            assert.equal(xyzWeight, toWei(endXyzWeight));
            assert.equal(wethWeight, toWei(endWethWeight));
            assert.equal(daiWeight, toWei(endDaiWeight));
        });

        it('Confirm poke called after end block', async () => {
            // When the start block has already expired then poking has to catch up
            // Adjust weights from 1, 1, 1 to 3.3, 12.7, 9.5
            let block = await web3.eth.getBlock('latest');
            const startBlock = block.number;
            const endBlock = startBlock + minimumWeightChangeBlockPeriod + 1;

            startingXyzWeight = '1';
            startingWethWeight = '1';
            startingDaiWeight = '1';
            endXyzWeight = '3.3';
            endWethWeight = '12.7';
            endDaiWeight = '9.5';

            console.log(`Gradual Update: ${startingXyzWeight}->${endXyzWeight}, ${startingWethWeight}->${endWethWeight}, ${startingDaiWeight}->${endDaiWeight}`);
            console.log(`Latest Block: ${block.number}, Start Update: ${startBlock} End Update: ${endBlock}`);
            const endWeights = [toWei(endXyzWeight), toWei(endWethWeight), toWei(endDaiWeight)];
            await crpPool.updateWeightsGradually(endWeights, startBlock, endBlock);

            // Move blocks on passed starting block
            let advanceBlocks = (minimumWeightChangeBlockPeriod * 2);
            console.log('Skipping past end block...');
            while (--advanceBlocks) await time.advanceBlock();

            let xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
            let wethWeight = await crpPool.getDenormalizedWeight(WETH);
            let daiWeight = await crpPool.getDenormalizedWeight(DAI);

            block = await web3.eth.getBlock('latest');
            console.log('Poking...');
            console.log(`${block.number} Weights: ${fromWei(xyzWeight)} ${fromWei(wethWeight)} ${fromWei(daiWeight)}`);

            // Starting weights
            assert.equal(xyzWeight, toWei(startingXyzWeight));
            assert.equal(wethWeight, toWei(startingWethWeight));
            assert.equal(daiWeight, toWei(startingDaiWeight));
            advanceBlocks = 10;
            while (--advanceBlocks) {
                try {
                    await crpPool.pokeWeights({ from: accounts[3] });
                } catch (err) {
                    block = await web3.eth.getBlock('latest');
                    console.log(`${block.number} Can't Poke Yet Valid start block ${startBlock}`);
                    continue;
                }

                xyzWeight = await crpPool.getDenormalizedWeight(XYZ);
                wethWeight = await crpPool.getDenormalizedWeight(WETH);
                daiWeight = await crpPool.getDenormalizedWeight(DAI);

                block = await web3.eth.getBlock('latest');
                const newXyzW = newWeight(block, startBlock, endBlock, Number(startingXyzWeight), Number(endXyzWeight));
                const newWethW = newWeight(block, startBlock, endBlock, Number(startingWethWeight), Number(endWethWeight));
                const newDaiW = newWeight(block, startBlock, endBlock, Number(startingDaiWeight), Number(endDaiWeight));
                console.log(`${block.number} Weights: ${newXyzW}/${fromWei(xyzWeight)}, ${newWethW}/${fromWei(wethWeight)}, ${newDaiW}/${fromWei(daiWeight)}`);

                let relDif = calcRelativeDiff(newXyzW, fromWei(xyzWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
                relDif = calcRelativeDiff(newWethW, fromWei(wethWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
                relDif = calcRelativeDiff(newDaiW, fromWei(daiWeight));
                assert.isAtMost(relDif.toNumber(), errorDelta);
            }

            assert.equal(xyzWeight, toWei(endXyzWeight));
            assert.equal(wethWeight, toWei(endWethWeight));
            assert.equal(daiWeight, toWei(endDaiWeight));
        });

        it('Set swap fee should revert because non-permissioned', async () => {
            await truffleAssert.reverts(
                crpPool.setSwapFee(toWei('0.01')),
                'ERR_NOT_CONFIGURABLE_SWAP_FEE',
            );
        });

        it('Set public swap should revert because non-permissioned', async () => {
            await truffleAssert.reverts(
                crpPool.setPublicSwap(false),
                'ERR_NOT_PAUSABLE_SWAP',
            );
        });

        it('Remove token should revert because non-permissioned', async () => {
            await truffleAssert.reverts(
                crpPool.removeToken(DAI),
                'ERR_CANNOT_ADD_REMOVE_TOKENS',
            );
        });

        it('Commit add token should revert because non-permissioned', async () => {
            await truffleAssert.reverts(
                crpPool.commitAddToken(DAI, toWei('150000'), toWei('1.5')),
                'ERR_CANNOT_ADD_REMOVE_TOKENS',
            );
        });

        it('Apply add token should revert because non-permissioned', async () => {
            await truffleAssert.reverts(
                crpPool.applyAddToken(),
                'ERR_CANNOT_ADD_REMOVE_TOKENS',
            );
        });
    });
});
