/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const ElasticSupplyPool = artifacts.require('ElasticSupplyPool');
const ESPFactory = artifacts.require('ESPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');


contract('ESPFactory', async (accounts) => {
    const admin = accounts[0];
    const { toWei } = web3.utils;

    const MAX = web3.utils.toTwosComplement(-1);

    let espFactory;
    let bFactory;
    let espPool;
    let ESPPOOL;
    let ESPPOOL_ADDRESS;
    let USDC;
    let DAI;
    let AMPL;
    let dai;
    let usdc;
    let ampl;
    const startWeights = [toWei('12'), toWei('1.5')];
    const startBalances = [toWei('80000'), toWei('10000')];
    const SYMBOL = 'ESP';
    const LONG_SYMBOL = 'ESP012345678901234567890123456789';
    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: true,
        canChangeWeights: true,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
    };

    before(async () => {
        bFactory = await BFactory.deployed();
        espFactory = await ESPFactory.deployed();
        usdc = await TToken.new('USD Stablecoin', 'USDC', 6);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
        ampl = await TToken.new('Ampleforth', 'AMPL', 9);

        DAI = dai.address;
        USDC = usdc.address;
        AMPL = ampl.address;

        // admin balances
        await dai.mint(admin, toWei('15000'));
        await usdc.mint(admin, toWei('100000'));
        await ampl.mint(admin, toWei('1000'));

        ESPPOOL = await espFactory.newEsp.call(
            bFactory.address,
            SYMBOL,
            [USDC, DAI],
            startBalances,
            startWeights,
            10 ** 15, // swapFee
            permissions,
        );

        await espFactory.newEsp(
            bFactory.address,
            SYMBOL,
            [USDC, DAI],
            startBalances,
            startWeights,
            10 ** 15, // swapFee
            permissions,
        );

        espPool = await ElasticSupplyPool.at(ESPPOOL);

        ESPPOOL_ADDRESS = espPool.address;

        await usdc.approve(ESPPOOL_ADDRESS, MAX);
        await dai.approve(ESPPOOL_ADDRESS, MAX);

        await espPool.createPool(toWei('100'));
    });

    it('CRPFactory should have new espPool registered', async () => {
        console.log(ESPPOOL_ADDRESS);
        const isPoolRegistered = await espFactory.isEsp(ESPPOOL_ADDRESS);

        assert.equal(isPoolRegistered, true, `Expected ${ESPPOOL_ADDRESS} to be registered.`);
    });

    it('CRPFactory should not have random address registered', async () => {
        const isPoolRegistered = await espFactory.isEsp(USDC);
        assert.equal(isPoolRegistered, false, 'Expected not to be registered.');
    });

    it('should be able to create with mismatched start Weights', async () => {
        const badStartWeights = [toWei('12'), toWei('1.5'), toWei('24')];

        
        await truffleAssert.reverts(
            espFactory.newEsp(
                bFactory.address,
                SYMBOL,
                [USDC, DAI],
                startBalances,
                badStartWeights,
                10 ** 15,
                permissions,
            ),
            'ERR_START_WEIGHTS_MISMATCH'
        );
    });

    it('should not be able to create with mismatched start Balances', async () => {
        const badStartBalances = [toWei('80000'), toWei('40'), toWei('10000'), toWei('5000')];

        await truffleAssert.reverts(
            espFactory.newEsp(
                bFactory.address,
                SYMBOL,
                [USDC, DAI],
                badStartBalances,
                startWeights,
                10 ** 15,
                permissions,
            ),
            'ERR_START_BALANCES_MISMATCH'
        );
    });

    it('should be able to create with a long symbol', async () => {
        espFactory.newEsp(
            bFactory.address,
            LONG_SYMBOL,
            [USDC, DAI],
            startBalances,
            startWeights,
            10 ** 15,
            permissions,
        )
    });

    it('should not be able to create with zero fee', async () => {
        await truffleAssert.reverts(
            espFactory.newEsp(
                bFactory.address,
                SYMBOL,
                [AMPL, USDC],
                startBalances,
                startWeights,
                0,
                permissions,
            ),
            'ERR_INVALID_SWAP_FEE'
        );
    });

    it('should not be able to create with a fee above the MAX', async () => {
        // Max is 10**18 / 10
        // Have to pass it as a string for some reason...
        const invalidSwapFee = '200000000000000000';

        await truffleAssert.reverts(
            espFactory.newEsp(
                bFactory.address,
                SYMBOL,
                [AMPL, USDC],
                startBalances,
                startWeights,
                invalidSwapFee,
                permissions,
            ),
            'ERR_INVALID_SWAP_FEE'
        );
    });
});
