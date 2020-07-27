/* eslint-env es6 */

const BalancerSafeMathMock = artifacts.require('BalancerSafeMathMock');
const { BN, constants, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');

const { MAX_UINT256 } = constants;


contract('Test Math', async () => {
    const MAX = web3.utils.toTwosComplement(-1);

    const minValue = new BN('1234');
    const maxValue = new BN('5678');
    const errorDelta = 10 ** -8;

    const { toWei } = web3.utils;

    let bMath;

    before(async () => {
        bMath = await BalancerSafeMathMock.deployed();
    });

    describe('Basic Math', () => {
        it('badd throws on overflow', async () => {
            await truffleAssert.reverts(bMath.badd(1, MAX), 'ERR_ADD_OVERFLOW');
        });

        it('bsub throws on underflow', async () => {
            await truffleAssert.reverts(bMath.bsub(1, 2), 'ERR_SUB_UNDERFLOW');
        });

        it('bmul throws on overflow', async () => {
            await truffleAssert.reverts(bMath.bmul(2, MAX), 'ERR_MUL_OVERFLOW');
        });

        it('bdiv throws on div by 0', async () => {
            await truffleAssert.reverts(bMath.bdiv(1, 0), 'ERR_DIV_ZERO');
        });

        it('bmod throws on div by 0', async () => {
            await truffleAssert.reverts(bMath.bmod(1, 0), 'ERR_MODULO_BY_ZERO');
        });
    });

    describe('max', async () => {
        it('is correctly detected in first argument position', async () => {
            expect(await bMath.bmax(maxValue, minValue)).to.be.bignumber.equal(maxValue);
        });

        it('is correctly detected in second argument position', async () => {
            expect(await bMath.bmax(minValue, maxValue)).to.be.bignumber.equal(maxValue);
        });
    });

    describe('min', async () => {
        it('is correctly detected in first argument position', async () => {
            expect(await bMath.bmin(minValue, maxValue)).to.be.bignumber.equal(minValue);
        });

        it('is correctly detected in second argument position', async () => {
            expect(await bMath.bmin(maxValue, minValue)).to.be.bignumber.equal(minValue);
        });
    });

    describe('average', async () => {
        function bnAverage(a, b) {
            return a.add(b).divn(2);
        }

        it('is correctly calculated with two odd numbers', async () => {
            const a = new BN('57417');
            const b = new BN('95431');

            expect(await bMath.baverage(a, b)).to.be.bignumber.equal(bnAverage(a, b));
        });

        it('is correctly calculated with two even numbers', async () => {
            const a = new BN('42304');
            const b = new BN('84346');

            expect(await bMath.baverage(a, b)).to.be.bignumber.equal(bnAverage(a, b));
        });

        it('is correctly calculated with one even and one odd number', async () => {
            const a = new BN('57417');
            const b = new BN('84346');

            expect(await bMath.baverage(a, b)).to.be.bignumber.equal(bnAverage(a, b));
        });
    });

    describe('Exact math', async () => {
        async function testCommutative(fn, lhs, rhs, expected) {
            expect(await fn(lhs, rhs)).to.be.bignumber.equal(expected);
            expect(await fn(rhs, lhs)).to.be.bignumber.equal(expected);
        }

        async function testFailsCommutative(fn, lhs, rhs, reason) {
            await expectRevert(fn(lhs, rhs), reason);
            await expectRevert(fn(rhs, lhs), reason);
        }

        describe('add', async () => {
            it('adds correctly', async () => {
                const a = new BN('5678');
                const b = new BN('1234');

                await testCommutative(bMath.badd, a, b, a.add(b));
            });

            it('reverts on addition overflow', async () => {
                const a = MAX_UINT256;
                const b = new BN('1');

                await testFailsCommutative(bMath.badd, a, b, 'ERR_ADD_OVERFLOW');
            });
        });

        describe('sub', async () => {
            it('subtracts correctly', async () => {
                const a = new BN('5678');
                const b = new BN('1234');

                expect(await bMath.bsub(a, b)).to.be.bignumber.equal(a.sub(b));
            });

            it('reverts if subtraction result would be negative', async () => {
                const a = new BN('1234');
                const b = new BN('5678');

                await expectRevert(bMath.bsub(a, b), 'ERR_SUB_UNDERFLOW');
            });
        });

        describe('mul', async () => {
            // This should return 0, because everything is normalized to 1 = 10**18
            // So 1234 * 5678 is actually 1234*10-18 * 5678*10-18 = 7,006,652 * 10**-36 = 0
            it('multiplies correctly', async () => {
                const a = new BN('1234');
                const b = new BN('5678');

                await testCommutative(bMath.bmul, a, b, '0');
            });

            it('multiplies correctly', async () => {
                const a = new BN('1234');
                const b = new BN('5678');

                await testCommutative(bMath.bmul, toWei(a), toWei(b), toWei(a.mul(b)));
            });

            it('multiplies by zero correctly', async () => {
                const a = new BN('0');
                const b = new BN('5678');

                await testCommutative(bMath.bmul, a, b, '0');
            });

            it('reverts on multiplication overflow', async () => {
                const a = MAX_UINT256;
                const b = new BN('2');

                await testFailsCommutative(bMath.bmul, a, b, 'ERR_MUL_OVERFLOW');
            });
        });

        describe('div', async () => {
            it('divides correctly', async () => {
                const a = new BN('5678');
                const b = new BN('5678');

                // Since we are in the "realm" of 10**18,
                //   this returns '1' as Wei, not a.div(b) (regular "1")
                expect(await bMath.bdiv(a, b)).to.be.bignumber.equal(toWei(a.div(b)));
            });

            it('divides zero correctly', async () => {
                const a = new BN('0');
                const b = new BN('5678');

                expect(await bMath.bdiv(a, b)).to.be.bignumber.equal('0');
            });

            // This should not return 1; everything is in the realm of 10**18
            it('returns fractional result on non-even division << 10 ** 18', async () => {
                const a = new BN('7000');
                const b = new BN('5678');
                const result = await bMath.bdiv(a, b);
                const expected = toWei(parseFloat(a / b).toString());
                const diff = expected - result;

                assert.isAtMost(diff, errorDelta);
            });

            it('reverts on division by zero', async () => {
                const a = new BN('5678');
                const b = new BN('0');

                await expectRevert(bMath.bdiv(a, b), 'ERR_DIV_ZERO');
            });
        });

        describe('mod', async () => {
            describe('modulos correctly', async () => {
                it('when the dividend is smaller than the divisor', async () => {
                    const a = new BN('284');
                    const b = new BN('5678');

                    expect(await bMath.bmod(a, b)).to.be.bignumber.equal(a.mod(b));
                });

                it('when the dividend is equal to the divisor', async () => {
                    const a = new BN('5678');
                    const b = new BN('5678');

                    expect(await bMath.bmod(a, b)).to.be.bignumber.equal(a.mod(b));
                });

                it('when the dividend is larger than the divisor', async () => {
                    const a = new BN('7000');
                    const b = new BN('5678');

                    expect(await bMath.bmod(a, b)).to.be.bignumber.equal(a.mod(b));
                });

                it('when the dividend is a multiple of the divisor', async () => {
                    const a = new BN('17034'); // 17034 == 5678 * 3
                    const b = new BN('5678');

                    expect(await bMath.bmod(a, b)).to.be.bignumber.equal(a.mod(b));
                });
            });

            it('reverts with a 0 divisor', async () => {
                const a = new BN('5678');
                const b = new BN('0');

                await expectRevert(bMath.bmod(a, b), 'ERR_MODULO_BY_ZERO');
            });
        });
    });
});
