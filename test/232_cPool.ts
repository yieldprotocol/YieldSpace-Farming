import { artifacts, contract, web3 } from "hardhat";

const CPool = artifacts.require('CPool')
const CDai = artifacts.require('CDaiMock')
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

contract('CPool', async (accounts) => {
  let [owner, user1, user2, operator, from, to] = accounts

  // These values impact the pool results
  const cDaiTokens = new BN('1000000000000000000000000')
  const fyDaiTokens = cDaiTokens
  const initialDai = cDaiTokens

  let snapshot: any
  let snapshotId: string

  let pool: Contract
  let fyDai1: Contract
  let cDai: Contract

  let maturity1: number

  before(async () => {
    const yieldMathLibrary = await VariableYieldMath.new()
    await CPool.link(yieldMathLibrary)
  })

  beforeEach(async () => {
    snapshot = await helper.takeSnapshot()
    snapshotId = snapshot['result']

    // Setup fyDai
    maturity1 = await currentTimestamp() + 31556952 // One year
    fyDai1 = await FYDai.new(maturity1)

    // Setup cDai
    cDai = await CDai.new()
    await cDai.setExchangeRate('2000000000000000000000000000') // c0 = 2.0

    // Setup Pool
    pool = await CPool.new(cDai.address, fyDai1.address, 'Name', 'Symbol', { from: owner })

    await cDai.setExchangeRate('3000000000000000000000000000') // exchangeRate = 3.0
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
    await cDai.mintCDai(user1, initialDai)

    await cDai.approve(pool.address, initialDai, { from: user1 })
    const tx = await pool.mint(user1, user1, initialDai, { from: user1 })
    const event = tx.logs[tx.logs.length - 1]

    assert.equal(event.event, 'Liquidity')
    assert.equal(event.args.from, user1)
    assert.equal(event.args.to, user1)
    assert.equal(event.args.cDaiTokens.toString(), initialDai.mul(new BN('-1')).toString())
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
      await cDai.mintCDai(user1, initialDai)

      await cDai.approve(pool.address, initialDai, { from: user1 })
      await pool.mint(user1, user1, initialDai, { from: user1 })
    })

    it('sells fyDai', async () => {
      const cDaiReserves = await pool.getCDaiReserves()
      const fyDaiReserves = await pool.getFYDaiReserves()
      const fyDaiIn = new BN(toWad(1).toString())
      const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
      const timeTillMaturity = new BN(maturity1).sub(now)

      assert.equal(
        await cDai.balanceOf(to),
        0,
        "'To' wallet should have no cDai, instead has " + (await cDai.balanceOf(to))
      )

      // Test preview since we are here
      const cDaiOutPreview = await pool.sellFYDaiPreview(fyDaiIn, { from: operator })

      const expectedCDaiOut = sellFYDaiNormalized(
        cDaiReserves.toString(),
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
      assert.equal(event.args.cDaiTokens, (await cDai.balanceOf(to)).toString())
      assert.equal(event.args.fyDaiTokens, fyDaiIn.mul(new BN('-1')).toString())

      assert.equal(await fyDai1.balanceOf(from), 0, "'From' wallet should have no fyDai tokens")

      const cDaiOut = await cDai.balanceOf(to)

      almostEqual(cDaiOut, floor(expectedCDaiOut).toFixed(), fyDaiIn.div(new BN('1000000')))
      almostEqual(cDaiOutPreview, floor(expectedCDaiOut).toFixed(), fyDaiIn.div(new BN('1000000')))
    })

    it('buys cDai', async () => {
      const cDaiReserves = await pool.getCDaiReserves()
      const fyDaiReserves = await pool.getFYDaiReserves()
      const cDaiOut = new BN(toWad(1).toString())
      const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
      const timeTillMaturity = new BN(maturity1).sub(now)

      await fyDai1.mint(from, fyDaiTokens, { from: owner })

      assert.equal(
        await fyDai1.balanceOf(from),
        fyDaiTokens.toString(),
        "'From' wallet should have " + fyDaiTokens + ' fyDai, instead has ' + (await fyDai1.balanceOf(from))
      )

      // Test preview since we are here
      const fyDaiInPreview = await pool.buyCDaiPreview(cDaiOut, { from: operator })

      const expectedFYDaiIn = buyVYDaiNormalized(
        cDaiReserves.toString(),
        fyDaiReserves.toString(),
        cDaiOut.toString(),
        timeTillMaturity.toString(),
        '2.0',
        '3.0'
      )

      await pool.addDelegate(operator, { from: from })
      await fyDai1.approve(pool.address, fyDaiTokens, { from: from })
      const tx = await pool.buyCDai(from, to, cDaiOut, { from: operator })
      const event = tx.logs[tx.logs.length - 1]

      const fyDaiIn = fyDaiTokens.sub(await fyDai1.balanceOf(from))

      assert.equal(event.event, 'Trade')
      assert.equal(event.args.from, from)
      assert.equal(event.args.to, to)
      assert.equal(event.args.cDaiTokens, cDaiOut.toString())
      assert.equal(event.args.fyDaiTokens, fyDaiIn.mul(new BN('-1')).toString())

      assert.equal(await cDai.balanceOf(to), cDaiOut.toString(), 'Receiver account should have 1 dai token')

      almostEqual(fyDaiIn, floor(expectedFYDaiIn).toFixed(), cDaiOut.div(new BN('1000000')))
      almostEqual(fyDaiInPreview, floor(expectedFYDaiIn).toFixed(), cDaiOut.div(new BN('1000000')))
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
        const cDaiReserves = await cDai.balanceOf(pool.address)
        const fyDaiReserves = await fyDai1.balanceOf(pool.address)
        const supply = await pool.totalSupply()
        const cDaiIn = new BN(toWad(1).toString())

        await cDai.mintCDai(user1, cDaiIn, { from: owner })
        await fyDai1.mint(user1, fyDaiTokens, { from: owner })

        const fyDaiBefore = await fyDai1.balanceOf(user1)
        const poolTokensBefore = await pool.balanceOf(user2)

        await cDai.approve(pool.address, oneToken, { from: user1 })
        await fyDai1.approve(pool.address, fyDaiTokens, { from: user1 })
        const tx = await pool.mint(user1, user2, oneToken, { from: user1 })
        const event = tx.logs[tx.logs.length - 1]

        const [expectedMinted, expectedFYDaiIn] = mint(
          cDaiReserves.toString(),
          fyDaiReserves.toString(),
          supply.toString(),
          cDaiIn.toString()
        )

        const minted = (await pool.balanceOf(user2)).sub(poolTokensBefore)
        const fyDaiIn = fyDaiBefore.sub(await fyDai1.balanceOf(user1))

        assert.equal(event.event, 'Liquidity')
        assert.equal(event.args.from, user1)
        assert.equal(event.args.to, user2)
        assert.equal(event.args.cDaiTokens, oneToken.mul(-1).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.poolTokens, minted.toString())

        almostEqual(minted, floor(expectedMinted).toFixed(), cDaiIn.div(new BN('10000')))
        almostEqual(fyDaiIn, floor(expectedFYDaiIn).toFixed(), cDaiIn.div(new BN('10000')))
      })

      it('burns liquidity tokens', async () => {
        // Use this to test: https://www.desmos.com/calculator/ubsalzunpo

        const cDaiReserves = await cDai.balanceOf(pool.address)
        const fyDaiReserves = await fyDai1.balanceOf(pool.address)
        const supply = await pool.totalSupply()
        const lpTokensIn = new BN(toWad(1).toString())

        await pool.approve(pool.address, lpTokensIn, { from: user1 })
        const tx = await pool.burn(user1, user2, lpTokensIn, { from: user1 })
        const event = tx.logs[tx.logs.length - 1]

        const [expectedCDaiOut, expectedFYDaiOut] = mint(
          cDaiReserves.toString(),
          fyDaiReserves.toString(),
          supply.toString(),
          lpTokensIn.toString()
        )

        const cDaiOut = cDaiReserves.sub(await cDai.balanceOf(pool.address))
        const fyDaiOut = fyDaiReserves.sub(await fyDai1.balanceOf(pool.address))

        assert.equal(event.event, 'Liquidity')
        assert.equal(event.args.from, user1)
        assert.equal(event.args.to, user2)
        assert.equal(event.args.poolTokens, lpTokensIn.mul(new BN('-1')).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())
        assert.equal(event.args.cDaiTokens, cDaiOut.toString())

        almostEqual(cDaiOut, floor(expectedCDaiOut).toFixed(), lpTokensIn.div(new BN('10000')))
        almostEqual(fyDaiOut, floor(expectedFYDaiOut).toFixed(), lpTokensIn.div(new BN('10000')))
      })

      it('sells cDai', async () => {
        const cDaiReserves = await pool.getCDaiReserves()
        const fyDaiReserves = await pool.getFYDaiReserves()
        const cDaiIn = new BN(toWad(1).toString())
        const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
        const timeTillMaturity = new BN(maturity1).sub(now)

        assert.equal(
          await fyDai1.balanceOf(to),
          0,
          "'To' wallet should have no fyDai, instead has " + (await fyDai1.balanceOf(operator))
        )

        // Test preview since we are here
        const fyDaiOutPreview = await pool.sellCDaiPreview(cDaiIn, { from: operator })

        const expectedFYDaiOut = sellVYDaiNormalized(
          cDaiReserves.toString(),
          fyDaiReserves.toString(),
          cDaiIn.toString(),
          timeTillMaturity.toString(),
          '2.0',
          '3.0'
        )

        await pool.addDelegate(operator, { from: from })
        await cDai.mintCDai(from, cDaiIn)
        await cDai.approve(pool.address, cDaiIn, { from: from })
        const tx = await pool.sellCDai(from, to, cDaiIn, { from: operator })
        const event = tx.logs[tx.logs.length - 1]

        const fyDaiOut = await fyDai1.balanceOf(to)

        assert.equal(event.event, 'Trade')
        assert.equal(event.args.from, from)
        assert.equal(event.args.to, to)
        assert.equal(event.args.cDaiTokens, cDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())

        assert.equal(await cDai.balanceOf(from), 0, "'From' wallet should have no cDai tokens")

        almostEqual(fyDaiOut, floor(expectedFYDaiOut).toFixed(), cDaiIn.div(new BN('1000000')))
        almostEqual(fyDaiOutPreview, floor(expectedFYDaiOut).toFixed(), cDaiIn.div(new BN('1000000')))
      })

      it('buys fyDai', async () => {
        const cDaiReserves = await pool.getCDaiReserves()
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
        const cDaiInPreview = await pool.buyFYDaiPreview(fyDaiOut, { from: operator })

        const expectedCDaiIn = buyFYDaiNormalized(
          cDaiReserves.toString(),
          fyDaiReserves.toString(),
          fyDaiOut.toString(),
          timeTillMaturity.toString(),
          '2.0',
          '3.0'
        )

        await pool.addDelegate(operator, { from: from })
        await cDai.mintCDai(from, cDaiTokens)
        await cDai.approve(pool.address, cDaiTokens, { from: from })
        const tx = await pool.buyFYDai(from, to, fyDaiOut, { from: operator })
        const event = tx.logs[tx.logs.length - 1]

        const cDaiIn = cDaiTokens.sub(await cDai.balanceOf(from))

        assert.equal(event.event, 'Trade')
        assert.equal(event.args.from, from)
        assert.equal(event.args.to, to)
        assert.equal(event.args.cDaiTokens, cDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())

        assert.equal(await fyDai1.balanceOf(to), fyDaiOut.toString(), "'To' wallet should have 1 fyDai token")

        almostEqual(cDaiIn, floor(expectedCDaiIn).toFixed(), cDaiIn.div(new BN('1000000')))
        almostEqual(cDaiInPreview, floor(expectedCDaiIn).toFixed(), cDaiIn.div(new BN('1000000')))
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

        await expectRevert(pool.sellCDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.sellCDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.buyCDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.buyCDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.sellFYDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.sellFYDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.buyFYDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.buyFYDai(from, to, oneToken, { from: from }), 'Pool: Too late')
      })
    })
  })
})
