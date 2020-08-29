/* eslint-env es6 */

const BFactory = artifacts.require('BFactory');
const ConfigurableRightsPool = artifacts.require('ConfigurableRightsPool');
const CRPFactory = artifacts.require('CRPFactory');
const TToken = artifacts.require('TToken');
const truffleAssert = require('truffle-assertions');
const { assert } = require('chai');
const Decimal = require('decimal.js');

contract('BSP Cap', async (accounts) => {
    const admin = accounts[0];
    const user1 = accounts[1];
    const user2 = accounts[2];
    const user3 = accounts[3];

    const { toWei, fromWei } = web3.utils;
    const MAX = web3.utils.toTwosComplement(-1);
    // There should be a better way to do this... (constant in geth corresponding to uint(-1) apparently)
    const MaxBig256 = '115792089237316195423570985008687907853269984665640564039457.584007913129639935';

    let crpFactory; 
    let bFactory;
    let crpPool;
    let CRPPOOL;
    let DAI;
    let dai;
    let WETH;
    let weth

    // These are the intial settings for newCrp:
    const swapFee = 10 ** 15;

    // 50%/50%  Dai/Weth
    const startWeights = [toWei('20'), toWei('20')];
    const startBalances = [toWei('20000'), toWei('50')];
    const SYMBOL = 'BSP';
    const NAME = 'Balancer Pool Token';

     const permissions = {
        canPauseSwapping: false,
        canChangeSwapFee: false,
        canChangeWeights: true,
        canAddRemoveTokens: false,
        canWhitelistLPs: false,
        canChangeCap: true,
    };

    before(async () => {
        bFactory = await BFactory.deployed();
        crpFactory = await CRPFactory.deployed();
        weth = await TToken.new('Wrapped Ether', 'WETH', 18);
        dai = await TToken.new('Dai Stablecoin', 'DAI', 18);

        WETH = weth.address;
        DAI = dai.address;

        // admin balances
        await weth.mint(admin, toWei('60'));
        await dai.mint(admin, toWei('25000'));

        await dai.mint(user1, toWei('100000'));
        await dai.mint(user2, toWei('100000'));
        await dai.mint(user3, toWei('100000'));

        const tokenAddresses = [DAI, WETH];

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

        await crpPool.approve(user1, MAX);
        await crpPool.approve(user2, MAX);
        await crpPool.approve(user3, MAX);
    });

    it('crpPool should have correct rights set', async () => {
        const capRight = await crpPool.hasPermission(5);
        assert.isTrue(capRight);

        let x;
        for (x = 0; x < permissions.length; x++) {
            if (x !== 5) {
                const otherPerm = await crpPool.hasPermission(x);
                assert.isFalse(otherPerm);
            }
        }
    });

    it('Should not allow setting the cap with no pool yet', async () => {
        await truffleAssert.reverts(
            crpPool.setCap(toWei('1000')),
            'ERR_NOT_CREATED',
        );
    });

    it('ConfigurableRightsPool cap should be set to initial supply after creation', async () => {
        await crpPool.createPool(toWei('100'), 10, 10);

        const cap = await crpPool.bspCap();
        const supply = await crpPool.totalSupply.call();

        assert.equal(fromWei(cap), fromWei(supply));
    });

    it('Set cap should revert for non-controller', async () => {
        await truffleAssert.reverts(
            crpPool.setCap(toWei('1000'), { from: user1 }),
            'ERR_NOT_CONTROLLER',
        );
    });

    it('Controller should be able to set the cap to an intermediate value', async () => {
        const newCap = toWei('10000')
        await crpPool.setCap(newCap);

        const currentCap = await crpPool.bspCap();
        assert.equal(currentCap, newCap);
    });

    it('Controller should be able to set the cap to 0', async () => {
        await crpPool.setCap(0);

        const currentCap = await crpPool.bspCap();
        assert.equal(0, currentCap);
    });

    it('Controller should be able to set the cap to unlimited', async () => {
        await crpPool.setCap(MAX);

        const currentCap = await crpPool.bspCap();
        assert.equal(MaxBig256, fromWei(currentCap).toString());
    });

    describe('Joining pools', () => {
        it('Should set the cap above the initial supply', async () => {
            const newCap = toWei('200')
            await crpPool.setCap(newCap);
    
            const currentCap = await crpPool.bspCap();
            assert.equal(currentCap, newCap);
    
            const supply = await crpPool.totalSupply();
            assert.equal(fromWei(supply), 100);

            const balance = await crpPool.balanceOf.call(admin);
            assert.equal(fromWei(balance), 100);
        });
    
        it('Should allow LPs to join', async () => {
            // users have to allow the contract to pull dai
            await dai.approve(crpPool.address, MAX, {from: user1});
            await dai.approve(crpPool.address, MAX, {from: user2});
            await dai.approve(crpPool.address, MAX, {from: user3});

            const users = [user1, user2, user3];

            let userIdx = 0;
            let user;
            let supply;
            let balance;
            let expectedSupply = 100;

            let userBalances = [0, 0, 0];

            // Join until we reach the cap
            while (expectedSupply < 200) {
                // Select user
                user = users[userIdx];

                let amountOut = Math.floor(Math.random() * 20) + 1;
                
                // Because it's random, might go over - need to adjust so that it ends with exactly 200
                if (expectedSupply + amountOut > 200) {
                    const newAmountOut = 200 - expectedSupply;
                    console.log(`Adjusting last entry from ${amountOut} to ${newAmountOut}`);
                    amountOut = newAmountOut;
                }

                const daiCost = await crpPool.joinswapPoolAmountOut.call(DAI, toWei(amountOut.toString()), MAX, {from: user});
                console.log(`User ${userIdx+1} bought ${amountOut} shares for ${Decimal(fromWei(daiCost)).toFixed(2)} DAI`);
                userBalances[userIdx] += amountOut;
                expectedSupply += amountOut;

                // Actually do the swap
                await crpPool.joinswapPoolAmountOut(DAI, toWei(amountOut.toString()), MAX, {from: user});

                supply = await crpPool.totalSupply();
                console.log(`Total supply is now ${fromWei(supply)}`);
                assert.equal(Decimal(fromWei(supply)), expectedSupply);
    
                balance = await crpPool.balanceOf.call(user);
                assert.equal(Decimal(fromWei(balance)), userBalances[userIdx])

                // Next user
                if (3 == ++userIdx) {
                    userIdx = 0;
                }
            }
       });

        it('Should not allow anyone else to join', async () => {
            await truffleAssert.reverts(
                crpPool.joinswapPoolAmountOut.call(DAI, toWei('1'), MAX, {from: user3}),
                'ERR_CAP_LIMIT_REACHED',
            );    
        });
    });
});
