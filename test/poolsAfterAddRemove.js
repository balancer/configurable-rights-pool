/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const BPool = artifacts.require('BPool');
const truffleAssert = require('truffle-assertions');
const { time } = require('@openzeppelin/test-helpers');

contract('configurableAddRemoveTokens - join/exit after add', async (accounts) => {
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
    const NAME = 'Balancer Pool Token';

    const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: false,
        canAddRemoveTokens: true,
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
        await abc.approve(CRPPOOL_ADDRESS, MAX);
        await asd.approve(CRPPOOL_ADDRESS, MAX);

        await crpPool.createPool(toWei('100'), 10, 10);
    });

    describe('JoinExit after add', () => {
        it('Controller should be able to commitAddToken', async () => {
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
    
        it('Controller should be able to applyAddToken', async () => {
            let block = await web3.eth.getBlock('latest');
            while (block.number <= applyAddTokenValidBlock) {
                 console.log(`Waiting; block: ${block.number}`);
                await time.advanceBlock();
                block = await web3.eth.getBlock('latest');
           }
    
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
    
        it('Should be able to join/exit pool after addition', async () => {
            const poolAmountOut = '1';
            await crpPool.joinPool(toWei(poolAmountOut), [MAX, MAX, MAX, MAX]);
        
            const poolAmountIn = '99';
            await crpPool.exitPool(toWei(poolAmountIn), [toWei('0'), toWei('0'), toWei('0'), toWei('0')]);
        });               
    });

    describe('JoinExit after remove', () => {
        it('Should be able to remove token', async () => {
            // Remove DAI
            await crpPool.removeToken(DAI);

            const bPoolAddr = await crpPool.bPool();
            const bPool = await BPool.at(bPoolAddr);

            // Verify gone
            await truffleAssert.reverts(
                bPool.getDenormalizedWeight.call(dai.address),
                'ERR_NOT_BOUND',
            );
        });

        it('Should be able to join/exit pool after removal', async () => {
            const poolAmountOut = '1';
            await crpPool.joinPool(toWei(poolAmountOut), [MAX, MAX, MAX]);
        
            const poolAmountIn = '10';
            await crpPool.exitPool(toWei(poolAmountIn), [toWei('0'), toWei('0'), toWei('0')]);
        });               
    });
});
