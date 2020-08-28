/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');

contract('configurableWeights_withTx', async (accounts) => {
    const admin = accounts[0];
    const user1 = accounts[1];
    const user2 = accounts[2];

    const swapFee = 10**15;

    const { toWei } = web3.utils;

    const MAX = web3.utils.toTwosComplement(-1);
    const SYMBOL = 'BSP';
    const NAME = 'Balancer Pool Token';

    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: true,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
        canChangeCap: false,
    };

    describe('Factory', () => {
        let bfactory;
        let factory;
        let controller;
        let CONTROLLER;
        let WETH;
        let XYZ;
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

            // admin balances
            await weth.mint(admin, toWei('100000000'));
            await dai.mint(admin, toWei('100000000'));
            await xyz.mint(admin, toWei('100000000'));
            await abc.mint(admin, toWei('100000000'));

            // user balances
            await weth.mint(user1, toWei('100000000'));
            await xyz.mint(user1, toWei('100000000'));
            await abc.mint(user1, toWei('100000000'));

            await weth.mint(user2, toWei('100000000'));
            await xyz.mint(user2, toWei('100000000'));
            await abc.mint(user2, toWei('100000000'));

            const poolParams = {
                poolTokenSymbol: SYMBOL,
                poolTokenName: NAME,
                constituentTokens: [XYZ, WETH],
                tokenBalances: startBalances,
                tokenWeights: startWeights,
                swapFee: swapFee,
            }
    
            CONTROLLER = await factory.newCrp.call(
                bfactory.address,
                poolParams,
                permissions,
            );

            await factory.newCrp(
                bfactory.address,
                poolParams,
                permissions,
            );

            controller = await ConfigurableRightsPool.at(CONTROLLER);

            const CONTROLLER_ADDRESS = controller.address;

            await weth.approve(CONTROLLER_ADDRESS, MAX);
            await dai.approve(CONTROLLER_ADDRESS, MAX);
            await xyz.approve(CONTROLLER_ADDRESS, MAX);

            await controller.createPool(toWei('100'), 10, 10);
        });

        describe('configurableWeights / Tx', () => {
            it('Controller should be able to call updateWeightsGradually() with valid range', async () => {
                blockRange = 20;
                // get current block number
                const block = await web3.eth.getBlock('latest');
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

            it('Should be able to pokeWeights()', async () => {
                let i;
                let weightXYZ;
                let weightWETH;
                let block;
                const poolAmountOut1 = '1';
                const bPoolAddr = await controller.bPool();
                const underlyingPool = await BPool.at(bPoolAddr);

                // Pool was created by CRP
                const owner = await underlyingPool.getController();
                assert.equal(owner, CONTROLLER);

                // By definition, underlying pool is not finalized
                const finalized = await underlyingPool.isFinalized();
                assert.isFalse(finalized);

                truffleAssert.reverts(
                    underlyingPool.finalize(), 'ERR_NOT_CONTROLLER',
                );

                const numTokens = await underlyingPool.getNumTokens();
                assert.equal(numTokens, 2);

                const poolTokens = await underlyingPool.getCurrentTokens();
                assert.equal(poolTokens[0], XYZ);
                assert.equal(poolTokens[1], WETH);

                let xyzBalance;
                let wethBalance;
                let xyzSpotPrice;
                let lastXyzPrice;
                let wethSpotPrice;
                let lastWethPrice;

                for (i = 0; i < blockRange + 10; i++) {
                    weightXYZ = await controller.getDenormalizedWeight(XYZ);
                    weightWETH = await controller.getDenormalizedWeight(WETH);
                    block = await web3.eth.getBlock('latest');
                    console.log('Block: ' + block.number + '. Weights -> July: ' +
                        (weightXYZ*2.5/10**18).toFixed(4) + '%\tJune: ' +
                        (weightWETH*2.5/10**18).toFixed(4) + '%');
                    await controller.pokeWeights();

                    // Balances should not change
                    xyzBalance = await underlyingPool.getBalance(XYZ);
                    wethBalance = await underlyingPool.getBalance(WETH);

                    assert.equal(xyzBalance, startBalances[0]);
                    assert.equal(wethBalance, startBalances[1]);

                    if (lastXyzPrice) {
                        xyzSpotPrice = await underlyingPool.getSpotPrice(XYZ, WETH);
                        wethSpotPrice = await underlyingPool.getSpotPrice(WETH, XYZ);

                        // xyz price should be going up; weth price should be going down
                        assert.isTrue(xyzSpotPrice <= lastXyzPrice);
                        assert.isTrue(wethSpotPrice >= lastWethPrice);

                        lastXyzPrice = xyzSpotPrice;
                        lastWethPrice = wethSpotPrice;
                    }

                    if (i === 5) {
                        // Random user tries to join underlying pool (cannot - not finalized)
                        truffleAssert.reverts(
                            underlyingPool.joinPool(toWei(poolAmountOut1), [MAX, MAX, MAX], { from: user1 }),
                            'ERR_NOT_FINALIZED',
                        );
                    }
                }
            });
        });
    });
});
