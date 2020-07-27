/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');

contract('configurableWeightsUMA', async (accounts) => {
    const admin = accounts[0];
    const { toWei } = web3.utils;

    const MAX = web3.utils.toTwosComplement(-1);
    const SYMBOL = 'BSP';
    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: true,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
    };

    describe('Factory', () => {
        let bfactory;
        let factory;
        let controller;
        let CONTROLLER;
        let WETH;
        let XYZ;
        let DAI;
        let weth;
        let dai;
        let xyz;
        let abc;
        const startWeights = [toWei('1'), toWei('39')];
        const startBalances = [toWei('80000'), toWei('40')];
        let blockRange;

        before(async () => {
            bfactory = await BFactory.deployed();
            factory = await CRPFactory.deployed();
            xyz = await TToken.new('XYZ', 'XYZ', 18);
            weth = await TToken.new('Wrapped Ether', 'WETH', 18);
            dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
            abc = await TToken.new('ABC', 'ABC', 18);

            WETH = weth.address;
            XYZ = xyz.address;
            DAI = dai.address;

            // admin balances
            await weth.mint(admin, toWei('100000000'));
            await dai.mint(admin, toWei('100000000'));
            await xyz.mint(admin, toWei('100000000'));
            await abc.mint(admin, toWei('100000000'));

            // Copied this model of code from https://github.com/balancer-labs/balancer-core/blob/5d70da92b1bebaa515254d00a9e064ecac9bd18e/test/math_with_fees.js#L93
            CONTROLLER = await factory.newCrp.call(
                bfactory.address,
                SYMBOL,
                [XYZ, WETH],
                startBalances,
                startWeights,
                10 ** 15, // swapFee
                permissions,
            );

            await factory.newCrp(
                bfactory.address,
                SYMBOL,
                [XYZ, WETH],
                startBalances,
                startWeights,
                10 ** 15, // swapFee
                permissions,
            );

            controller = await ConfigurableRightsPool.at(CONTROLLER);

            const CONTROLLER_ADDRESS = controller.address;

            // console.log(CONTROLLER_ADDRESS);

            await weth.approve(CONTROLLER_ADDRESS, MAX);
            await dai.approve(CONTROLLER_ADDRESS, MAX);
            await xyz.approve(CONTROLLER_ADDRESS, MAX);

            await controller.createPool(toWei('100'));
        });

        describe('configurableWeights only', () => {
            it('Controller should be able to call updateWeightsGradually() with valid range', async () => {
                blockRange = 20;
                // get current block number
                const block = await web3.eth.getBlock('latest');
                // console.log("Block of updateWeightsGradually() call: "+block.number)
                const startBlock = block.number + 3;
                const endBlock = startBlock + blockRange;
                const endWeights = [toWei('39'), toWei('1')];
                console.log(`Start block for June -> July flipping: ${startBlock}`);
                console.log(`End   block for June -> July flipping: ${endBlock}`);
                await controller.updateWeightsGradually(endWeights, startBlock, endBlock);
            });

            it('Should revert because too early to pokeWeights()', async () => {
                const block = await web3.eth.getBlock('latest');
                console.log(`Block: ${block.number}`);
                truffleAssert.reverts(
                    controller.pokeWeights(),
                    'ERR_CANT_POKE_YET',
                );
            });

            it('Cannot manually update when an automatic one is running', async () => {
                await truffleAssert.reverts(
                    controller.updateWeight(weth.address, toWei('20')),
                    'ERR_NO_UPDATE_DURING_GRADUAL',
                );
            });

            it('Cannot start adding a token when an automatic update is running', async () => {
                await truffleAssert.reverts(
                    // Need to add one that's not bound, and also have the add/remove token permission set
                    // to trigger this error
                    controller.commitAddToken(DAI, toWei('10000'), toWei('1.5')),
                    'ERR_NO_UPDATE_DURING_GRADUAL',
                );
            });

            it('Should be able to pokeWeights()', async () => {
                let i;
                let weightXYZ;
                let weightWETH;
                let block;

                for (i = 0; i < blockRange + 10; i++) {
                    weightXYZ = await controller.getDenormalizedWeight(XYZ);
                    weightWETH = await controller.getDenormalizedWeight(WETH);
                    block = await web3.eth.getBlock("latest");
                    console.log('Block: ' + block.number + '. Weights -> July: ' +
                        (weightXYZ*2.5/10**18).toString() + '%\tJune: ' +
                        (weightWETH*2.5/10**18).toString() + '%');
                    await controller.pokeWeights();
                }
            });

            it('Controller should be able to call updateWeightsGradually() again', async () => {
                blockRange = 50;
                // get current block number
                const block = await web3.eth.getBlock('latest');
                // console.log("Block of updateWeightsGradually() call: "+block.number)
                const startBlock = block.number + 3;
                const endBlock = startBlock + blockRange;
                const endWeights = [toWei('1'), toWei('39')];
                console.log(`Start block for July -> August flipping: ${startBlock}`);
                console.log(`End   block for July -> August flipping: ${endBlock}`);

                await controller.updateWeightsGradually(endWeights, startBlock, endBlock);
            });

            it('Should revert because too early to pokeWeights()', async () => {
                // block = await web3.eth.getBlock("latest");
                // console.log("Block: "+block.number);
                truffleAssert.reverts(
                    controller.pokeWeights(),
                    'ERR_CANT_POKE_YET',
                );
            });

            it('Should be able to pokeWeights()', async () => {
                let i;
                const endWeights = [toWei('1'), toWei('29'), toWei('10')];

                for (i = 0; i < blockRange+10; i++) {
                    const weightXYZ = await controller.getDenormalizedWeight(XYZ);
                    const weightWETH = await controller.getDenormalizedWeight(WETH);
                    const block = await web3.eth.getBlock('latest');
                    console.log('Block: ' + block.number + '. Weights -> July: ' +
                        (weightXYZ*2.5/10**18).toString() + '%\tAugust: ' + 
                        (weightWETH*2.5/10**18).toString() + '%');
                    await controller.pokeWeights();

                    // Try to adust weights with mismatched tokens
                    if (1 == i) {
                        truffleAssert.reverts(
                          controller.updateWeightsGradually(endWeights, i, i+5),
                          'ERR_START_WEIGHTS_MISMATCH');
                    }
                }
            });
        });
    });
});
