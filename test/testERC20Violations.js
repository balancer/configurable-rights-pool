/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const NoZeroXferToken = artifacts.require('NoZeroXferToken');
const NoPriorApprovalToken = artifacts.require('NoPriorApprovalToken');
const FalseReturningToken = artifacts.require('FalseReturningToken');
const TaxingToken = artifacts.require('TaxingToken');
const truffleAssert = require('truffle-assertions');
const { assert } = require('chai');
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
    let KNC;
    let BRET;
    let TAX;
    let LEND;
    let weth;
    let dai;
    let xyz;
    let knc;
    let lend;
    let bret;
    let tax;

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;
    const startWeights = [toWei('12'), toWei('1.5'), toWei('1.5')];
    const startBalances = [toWei('80000'), toWei('40'), toWei('10000')];
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

    describe 
    before(async () => {
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        xyz = await TToken.new('XYZ', 'XYZ', 18);
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);
        knc = await NoPriorApprovalToken.new('KNC', 'KNC', 18);
        lend = await NoZeroXferToken.new('LEND', 'LEND', 18);
        bret = await FalseReturningToken.new('BRET', 'BRET', 18);
        tax = await TaxingToken.new('TAX', 'TAX', 18);

        WETH = weth.address;
        DAI = dai.address;
        XYZ = xyz.address;
        KNC = knc.address;
        LEND = lend.address;
        BRET = bret.address;
        TAX = tax.address;

        // admin balances
        await weth.mint(admin, toWei('100'));
        await dai.mint(admin, toWei('15000'));
        await xyz.mint(admin, toWei('100000'));
        await knc.mint(admin, toWei('100000'));
        await lend.mint(admin, toWei('100000'));
        await bret.mint(admin, toWei('100000'));
        await tax.mint(admin, toWei('100000'));

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

        CRPPOOL_ADDRESS = crpPool.address;

        await weth.approve(CRPPOOL_ADDRESS, MAX);
        await dai.approve(CRPPOOL_ADDRESS, MAX);
        await xyz.approve(CRPPOOL_ADDRESS, MAX);
        await knc.approve(CRPPOOL_ADDRESS, MAX);
        await lend.approve(CRPPOOL_ADDRESS, MAX);
        await bret.approve(CRPPOOL_ADDRESS, MAX);
        await tax.approve(CRPPOOL_ADDRESS, MAX);

        await crpPool.createPool(toWei('100'), 10, 10);
    });

    it('crpPool should have correct rights set', async () => {
        const addRemoveRight = await crpPool.hasPermission(3);
        assert.isTrue(addRemoveRight);
        const changeWeightRight = await crpPool.hasPermission(2);
        assert.isTrue(changeWeightRight);

        let x;
        for (x = 0; x < permissions.length; x++) {
            if (x !== 3 && x !== 2) {
                const otherPerm = await crpPool.hasPermission(x);
                assert.isFalse(otherPerm);
            }
        }
    });

    it('should not be able to add a non-conforming token (0 transfer)', async () => {
        await truffleAssert.reverts(
            crpPool.commitAddToken(LEND, toWei('10000'), toWei('1.5')),
            'ERR_NO_ZERO_XFER'
        );
    });

    it('should not be able to add a non-conforming token (returns false)', async () => {
        await truffleAssert.reverts(
            crpPool.commitAddToken(BRET, toWei('10'), toWei('1.5')),
            'ERR_NONCONFORMING_TOKEN'
        );
    });

    it('should allow setting approvals multiple times, on tokens that require 0 prior', async () => {
        // Add a token that requires 0 prior approval
        await crpPool.commitAddToken(KNC, toWei('100'), toWei('1.5'));

        //let block = await web3.eth.getBlock('latest');
        let advanceBlocks = 15;
        while (--advanceBlocks) await time.advanceBlock();

        const kncToken = await NoPriorApprovalToken.at(KNC);

        const currentAllowance = await kncToken.allowance(admin, CRPPOOL_ADDRESS);
        //console.log(`Current allowance = ${currentAllowance}`);
        assert.notEqual(currentAllowance, 0);

        // This is going to call safeApprove (and it's already approved to MAX)
        await crpPool.applyAddToken();
    });

    it('should not be able to create with a non-conforming token (no zero xfer)', async () => {
        // LEND does not allow zero-token transfers, so it will fail on unbind (EXIT_FEE = 0)
        // Without the check, the CRP would be a roach motel (or Hotel California) -
        //   LEND could check in, but they couldn't check out
        // So prohibit creating a CRP that would contain non-conforming tokens
        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [XYZ, LEND, DAI],
            tokenBalances: startBalances,
            tokenWeights: startWeights,
            swapFee: swapFee,
        }

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            ),
            'ERR_NO_ZERO_XFER'
        );
    });

    it('should not be able to create with a non-conforming token (xfer returns false)', async () => {
        // LEND does not allow zero-token transfers, so it will fail on unbind (EXIT_FEE = 0)
        // Without the check, the CRP would be a roach motel (or Hotel California) -
        //   LEND could check in, but they couldn't check out
        // So prohibit creating a CRP that would contain non-conforming tokens
        const poolParams = {
            poolTokenSymbol: SYMBOL,
            poolTokenName: NAME,
            constituentTokens: [XYZ, BRET, DAI],
            tokenBalances: startBalances,
            tokenWeights: startWeights,
            swapFee: swapFee,
        }

        await truffleAssert.reverts(
            crpFactory.newCrp(
                bFactory.address,
                poolParams,
                permissions,
            ),
            'ERR_NONCONFORMING_TOKEN'
        );
    });
});
