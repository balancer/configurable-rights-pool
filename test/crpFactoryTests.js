const BFactory = artifacts.require('BFactory');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');


contract('CRPFactory', async (accounts) => {
    const admin = accounts[0];
    const { toWei } = web3.utils;

    const MAX = web3.utils.toTwosComplement(-1);

    let crpFactory;
    let bFactory;
    let crpPool;
    let CRPPOOL;
    let CRPPOOL_ADDRESS;
    let WETH;
    let DAI;
    let XYZ;
    let weth;
    let dai;
    let xyz;
    const startWeights = [toWei('12'), toWei('1.5'), toWei('1.5')];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
    const SYMBOL = 'BSP';
    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: false,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
    };

    before(async () => {
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        xyz = await TToken.new('XYZ', 'XYZ', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

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
            10 ** 15, // swapFee
            permissions,
        );

        await crpFactory.newCrp(
            bFactory.address,
            SYMBOL,
            [XYZ, WETH, DAI],
            startBalances,
            startWeights,
            10 ** 15, // swapFee
            permissions,
        );

        crpPool = await ConfigurableRightsPool.at(CRPPOOL);

        CRPPOOL_ADDRESS = crpPool.address;

        await weth.approve(CRPPOOL_ADDRESS, MAX);
        await dai.approve(CRPPOOL_ADDRESS, MAX);
        await xyz.approve(CRPPOOL_ADDRESS, MAX);

        await crpPool.createPool(toWei('100'));
    });

    it('CRPFactory should have new crpPool registered', async () => {
        console.log(CRPPOOL_ADDRESS);
        const isPoolRegistered = await crpFactory.isCrp(CRPPOOL_ADDRESS);

        assert.equal(isPoolRegistered, true, `Expected ${CRPPOOL_ADDRESS} to be registered.`);
    });

    it('CRPFactory should not have random address registered', async () => {
        const isPoolRegistered = await crpFactory.isCrp(WETH);
        assert.equal(isPoolRegistered, false, 'Expected not to be registered.');
    });

    it('should not be able to create with mismatched start Weights', async () => {
        const badStartWeights = [toWei('12'), toWei('1.5')];

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                SYMBOL,
                [XYZ, WETH, DAI],
                startBalances,
                badStartWeights,
                10 ** 15,
                permissions,
            ),
        );
    });

    it('should not be able to create with mismatched start Weights', async () => {
        const badStartBalances = [toWei('80000'), toWei('40'), toWei('10000'), toWei('5000')];

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                SYMBOL,
                [XYZ, WETH, DAI],
                badStartBalances,
                startWeights,
                10 ** 15,
                permissions,
            ),
        );
    });

    it('should not be able to create with zero fee', async () => {
        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                SYMBOL,
                [XYZ, WETH, DAI],
                startBalances,
                startWeights,
                0,
                permissions,
            ),
        );
    });

    it('should not be able to create with a fee above the MAX', async () => {
        // Max is 10**18 / 10
        // Have to pass it as a string for some reason...
        const invalidSwapFee = '200000000000000000';

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                SYMBOL,
                [XYZ, WETH, DAI],
                startBalances,
                startWeights,
                invalidSwapFee,
                permissions,
            ),
        );
    });

    // ?????? Check for controller?
});
