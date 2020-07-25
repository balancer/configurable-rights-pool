const BFactory = artifacts.require('BFactory');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const BPool = artifacts.require('BPool');
const truffleAssert = require('truffle-assertions');
const { time } = require('@openzeppelin/test-helpers');

contract('configurableAddRemoveTokens', async (accounts) => {
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
    let ABC;
    let ASD;
    let weth;
    let dai;
    let xyz;
    let abc;
    let asd;
    let applyAddTokenValidBlock;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    const startWeights = [toWei('12'), toWei('1.5'), toWei('1.5')];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
    const addTokenTimeLockInBlocks = 10;
    const SYMBOL = 'BSP';
    // const permissions = [false, false, false, true];
    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: false,
        canAddRemoveTokens: true,
        canWhitelistLPs: false,
    };

    before(async () => {
        /*
        Uses deployed BFactory & CRPFactory.
        Deploys new test tokens - XYZ, WETH, DAI, ABC, ASD
        Mints test tokens for Admin user (account[0])
        CRPFactory creates new CRP.
        Admin approves CRP for MAX
        newCrp call with configurableAddRemoveTokens set to true
        */
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        xyz = await TToken.new('XYZ', 'XYZ', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
        abc = await TToken.new('ABC', 'ABC', 18);
        asd = await TToken.new('ASD', 'ASD', 18);

        WETH = weth.address;
        DAI = dai.address;
        XYZ = xyz.address;
        ABC = abc.address;
        ASD = asd.address;

        // admin balances
        await weth.mint(admin, toWei('100'));
        await dai.mint(admin, toWei('15000'));
        await xyz.mint(admin, toWei('100000'));
        await abc.mint(admin, toWei('100000'));
        await asd.mint(admin, toWei('100000'));

        const tokenAddresses = [XYZ, WETH, DAI];

        CRPPOOL = await crpFactory.newCrp.call(
            bFactory.address,
            SYMBOL,
            tokenAddresses,
            startBalances,
            startWeights,
            swapFee,
            permissions,
        );

        await crpFactory.newCrp(
            bFactory.address,
            SYMBOL,
            tokenAddresses,
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
        await abc.approve(CRPPOOL_ADDRESS, MAX);
        await asd.approve(CRPPOOL_ADDRESS, MAX);

        await crpPool.createPool(toWei('100'));
    });

    it('crpPool should have correct rights set', async () => {
        // const currentRights = await crpPool.getCurrentRights();
        // assert.sameMembers(currentRights, [false, false, false, true]);
        const addRemoveRight = await crpPool.hasPermission(3);
        assert.isTrue(addRemoveRight);

        let x;
        for (x = 0; x < permissions.length; x++) {
            if (x !== 3) {
                const otherPerm = await crpPool.hasPermission(x);
                assert.isFalse(otherPerm);
            }
        }
    });

    it('Controller should not be able to commitAddToken with invalid weight', async () => {
        await truffleAssert.reverts(
            crpPool.commitAddToken(ABC, toWei('10000'), toWei('50.1')),
            'ERR_WEIGHT_ABOVE_MAX',
        );

        await truffleAssert.reverts(
            crpPool.commitAddToken(ABC, toWei('10000'), toWei('0.1')),
            'ERR_WEIGHT_BELOW_MIN',
        );

        // Initial weights are: [toWei('12'), toWei('1.5'), toWei('1.5')];
        await truffleAssert.reverts(
            crpPool.commitAddToken(ABC, toWei('10000'), toWei('35.1')), // total weight = 50.1, invalid
            'ERR_MAX_TOTAL_WEIGHT',
        );
    });

    it('Non Controller account should not be able to commitAddToken', async () => {
        await truffleAssert.reverts(
            crpPool.commitAddToken(WETH, toWei('20'), toWei('1.5'), { from: accounts[1] }),
            'ERR_NOT_CONTROLLER',
        );
    });

    it('Controller should not be able to applyAddToken for a token that is already bound', async () => {
        truffleAssert.reverts(
            crpPool.commitAddToken(WETH, toWei('20'), toWei('1.5')),
            'ERR_IS_BOUND',
        );
    });

    it('Controller should not be able to applyAddToken for no commitment', async () => {
        truffleAssert.reverts(
            crpPool.applyAddToken(),
            'ERR_NO_TOKEN_COMMIT',
        );
    });

    it('Controller should be able to commitAddToken again', async () => {
        const block = await web3.eth.getBlock('latest');
        applyAddTokenValidBlock = block.number + addTokenTimeLockInBlocks;
        console.log(`Block commitAddToken for ABC: ${block.number}`);
        console.log(`applyAddToken valid block: ${applyAddTokenValidBlock}`);
        await crpPool.commitAddToken(ABC, toWei('10000'), toWei('1.5'));

        // original has no ABC
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);
        const bPoolAbcBalance = await abc.balanceOf.call(bPoolAddr);
        const adminAbcBalance = await abc.balanceOf.call(admin);

        await truffleAssert.reverts(
            bPool.getDenormalizedWeight.call(abc.address),
            'ERR_NOT_BOUND',
        );

        assert.equal(bPoolAbcBalance, toWei('0'));
        assert.equal(adminAbcBalance, toWei('100000'));
    });

    it('Controller should not be able to applyAddToken before addTokenTimeLockInBlocks', async () => {
        let block = await web3.eth.getBlock('latest');

        assert(block.number < applyAddTokenValidBlock, 'Block Should Be Less Than Valid Block At Start Of Test');

        while (block.number < applyAddTokenValidBlock) {
            console.log(`applyAddToken valid block: ${applyAddTokenValidBlock}, current block: ${block.number} `);

            await truffleAssert.reverts(
                crpPool.applyAddToken(),
                'ERR_TIMELOCK_STILL_COUNTING',
            );

            block = await web3.eth.getBlock('latest');
        }

        // Move blocks on
        let advanceBlocks = 7;
        while (--advanceBlocks) await time.advanceBlock();
    });

    it('Non Controller account should not be able to applyAddToken', async () => {
        await truffleAssert.reverts(
            crpPool.applyAddToken({ from: accounts[1] }),
            'ERR_NOT_CONTROLLER',
        );
    });

    it('Controller should be able to applyAddToken', async () => {
        const block = await web3.eth.getBlock('latest');
        assert(block.number > applyAddTokenValidBlock, 'Block Should Be Greater Than Valid Block At Start Of Test');

        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);

        let adminBPTBalance = await crpPool.balanceOf.call(admin);
        let adminAbcBalance = await abc.balanceOf.call(admin);
        let bPoolAbcBalance = await abc.balanceOf.call(bPoolAddr);

        assert.equal(adminBPTBalance, toWei('100'));
        assert.equal(adminAbcBalance, toWei('100000'));
        assert.equal(bPoolAbcBalance, toWei('0'));

        await crpPool.applyAddToken();

        adminBPTBalance = await crpPool.balanceOf.call(admin);
        adminAbcBalance = await abc.balanceOf.call(admin);
        bPoolAbcBalance = await abc.balanceOf.call(bPoolAddr);
        const bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
        const bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
        const bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

        // BPT Balance should go from 100 to 110 since total weight went from 15 to 16.5
        assert.equal(adminBPTBalance, toWei('110'));
        assert.equal(adminAbcBalance, toWei('90000'));
        assert.equal(bPoolAbcBalance, toWei('10000'));
        assert.equal(bPoolXYZBalance, toWei('80000'));
        assert.equal(bPoolWethBalance, toWei('40'));
        assert.equal(bPoolDaiBalance, toWei('10000'));

        const xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
        const wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
        const daiWeight = await bPool.getDenormalizedWeight.call(dai.address);
        const abcWeight = await bPool.getDenormalizedWeight.call(abc.address);

        assert.equal(xyzWeight, toWei('12'));
        assert.equal(wethWeight, toWei('1.5'));
        assert.equal(daiWeight, toWei('1.5'));
        assert.equal(abcWeight, toWei('1.5'));
    });

    it('Controller should not be able to applyAddToken after finished', async () => {
        truffleAssert.reverts(
            crpPool.applyAddToken(),
            'ERR_NO_TOKEN_COMMIT',
        );
    });

    it('Controller should not be able to removeToken if token is not bound', async () => {
        truffleAssert.reverts(
            crpPool.removeToken(ASD),
            'ERR_NOT_BOUND',
        );
    });

    it('Non Controller account should not be able to removeToken if token is bound', async () => {
        await truffleAssert.reverts(
            crpPool.removeToken(DAI, { from: accounts[1] }),
            'ERR_NOT_CONTROLLER',
        );
    });

    it('Controller should be able to removeToken if token is bound', async () => {
        const bPoolAddr = await crpPool.bPool();
        const bPool = await BPool.at(bPoolAddr);

        let adminBPTBalance = await crpPool.balanceOf.call(admin);
        let adminDaiBalance = await dai.balanceOf.call(admin);
        let bPoolAbcBalance = await abc.balanceOf.call(bPoolAddr);
        let bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
        let bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
        let bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

        assert.equal(adminBPTBalance, toWei('110'));
        assert.equal(adminDaiBalance, toWei('5000'));
        assert.equal(bPoolAbcBalance, toWei('10000'));
        assert.equal(bPoolXYZBalance, toWei('80000'));
        assert.equal(bPoolWethBalance, toWei('40'));
        assert.equal(bPoolDaiBalance, toWei('10000'));

        await crpPool.removeToken(DAI);

        adminBPTBalance = await crpPool.balanceOf.call(admin);
        adminDaiBalance = await dai.balanceOf.call(admin);
        bPoolAbcBalance = await abc.balanceOf.call(bPoolAddr);
        bPoolXYZBalance = await xyz.balanceOf.call(bPoolAddr);
        bPoolWethBalance = await weth.balanceOf.call(bPoolAddr);
        bPoolDaiBalance = await dai.balanceOf.call(bPoolAddr);

        // DAI Balance should go from 5000 to 15000 (since 10000 was given back from pool with DAI removal)
        // BPT Balance should go from 110 to 100 since total weight went from 16.5 to 15
        assert.equal(adminBPTBalance, toWei('100'));
        assert.equal(adminDaiBalance, toWei('15000'));
        assert.equal(bPoolAbcBalance, toWei('10000'));
        assert.equal(bPoolXYZBalance, toWei('80000'));
        assert.equal(bPoolWethBalance, toWei('40'));
        assert.equal(bPoolDaiBalance, toWei('0'));

        // Confirm all other weights and balances?
        const xyzWeight = await bPool.getDenormalizedWeight.call(xyz.address);
        const wethWeight = await bPool.getDenormalizedWeight.call(weth.address);
        const abcWeight = await bPool.getDenormalizedWeight.call(abc.address);

        await truffleAssert.reverts(
            bPool.getDenormalizedWeight.call(dai.address),
            'ERR_NOT_BOUND',
        );

        assert.equal(xyzWeight, toWei('12'));
        assert.equal(wethWeight, toWei('1.5'));
        assert.equal(abcWeight, toWei('1.5'));
    });

    it('Set public swap should revert because non-permissioned', async () => {
        await truffleAssert.reverts(
            crpPool.setPublicSwap(false),
            'ERR_NOT_PAUSABLE_SWAP',
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

    it('Set swap fee should revert because non-permissioned', async () => {
        await truffleAssert.reverts(
            crpPool.setSwapFee(toWei('0.01')),
            'ERR_NOT_CONFIGURABLE_SWAP_FEE',
        );
    });

    it('Should fail when adding a token without enough token balance', async () => {
        const block = await web3.eth.getBlock('latest');
        applyAddTokenValidBlock = block.number + addTokenTimeLockInBlocks;
        console.log(`Block commitAddToken for DAI: ${block.number}`);
        console.log(`applyAddToken valid block: ${applyAddTokenValidBlock}`);
        await crpPool.commitAddToken(DAI, toWei('150000'), toWei('1.5'));

        let advanceBlocks = addTokenTimeLockInBlocks + 2;
        while (--advanceBlocks) await time.advanceBlock();

        await truffleAssert.reverts(
            crpPool.applyAddToken(),
            'ERR_INSUFFICIENT_BAL',
        );
    });

    // ??????? other weight edge cases
});
