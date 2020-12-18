import { artifacts, contract, web3 } from "hardhat";

const VYPool = artifacts.require('VYPool')
const VYDai = artifacts.require('VYDaiMock')
const FYDai = artifacts.require('FYDaiMock')
const VariableYieldMath = artifacts.require('VariableYieldMath')

const { bignumber, floor, multiply } = require('mathjs')
import { keccak256, toUtf8Bytes } from 'ethers/lib/utils'
import * as helper from 'ganache-time-traveler'
import { toWad, toRay, mulRay } from './shared/utils'
import {
  mint,
  burn,
  sellVYDaiNormalized,
  sellFYDaiNormalized,
  buyVYDaiNormalized,
  buyFYDaiNormalized,
} from './shared/yieldspace'
// @ts-ignore
import { BN, expectRevert } from '@openzeppelin/test-helpers'
import { assert, expect } from 'chai'
import { Contract } from './shared/fixtures'

const ONE64 = new BN('18446744073709551616') // In 64.64 format

function toBigNumber(x: any) {
  if (typeof x == 'object') x = x.toString()
  if (typeof x == 'number') return new BN(x)
  else if (typeof x == 'string') {
    if (x.startsWith('0x') || x.startsWith('0X')) return new BN(x.substring(2), 16)
    else return new BN(x)
  }
}

function almostEqual(x: any, y: any, p: any) {
  // Check that abs(x - y) < p:
  const xb = toBigNumber(x)
  const yb = toBigNumber(y)
  const pb = toBigNumber(p)
  const diff = xb.gt(yb) ? xb.sub(yb) : yb.sub(xb)
  expect(diff).to.be.bignumber.lt(pb)
}

async function currentTimestamp() {
  const block = await web3.eth.getBlockNumber()
  return parseInt((await web3.eth.getBlock(block)).timestamp.toString())
}

contract('VYPool', async (accounts) => {
  let [owner, user1, user2, operator, from, to] = accounts

  // These values impact the pool results
  const vyDaiTokens = new BN('1000000000000000000000000')
  const fyDaiTokens = vyDaiTokens
  const initialDai = vyDaiTokens

  let snapshot: any
  let snapshotId: string

  let pool: Contract
  let fyDai1: Contract
  let vyDai: Contract

  let maturity1: number

  before(async () => {
    const yieldMathLibrary = await VariableYieldMath.new()
    await VYPool.link(yieldMathLibrary)
  })

  beforeEach(async () => {
    snapshot = await helper.takeSnapshot()
    snapshotId = snapshot['result']

    // Setup fyDai
    maturity1 = await currentTimestamp() + 31556952 // One year
    fyDai1 = await FYDai.new(maturity1)

    // Setup vyDai
    vyDai = await VYDai.new('2000000000000000000000000000') // exchangeRate = 2.0

    // Setup Pool
    pool = await VYPool.new(vyDai.address, fyDai1.address, 'Name', 'Symbol', { from: owner })

    await vyDai.setExchangeRate('3000000000000000000000000000') // exchangeRate = 3.0
  })

  afterEach(async () => {
    await helper.revertToSnapshot(snapshotId)
  })

  it('should setup pool', async () => {
    const b = new BN('18446744073709551615')
    const k = b.div(new BN('126144000'))
    expect(await pool.k()).to.be.bignumber.equal(k)

    const g1 = new BN('950').mul(b).div(new BN('1000')).add(new BN(1)) // Sell Dai to the pool
    const g2 = new BN('1000').mul(b).div(new BN('950')).add(new BN(1)) // Sell fyDai to the pool
  })

  it('adds initial liquidity', async () => {
    await vyDai.mint(user1, initialDai)

    await vyDai.approve(pool.address, initialDai, { from: user1 })
    const tx = await pool.mint(user1, user1, initialDai, { from: user1 })
    const event = tx.logs[tx.logs.length - 1]

    assert.equal(event.event, 'Liquidity')
    assert.equal(event.args.from, user1)
    assert.equal(event.args.to, user1)
    assert.equal(event.args.vyDaiTokens.toString(), initialDai.mul(new BN('-1')).toString())
    assert.equal(event.args.fyDaiTokens.toString(), 0)
    assert.equal(event.args.poolTokens.toString(), initialDai.toString())

    assert.equal(
      await pool.balanceOf(user1),
      initialDai.toString(),
      'User1 should have ' + initialDai + ' liquidity tokens'
    )
  })

  describe('with initial liquidity', () => {
    beforeEach(async () => {
      await vyDai.mint(user1, initialDai)

      await vyDai.approve(pool.address, initialDai, { from: user1 })
      await pool.mint(user1, user1, initialDai, { from: user1 })
    })

    it('sells fyDai', async () => {
      const vyDaiReserves = await pool.getVYDaiReserves()
      const fyDaiReserves = await pool.getFYDaiReserves()
      const fyDaiIn = new BN(toWad(1).toString())
      const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
      const timeTillMaturity = new BN(maturity1).sub(now)

      assert.equal(
        await vyDai.balanceOf(to),
        0,
        "'To' wallet should have no vyDai, instead has " + (await vyDai.balanceOf(to))
      )

      // Test preview since we are here
      const vyDaiOutPreview = await pool.sellFYDaiPreview(fyDaiIn, { from: operator })

      const expectedVYDaiOut = sellFYDaiNormalized(
        vyDaiReserves.toString(),
        fyDaiReserves.toString(),
        fyDaiIn.toString(),
        timeTillMaturity.toString(),
        '2.0',
        '3.0'
      )

      await pool.addDelegate(operator, { from: from })
      await fyDai1.mint(from, fyDaiIn, { from: owner })
      await fyDai1.approve(pool.address, fyDaiIn, { from: from })
      const tx = await pool.sellFYDai(from, to, fyDaiIn, { from: operator })
      const event = tx.logs[tx.logs.length - 1]

      assert.equal(event.event, 'Trade')
      assert.equal(event.args.from, from)
      assert.equal(event.args.to, to)
      assert.equal(event.args.vyDaiTokens, (await vyDai.balanceOf(to)).toString())
      assert.equal(event.args.fyDaiTokens, fyDaiIn.mul(new BN('-1')).toString())

      assert.equal(await fyDai1.balanceOf(from), 0, "'From' wallet should have no fyDai tokens")

      const vyDaiOut = await vyDai.balanceOf(to)

      almostEqual(vyDaiOut, floor(expectedVYDaiOut).toFixed(), fyDaiIn.div(new BN('1000000')))
      almostEqual(vyDaiOutPreview, floor(expectedVYDaiOut).toFixed(), fyDaiIn.div(new BN('1000000')))
    })

    it('buys vyDai', async () => {
      const vyDaiReserves = await pool.getVYDaiReserves()
      const fyDaiReserves = await pool.getFYDaiReserves()
      const vyDaiOut = new BN(toWad(1).toString())
      const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
      const timeTillMaturity = new BN(maturity1).sub(now)

      await fyDai1.mint(from, fyDaiTokens, { from: owner })

      assert.equal(
        await fyDai1.balanceOf(from),
        fyDaiTokens.toString(),
        "'From' wallet should have " + fyDaiTokens + ' fyDai, instead has ' + (await fyDai1.balanceOf(from))
      )

      // Test preview since we are here
      const fyDaiInPreview = await pool.buyVYDaiPreview(vyDaiOut, { from: operator })

      const expectedFYDaiIn = buyVYDaiNormalized(
        vyDaiReserves.toString(),
        fyDaiReserves.toString(),
        vyDaiOut.toString(),
        timeTillMaturity.toString(),
        '2.0',
        '3.0'
      )

      await pool.addDelegate(operator, { from: from })
      await fyDai1.approve(pool.address, fyDaiTokens, { from: from })
      const tx = await pool.buyVYDai(from, to, vyDaiOut, { from: operator })
      const event = tx.logs[tx.logs.length - 1]

      const fyDaiIn = fyDaiTokens.sub(await fyDai1.balanceOf(from))

      assert.equal(event.event, 'Trade')
      assert.equal(event.args.from, from)
      assert.equal(event.args.to, to)
      assert.equal(event.args.vyDaiTokens, vyDaiOut.toString())
      assert.equal(event.args.fyDaiTokens, fyDaiIn.mul(new BN('-1')).toString())

      assert.equal(await vyDai.balanceOf(to), vyDaiOut.toString(), 'Receiver account should have 1 dai token')

      almostEqual(fyDaiIn, floor(expectedFYDaiIn).toFixed(), vyDaiOut.div(new BN('1000000')))
      almostEqual(fyDaiInPreview, floor(expectedFYDaiIn).toFixed(), vyDaiOut.div(new BN('1000000')))
    })

    describe('with extra fyDai reserves', () => {
      beforeEach(async () => {
        const additionalFYDaiReserves = toWad(34.4)
        await fyDai1.mint(operator, additionalFYDaiReserves, { from: owner })
        await fyDai1.approve(pool.address, additionalFYDaiReserves, { from: operator })
        await pool.sellFYDai(operator, operator, additionalFYDaiReserves, { from: operator })
      })

      it('mints liquidity tokens', async () => {
        const oneToken = toWad(1)
        const vyDaiReserves = await vyDai.balanceOf(pool.address)
        const fyDaiReserves = await fyDai1.balanceOf(pool.address)
        const supply = await pool.totalSupply()
        const vyDaiIn = new BN(toWad(1).toString())

        await vyDai.mint(user1, vyDaiIn, { from: owner })
        await fyDai1.mint(user1, fyDaiTokens, { from: owner })

        const fyDaiBefore = await fyDai1.balanceOf(user1)
        const poolTokensBefore = await pool.balanceOf(user2)

        await vyDai.approve(pool.address, oneToken, { from: user1 })
        await fyDai1.approve(pool.address, fyDaiTokens, { from: user1 })
        const tx = await pool.mint(user1, user2, oneToken, { from: user1 })
        const event = tx.logs[tx.logs.length - 1]

        const [expectedMinted, expectedFYDaiIn] = mint(
          vyDaiReserves.toString(),
          fyDaiReserves.toString(),
          supply.toString(),
          vyDaiIn.toString()
        )

        const minted = (await pool.balanceOf(user2)).sub(poolTokensBefore)
        const fyDaiIn = fyDaiBefore.sub(await fyDai1.balanceOf(user1))

        assert.equal(event.event, 'Liquidity')
        assert.equal(event.args.from, user1)
        assert.equal(event.args.to, user2)
        assert.equal(event.args.vyDaiTokens, oneToken.mul(-1).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.poolTokens, minted.toString())

        almostEqual(minted, floor(expectedMinted).toFixed(), vyDaiIn.div(new BN('10000')))
        almostEqual(fyDaiIn, floor(expectedFYDaiIn).toFixed(), vyDaiIn.div(new BN('10000')))
      })

      it('burns liquidity tokens', async () => {
        // Use this to test: https://www.desmos.com/calculator/ubsalzunpo

        const vyDaiReserves = await vyDai.balanceOf(pool.address)
        const fyDaiReserves = await fyDai1.balanceOf(pool.address)
        const supply = await pool.totalSupply()
        const lpTokensIn = new BN(toWad(1).toString())

        await pool.approve(pool.address, lpTokensIn, { from: user1 })
        const tx = await pool.burn(user1, user2, lpTokensIn, { from: user1 })
        const event = tx.logs[tx.logs.length - 1]

        const [expectedVYDaiOut, expectedFYDaiOut] = mint(
          vyDaiReserves.toString(),
          fyDaiReserves.toString(),
          supply.toString(),
          lpTokensIn.toString()
        )

        const vyDaiOut = vyDaiReserves.sub(await vyDai.balanceOf(pool.address))
        const fyDaiOut = fyDaiReserves.sub(await fyDai1.balanceOf(pool.address))

        assert.equal(event.event, 'Liquidity')
        assert.equal(event.args.from, user1)
        assert.equal(event.args.to, user2)
        assert.equal(event.args.poolTokens, lpTokensIn.mul(new BN('-1')).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())
        assert.equal(event.args.vyDaiTokens, vyDaiOut.toString())

        almostEqual(vyDaiOut, floor(expectedVYDaiOut).toFixed(), lpTokensIn.div(new BN('10000')))
        almostEqual(fyDaiOut, floor(expectedFYDaiOut).toFixed(), lpTokensIn.div(new BN('10000')))
      })

      it('sells vyDai', async () => {
        const vyDaiReserves = await pool.getVYDaiReserves()
        const fyDaiReserves = await pool.getFYDaiReserves()
        const vyDaiIn = new BN(toWad(1).toString())
        const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
        const timeTillMaturity = new BN(maturity1).sub(now)

        assert.equal(
          await fyDai1.balanceOf(to),
          0,
          "'To' wallet should have no fyDai, instead has " + (await fyDai1.balanceOf(operator))
        )

        // Test preview since we are here
        const fyDaiOutPreview = await pool.sellVYDaiPreview(vyDaiIn, { from: operator })

        const expectedFYDaiOut = sellVYDaiNormalized(
          vyDaiReserves.toString(),
          fyDaiReserves.toString(),
          vyDaiIn.toString(),
          timeTillMaturity.toString(),
          '2.0',
          '3.0'
        )

        await pool.addDelegate(operator, { from: from })
        await vyDai.mint(from, vyDaiIn)
        await vyDai.approve(pool.address, vyDaiIn, { from: from })
        const tx = await pool.sellVYDai(from, to, vyDaiIn, { from: operator })
        const event = tx.logs[tx.logs.length - 1]

        const fyDaiOut = await fyDai1.balanceOf(to)

        assert.equal(event.event, 'Trade')
        assert.equal(event.args.from, from)
        assert.equal(event.args.to, to)
        assert.equal(event.args.vyDaiTokens, vyDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())

        assert.equal(await vyDai.balanceOf(from), 0, "'From' wallet should have no vyDai tokens")

        almostEqual(fyDaiOut, floor(expectedFYDaiOut).toFixed(), vyDaiIn.div(new BN('1000000')))
        almostEqual(fyDaiOutPreview, floor(expectedFYDaiOut).toFixed(), vyDaiIn.div(new BN('1000000')))
      })

      it('buys fyDai', async () => {
        const vyDaiReserves = await pool.getVYDaiReserves()
        const fyDaiReserves = await pool.getFYDaiReserves()
        const fyDaiOut = new BN(toWad(1).toString())
        const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
        const timeTillMaturity = new BN(maturity1).sub(now)

        assert.equal(
          await fyDai1.balanceOf(to),
          0,
          "'To' wallet should have no fyDai, instead has " + (await fyDai1.balanceOf(to))
        )

        // Test preview since we are here
        const vyDaiInPreview = await pool.buyFYDaiPreview(fyDaiOut, { from: operator })

        const expectedVYDaiIn = buyFYDaiNormalized(
          vyDaiReserves.toString(),
          fyDaiReserves.toString(),
          fyDaiOut.toString(),
          timeTillMaturity.toString(),
          '2.0',
          '3.0'
        )

        await pool.addDelegate(operator, { from: from })
        await vyDai.mint(from, vyDaiTokens)
        await vyDai.approve(pool.address, vyDaiTokens, { from: from })
        const tx = await pool.buyFYDai(from, to, fyDaiOut, { from: operator })
        const event = tx.logs[tx.logs.length - 1]

        const vyDaiIn = vyDaiTokens.sub(await vyDai.balanceOf(from))

        assert.equal(event.event, 'Trade')
        assert.equal(event.args.from, from)
        assert.equal(event.args.to, to)
        assert.equal(event.args.vyDaiTokens, vyDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())

        assert.equal(await fyDai1.balanceOf(to), fyDaiOut.toString(), "'To' wallet should have 1 fyDai token")

        almostEqual(vyDaiIn, floor(expectedVYDaiIn).toFixed(), vyDaiIn.div(new BN('1000000')))
        almostEqual(vyDaiInPreview, floor(expectedVYDaiIn).toFixed(), vyDaiIn.div(new BN('1000000')))
      })
    })

    describe('once mature', () => {
      beforeEach(async () => {
        await helper.advanceTime(31556952)
        await helper.advanceBlock()
        // await fyDai1.mature(); // It doesn't matter if the fyDai is marked as mature
      })

      it("doesn't allow trading", async () => {
        const oneToken = toWad(1)

        await expectRevert(pool.sellVYDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.sellVYDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.buyVYDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.buyVYDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.sellFYDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.sellFYDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.buyFYDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.buyFYDai(from, to, oneToken, { from: from }), 'Pool: Too late')
      })
    })
  })
})
