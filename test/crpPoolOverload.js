const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');


/*
Tests initial CRP Pool set-up including:
BPool deployment, token binding, balance checks, BPT checks.
*/
contract('crpPoolOverloadTests', async (accounts) => {
    const admin = accounts[0];
    const { toWei, fromWei } = web3.utils;
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const MAX = web3.utils.toTwosComplement(-1);
    // These are the intial settings for newCrp:
    const swapFee = toWei('0.003');
    const startWeights = [toWei('12'), toWei('1.5'), toWei('1.5')];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
    const SYMBOL = 'BSP';
    const permissions = {
        canPauseSwapping: true,
        canChangeSwapFee: true,
        canChangeWeights: true,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
    };

    let crpFactory;
    let bFactory; 
    let bPool;
    let crpPool;
    let CRPPOOL;
    let CRPPOOL_ADDRESS;
    let WETH;
    let DAI;
    let XYZ;
    let weth;
    let dai;
    let xyz;
    let xxx;

    before(async () => {
        /*
        Uses deployed BFactory & CRPFactory.
        Deploys new test tokens - XYZ, WETH, DAI, ABC, ASD
        Mints test tokens for Admin user (account[0])
        CRPFactory creates new CRP.
        Admin approves CRP for MAX
        */
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        xyz = await TToken.new('XYZ', 'XYZ', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
        xxx = await TToken.new('XXX', 'XXX', 18);

        WETH = weth.address;
        DAI = dai.address;
        XYZ = xyz.address;

        // admin balances
        await weth.mint(admin, toWei('100'));
        await dai.mint(admin, toWei('15000'));
        await xyz.mint(admin, toWei('100000'));

        CRPPOOL = await crpFactory.newCrp.call(
            bFactory.address,
            SYMBOL,
            [XYZ, WETH, DAI],
            startBalances,
            startWeights,
            swapFee,
            permissions,
        );

        await crpFactory.newCrp(
            bFactory.address,
            SYMBOL,
            [XYZ, WETH, DAI],
            startBalances,
            startWeights,
            swapFee,
            permissions,
        );

        crpPool = await ConfigurableRightsPool.at(CRPPOOL);

        CRPPOOL_ADDRESS = crpPool.address;

        await weth.approve(CRPPOOL_ADDRESS, MAX);
        await dai.approve(CRPPOOL_ADDRESS, MAX);
        await xyz.approve(CRPPOOL_ADDRESS, MAX);
    });

    it('crpPool should not create pool with invalid minimumWeightChangeBlockPeriod', async () => {
        await truffleAssert.reverts(
            crpPool.createPool(toWei('100'), 5, 10),
            'ERR_INVALID_BLOCK_PERIOD',
        );
    });

    it('crpPool should not create pool with invalid addTokenTimeLockInBlocks', async () => {
        await truffleAssert.reverts(
            crpPool.createPool(toWei('100'), 10, 5),
            'ERR_INVALID_TOKEN_TIME_LOCK',
        );
    });

    it('crpPool should not create pool with inconsistent time parameters', async () => {
        await truffleAssert.reverts(
            crpPool.createPool(toWei('100'), 10, 20),
            'ERR_INCONSISTENT_TOKEN_TIME_LOCK',
        );
    });

    it('crpPool should have a BPool after creation', async () => {
        await crpPool.createPool(toWei('100'), 10, 10);
        const bPoolAddr = await crpPool.bPool();
        assert.notEqual(bPoolAddr, ZERO_ADDRESS);
        bPool = await BPool.at(bPoolAddr);
    });
});
