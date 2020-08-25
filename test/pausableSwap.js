/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');
const { calcOutGivenIn, calcInGivenOut, calcRelativeDiff } = require('../lib/calc_comparisons');

contract('pausableSwap', async (accounts) => {
    const admin = accounts[0];
    const user = accounts[1];

    const { toWei, fromWei } = web3.utils;
    const MAX = web3.utils.toTwosComplement(-1);
    const errorDelta = 10 ** -8;

    let crpFactory; let
        bFactory;
    let crpPool;
    let CRPPOOL;
    let WETH; let DAI; let XYZ;
    let weth; let dai; let xyz;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    const startingXyzWeight = '12';
    const startingWethWeight = '1.5';
    const startingDaiWeight = '1.5';
    const startWeights = [toWei(startingXyzWeight), toWei(startingWethWeight), toWei(startingDaiWeight)];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
    const SYMBOL = 'BSP';
    const NAME = 'Balancer Pool Token';

    let tokenIn;
    let tokenOut;

    // const permissions = [true, false, false, false];
    const permissions = {
        canPauseSwapping: true,
        canChangeSwapFee: false,
        canChangeWeights: false,
        canAddRemoveTokens: false,
        canWhitelistLPs: false,
        canChangeCap: false,
    };

    before(async () => {
        /*
        Uses deployed BFactory & CRPFactory.
        Deploys new test tokens - XYZ, WETH, DAI, ABC, ASD
        Mints test tokens for Admin user (account[0])
        CRPFactory creates new CRP.
        Admin approves CRP for MAX
        newCrp call with pausableSwap set to true
        */
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        xyz = await TToken.new('XYZ', 'XYZ', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        WETH = weth.address;
        DAI = dai.address;
        XYZ = xyz.address;

        tokenIn = WETH;
        tokenOut = DAI;

        // admin balances
        await weth.mint(admin, toWei('100'));
        await dai.mint(admin, toWei('15000'));
        await xyz.mint(admin, toWei('100000'));

        await weth.mint(user, toWei('10'));

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

        await crpPool.createPool(toWei('100'));
    });

    it('crpPool should have correct rights set', async () => {
        const swapRight = await crpPool.hasPermission(0);
        assert.isTrue(swapRight);

        let x;
        for (x = 0; x < permissions.length; x++) {
            if (x !== 0) {
                const otherPerm = await crpPool.hasPermission(x);
                assert.isFalse(otherPerm);
            }
        }
    });

    it('ConfigurableRightsPool isPublicSwap should be true after creation', async () => {
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);
        const isPublicSwap = await crpPool.isPublicSwap.call();
        assert.equal(isPublicSwap, true);
        const isPublicSwapCheck = await bPool.isPublicSwap.call();
        assert.equal(isPublicSwapCheck, true);
    });

    it('Set public swap should revert for non-controller', async () => {
        await truffleAssert.reverts(
            crpPool.setPublicSwap(false, { from: user }),
            'ERR_NOT_CONTROLLER',
        );
    });

    it('Controller should be able to pause trades', async () => {
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);

        await crpPool.setPublicSwap(false);

        const isPublicSwap = await crpPool.isPublicSwap.call();
        assert.equal(isPublicSwap, false);
        const isPublicSwapCheck = await bPool.isPublicSwap.call();
        assert.equal(isPublicSwapCheck, false);
    });

    it('Non-controller should not be able to restart trades', async () => {
        await truffleAssert.reverts(
            crpPool.setPublicSwap(true, { from: user }),
            'ERR_NOT_CONTROLLER',
        );
    });

    it('Should not allow swaps while paused', async () => {
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);

        await truffleAssert.reverts(
            bPool.swapExactAmountIn(
                DAI, toWei('500'),
                WETH, toWei('0'),
                MAX,
                { from: user },
            ),
            'ERR_SWAP_NOT_PUBLIC',
        );

        await truffleAssert.reverts(
            bPool.swapExactAmountOut(
                DAI, MAX,
                WETH, toWei('1'),
                MAX,
                { from: user },
            ),
            'ERR_SWAP_NOT_PUBLIC',
        );
    });

    it('Controller should be able to restart trades', async () => {
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);

        await crpPool.setPublicSwap(true);

        const isPublicSwap = await crpPool.isPublicSwap.call();
        assert.equal(isPublicSwap, true);
        const isPublicSwapCheck = await bPool.isPublicSwap.call();
        assert.equal(isPublicSwapCheck, true);
    });

    it('Should allow swap in now', async () => {
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);

        await weth.approve(bPool.address, MAX, { from: user });

        const tokenInBalance = await weth.balanceOf.call(bPool.address);
        const tokenInWeight = await bPool.getDenormalizedWeight(WETH);
        const tokenOutBalance = await dai.balanceOf.call(bPool.address);
        const tokenOutWeight = await bPool.getDenormalizedWeight(DAI);

        const expectedTotalOut = calcOutGivenIn(
            fromWei(tokenInBalance),
            fromWei(tokenInWeight),
            fromWei(tokenOutBalance),
            fromWei(tokenOutWeight),
            '5',
            '0.001',
        );

        // Actually returns an array of tokenAmountOut, spotPriceAfter
        const tokenAmountOut = await bPool.swapExactAmountIn.call(
            tokenIn,
            toWei('5'), // tokenAmountIn
            tokenOut,
            toWei('0'), // minAmountOut
            MAX,
            { from: user },
        );
        const relDif = calcRelativeDiff(expectedTotalOut, fromWei(tokenAmountOut[0]));
        assert.isAtMost(relDif.toNumber(), errorDelta);
    });

    it('Should now allow swap outs', async () => {
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);

        await weth.approve(bPool.address, MAX, { from: user });

        const tokenInBalance = await weth.balanceOf.call(bPool.address); // 40
        const tokenInWeight = await bPool.getDenormalizedWeight(WETH); // 1.5
        const tokenOutBalance = await dai.balanceOf.call(bPool.address); // 10000
        const tokenOutWeight = await bPool.getDenormalizedWeight(DAI); // 1.5

        const expectedTotalIn = calcInGivenOut(
            fromWei(tokenInBalance),
            fromWei(tokenInWeight),
            fromWei(tokenOutBalance),
            fromWei(tokenOutWeight),
            '100',
            '0.001',
        );

        // Actually returns an array of tokenAmountIn, spotPriceAfter
        const tokenAmountIn = await bPool.swapExactAmountOut.call(
            tokenIn,
            MAX, // maxAmountIn
            tokenOut,
            toWei('100'), // tokenAmountOut
            MAX, // maxPrice
            { from: user },
        );
        const relDif = calcRelativeDiff(expectedTotalIn, fromWei(tokenAmountIn[0]));
        assert.isAtMost(relDif.toNumber(), errorDelta);
    });

    it('Controller should not be able to change swapFee', async () => {
        await truffleAssert.reverts(
            crpPool.setSwapFee(toWei('1')),
            'ERR_NOT_CONFIGURABLE_SWAP_FEE',
        );
    });

    it('Set swap fee should revert because non-permissioned', async () => {
        await truffleAssert.reverts(
            crpPool.setSwapFee(toWei('0.01')),
            'ERR_NOT_CONFIGURABLE_SWAP_FEE',
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

    it('Configurable weight should revert because non-permissioned', async () => {
        await truffleAssert.reverts(
            crpPool.updateWeight(xyz.address, toWei('13')),
            'ERR_NOT_CONFIGURABLE_WEIGHTS',
        );

        const block = await web3.eth.getBlock('latest');

        await truffleAssert.reverts(
            crpPool.updateWeightsGradually([toWei('2'), toWei('5'), toWei('5')], block.number, block.number + 10),
            'ERR_NOT_CONFIGURABLE_WEIGHTS',
        );

        await truffleAssert.reverts(
            crpPool.pokeWeights(),
            'ERR_NOT_CONFIGURABLE_WEIGHTS',
        );
    });
});
