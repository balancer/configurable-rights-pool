/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const { calcOutGivenIn, calcRelativeDiff } = require('../lib/calc_comparisons');

/*
Tests initial CRP Pool set-up including:
BPool deployment, token binding, balance checks, BPT checks.
*/
contract('crpPoolSwapIns', async (accounts) => {
    const admin = accounts[0];
    const user1 = accounts[1];

    const { toWei, fromWei } = web3.utils;
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const MAX = web3.utils.toTwosComplement(-1);
    const errorDelta = 10 ** -8;

    // These are the intial settings for newCrp:
    const swapFee = toWei('0.003');
    const startWeights = [toWei('12'), toWei('1.5'), toWei('1.5')];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
    const SYMBOL = 'BSP';
    const NAME = 'Balancer Pool Token';

    const permissions = {
        canPauseSwapping: true,
        canChangeSwapFee: true,
        canChangeWeights: true,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
        canChangeCap: false,
    };

    let crpFactory;
    let bFactory;
    let bPoolAddr;
    let bPool;
    let bPool2;
    let bPool3;
    let crpPool;
    let crpPool2;
    let crpPool3;
    let CRPPOOL;
    let CRPPOOL2;
    let CRPPOOL3;
    let CRPPOOL_ADDRESS;
    let WETH;
    let DAI;
    let XYZ;
    let weth;
    let dai;
    let xyz;
    let adminXYZBalance;
    let bPoolXYZBalance;
    let adminWethBalance;
    let bPoolWethBalance;
    let adminDaiBalance;
    let bPoolDaiBalance;
    let xyzWeight;
    let daiWeight;
    let wethWeight;
    let adminBPTBalance;

    before(async () => {
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        xyz = await TToken.new('XYZ', 'XYZ', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        WETH = weth.address;
        DAI = dai.address;
        XYZ = xyz.address;

        // admin/user balances
        await weth.mint(admin, toWei('300'));
        await dai.mint(admin, toWei('45000'));
        await xyz.mint(admin, toWei('300000'));

        await weth.mint(user1, toWei('25'));
        await dai.mint(user1, toWei('10000'));
        await xyz.mint(user1, toWei('20'));

        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [XYZ, WETH, DAI],
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

        CRPPOOL_ADDRESS = crpPool.address;

        await weth.approve(CRPPOOL_ADDRESS, MAX);
        await dai.approve(CRPPOOL_ADDRESS, MAX);
        await xyz.approve(CRPPOOL_ADDRESS, MAX);

        CRPPOOL2 = await crpFactory.newCrp.call(
            bFactory.address,
            poolParams,
            permissions,
        );

        await crpFactory.newCrp(
            bFactory.address,
            poolParams,
            permissions,
        );

        crpPool2 = await ConfigurableRightsPool.at(CRPPOOL2);

        await weth.approve(crpPool2.address, MAX);
        await dai.approve(crpPool2.address, MAX);
        await xyz.approve(crpPool2.address, MAX);

        CRPPOOL3 = await crpFactory.newCrp.call(
            bFactory.address,
            poolParams,
            permissions,
        );

        await crpFactory.newCrp(
            bFactory.address,
            poolParams,
            permissions,
        );

        crpPool3 = await ConfigurableRightsPool.at(CRPPOOL3);

        await weth.approve(crpPool3.address, MAX);
        await dai.approve(crpPool3.address, MAX);
        await xyz.approve(crpPool3.address, MAX);
    });

    it('crpPools should have BPools after creation', async () => {
        await crpPool.createPool(toWei('100'));
        bPoolAddr = await crpPool.bPool();
        assert.notEqual(bPoolAddr, ZERO_ADDRESS);
        bPool = await BPool.at(bPoolAddr);

        await crpPool2.createPool(toWei('100'));
        bPoolAddr = await crpPool2.bPool();
        assert.notEqual(bPoolAddr, ZERO_ADDRESS);
        bPool2 = await BPool.at(bPoolAddr);

        await crpPool3.createPool(toWei('100'));
        bPoolAddr = await crpPool3.bPool();
        assert.notEqual(bPoolAddr, ZERO_ADDRESS);
        bPool3 = await BPool.at(bPoolAddr);
    });

    it('BPools should have initial token balances', async () => {
        bPoolAddr = await crpPool.bPool();

        adminXYZBalance = await xyz.balanceOf.call(admin);
        bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
        adminWethBalance = await weth.balanceOf.call(admin);
        bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
        adminDaiBalance = await dai.balanceOf.call(admin);
        bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

        assert.equal(adminXYZBalance, toWei('60000')); // 20000x3
        assert.equal(bPoolXYZBalance, toWei('80000'));
        assert.equal(adminWethBalance, toWei('180')); // 60x3
        assert.equal(bPoolWethBalance, toWei('40'));
        assert.equal(adminDaiBalance, toWei('15000')); // 5000x3
        assert.equal(bPoolDaiBalance, toWei('10000'));

        bPoolAddr = await crpPool2.bPool();

        bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
        bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
        bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

        assert.equal(bPoolXYZBalance, toWei('80000'));
        assert.equal(bPoolWethBalance, toWei('40'));
        assert.equal(bPoolDaiBalance, toWei('10000'));

        bPoolAddr = await crpPool3.bPool();

        bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
        bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
        bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

        assert.equal(bPoolXYZBalance, toWei('80000'));
        assert.equal(bPoolWethBalance, toWei('40'));
        assert.equal(bPoolDaiBalance, toWei('10000'));
    });

    it('BPool should have initial token weights', async () => {
        xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
        wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
        daiWeight = await bPool.getDenormalizedWeight.call(dai.address);

        assert.equal(xyzWeight, toWei('12'));
        assert.equal(wethWeight, toWei('1.5'));
        assert.equal(daiWeight, toWei('1.5'));

        xyzWeight = await bPool2.getDenormalizedWeight.call(xyz.address);
        wethWeight = await bPool2.getDenormalizedWeight.call(weth.address);
        daiWeight = await bPool2.getDenormalizedWeight.call(dai.address);

        assert.equal(xyzWeight, toWei('12'));
        assert.equal(wethWeight, toWei('1.5'));
        assert.equal(daiWeight, toWei('1.5'));

        xyzWeight = await bPool3.getDenormalizedWeight.call(xyz.address);
        wethWeight = await bPool3.getDenormalizedWeight.call(weth.address);
        daiWeight = await bPool3.getDenormalizedWeight.call(dai.address);

        assert.equal(xyzWeight, toWei('12'));
        assert.equal(wethWeight, toWei('1.5'));
        assert.equal(daiWeight, toWei('1.5'));
    });

    it('Admin should have initial BPT', async () => {
        adminBPTBalance = await crpPool.balanceOf.call(admin);
        assert.equal(adminBPTBalance, toWei('100'));

        adminBPTBalance = await crpPool2.balanceOf.call(admin);
        assert.equal(adminBPTBalance, toWei('100'));

        adminBPTBalance = await crpPool3.balanceOf.call(admin);
        assert.equal(adminBPTBalance, toWei('100'));
    });

    it('Should perform swaps', async () => {
        let tokenIn = WETH;
        let tokenOut = DAI;
        let tokenAmountOut;

        // 1st Swap - WETH for DAI
        await weth.approve(bPool.address, MAX, { from: user1 });

        let tokenInBalance = await weth.balanceOf.call(bPool.address); // 40
        let tokenInWeight = await bPool.getDenormalizedWeight(WETH); // 1.5
        let tokenOutBalance = await dai.balanceOf.call(bPool.address); // 10000
        let tokenOutWeight = await bPool.getDenormalizedWeight(DAI); // 1.5

        let expectedTotalOut = calcOutGivenIn(
            fromWei(tokenInBalance),
            fromWei(tokenInWeight),
            fromWei(tokenOutBalance),
            fromWei(tokenOutWeight),
            '0.5',
            fromWei(swapFee),
        );

        // Actually returns an array of tokenAmountOut, spotPriceAfter
        tokenAmountOut = await bPool.swapExactAmountIn.call(
            tokenIn,
            toWei('0.5'), // tokenAmountIn
            tokenOut,
            toWei('0'), // minAmountOut
            MAX,
            { from: user1 },
        );
        let relDif = calcRelativeDiff(expectedTotalOut, fromWei(tokenAmountOut[0]));
        assert.isAtMost(relDif.toNumber(), errorDelta);

        // 2nd Swap - DAI for WETH
        await dai.approve(bPool2.address, MAX, { from: user1 });

        tokenIn = DAI;
        tokenOut = WETH;

        tokenInBalance = await dai.balanceOf.call(bPool2.address);
        tokenInWeight = await bPool2.getDenormalizedWeight(DAI);
        tokenOutBalance = await weth.balanceOf.call(bPool2.address);
        tokenOutWeight = await bPool2.getDenormalizedWeight(WETH);

        expectedTotalOut = calcOutGivenIn(
            fromWei(tokenInBalance),
            fromWei(tokenInWeight),
            fromWei(tokenOutBalance),
            fromWei(tokenOutWeight),
            '500',
            fromWei(swapFee),
        );

        tokenAmountOut = await bPool2.swapExactAmountIn.call(
            tokenIn,
            toWei('500'), // tokenAmountIn
            tokenOut,
            toWei('0'), // minAmountOut
            MAX,
            { from: user1 },
        );
        relDif = calcRelativeDiff(expectedTotalOut, fromWei(tokenAmountOut[0]));
        assert.isAtMost(relDif.toNumber(), errorDelta);

        // 3rd Swap XYZ for WETH
        await xyz.approve(bPool3.address, MAX, { from: user1 });

        tokenIn = XYZ;
        tokenOut = WETH;

        tokenInBalance = await xyz.balanceOf.call(bPool3.address);
        tokenInWeight = await bPool3.getDenormalizedWeight(XYZ);
        tokenOutBalance = await weth.balanceOf.call(bPool3.address);
        tokenOutWeight = await bPool3.getDenormalizedWeight(WETH);

        expectedTotalOut = calcOutGivenIn(
            fromWei(tokenInBalance),
            fromWei(tokenInWeight),
            fromWei(tokenOutBalance),
            fromWei(tokenOutWeight),
            '10',
            fromWei(swapFee),
        );

        tokenAmountOut = await bPool3.swapExactAmountIn.call(
            tokenIn,
            toWei('10'), // tokenAmountIn
            tokenOut,
            toWei('0'), // minAmountOut
            MAX,
            { from: user1 },
        );

        relDif = calcRelativeDiff(expectedTotalOut, fromWei(tokenAmountOut[0]));
        assert.isAtMost(relDif.toNumber(), errorDelta);
    });
});
