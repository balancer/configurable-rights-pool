/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');


contract('CRPFactory', async (accounts) => {
    const admin = accounts[0];
    const { toWei } = web3.utils;

    const MAX = web3.utils.toTwosComplement(-1);
    const swapFee = 10**15;

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
    const LONG_SYMBOL = '012345678901234567890123456789012'
    const NAME = 'Balancer Pool Token';

    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: false,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
        canChangeCap: false,
    };

    // Can't seem to break it with this - possibly the optimizer is removing unused values?
    // I tried a very large structure (> 256), and still could not break it by passing in a large permissions struct
    // Could still be a problem with optimizer off, or in some way I can't foresee. We have general protection in the
    // Factory against any such shenanigans, by validating the expected calldata size. If it is too big, it reverts.
    const longPermissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: false,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
        canChangeCap: false,
        canMakeMischief: true,
        canOverflowArray: true,
        canBeThreeTooLong: true,
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
            longPermissions, // tolerates extra data at end (calldata still the same size)
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

        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [XYZ, WETH, DAI],
            tokenBalances: startBalances,
            tokenWeights: badStartWeights,
            swapFee: swapFee,
        }

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            ),
            'ERR_START_WEIGHTS_MISMATCH'
        );
    });

    it('should not be able to create with mismatched start Balances', async () => {
        const badStartBalances = [toWei('80000'), toWei('40'), toWei('10000'), toWei('5000')];

        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [XYZ, WETH, DAI],
            tokenBalances: badStartBalances,
            tokenWeights: startWeights,
            swapFee: swapFee,
        }

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            ),
            'ERR_START_BALANCES_MISMATCH'
        );
    });

    it('should still be able to create with a long symbol', async () => {
        const poolParams = {
            poolTokenSymbol: LONG_SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [XYZ, WETH, DAI],
            tokenBalances: startBalances,
            tokenWeights: startWeights,
            swapFee: swapFee,
        }

        crpFactory.newCrp(
            bFactory.address,
            poolParams,
            permissions,
        );
    });

    it('should not be able to create with zero fee', async () => {
        const poolParams = {
            poolTokenSymbol: LONG_SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [XYZ, WETH, DAI],
            tokenBalances: startBalances,
            tokenWeights: startWeights,
            swapFee: 0,
        }

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            ),
            'ERR_INVALID_SWAP_FEE'
        );
    });

    it('should not be able to create with a fee above the MAX', async () => {
        // Max is 10**18 / 10
        // Have to pass it as a string for some reason...
        const invalidSwapFee = '200000000000000000';

        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [XYZ, WETH, DAI],
            tokenBalances: startBalances,
            tokenWeights: startWeights,
            swapFee: invalidSwapFee,
        }

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            ),
            'ERR_INVALID_SWAP_FEE'
        );
    });

    it('should not be able to create with a single token', async () => {
        // Max is 10**18 / 10
        // Have to pass it as a string for some reason...
        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [DAI],
            tokenBalances: [toWei('1000')],
            tokenWeights: [toWei('20')],
            swapFee: swapFee,
        }

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            ),
            'ERR_TOO_FEW_TOKENS'
        );
    });

    it('should not be able to create with more than the max tokens', async () => {
        // Max is 10**18 / 10
        // Have to pass it as a string for some reason...
        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [DAI, DAI, DAI, DAI, DAI, DAI, DAI, DAI, DAI],
            tokenBalances: [toWei('1000'), toWei('1000'), toWei('1000'), toWei('1000'),
                            toWei('1000'), toWei('1000'), toWei('1000'), toWei('1000'),
                            toWei('1000')],
            tokenWeights: [toWei('20'), toWei('20'), toWei('20'), toWei('20'),
                           toWei('20'), toWei('20'), toWei('20'), toWei('20'), toWei('20')],
            swapFee: swapFee,
        }

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            ),
            'ERR_TOO_MANY_TOKENS'
        );
    });
});
