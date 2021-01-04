import { artifacts, contract, web3 } from 'hardhat'

const Pool = artifacts.require('Pool')
const Dai = artifacts.require('DaiMock')
const CDai = artifacts.require('CDaiMock')
const FYDai = artifacts.require('FYDaiMock')
const YieldMath = artifacts.require('YieldMath')
const ComptrollerMock = artifacts.require('ComptrollerMock')
const UniswapV2RouterMock = artifacts.require('UniswapV2RouterMock')

const { floor } = require('mathjs')
import * as helper from 'ganache-time-traveler'
import { toWad, toRay, mulRay, divRay } from './shared/utils'
import { mint, burn, sellVYDai, sellFYDai, buyVYDai, buyFYDai } from './shared/yieldspace'
// @ts-ignore
import { BN, expectRevert } from '@openzeppelin/test-helpers'
import { assert, expect } from 'chai'
import { Contract } from './shared/fixtures'

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

contract('Pool', async (accounts) => {
  let [owner, user1, user2, operator, from, to] = accounts

  // These values impact the pool results
  const daiTokens = new BN('1000000000000000000000000')
  const fyDaiTokens = daiTokens
  const initialDai = daiTokens

  let snapshot: any
  let snapshotId: string

  let pool: Contract
  let comptroller: Contract
  let uniswapRouter: Contract
  let dai: Contract
  let cDai: Contract
  let fyDai1: Contract
  let maturity1: number

  before(async () => {
    const yieldMathLibrary = await YieldMath.new()
    await Pool.link(yieldMathLibrary)
  })

  beforeEach(async () => {
    snapshot = await helper.takeSnapshot()
    snapshotId = snapshot['result']

    // Setup fyDai
    maturity1 = (await currentTimestamp()) + 31556952 // One year
    fyDai1 = await FYDai.new(maturity1)

    // Setup dai
    dai = await Dai.new()

    // Setup cDai
    cDai = await CDai.new(dai.address)

    // Set Comptroller
    comptroller = await ComptrollerMock.new()

    // Set Uniswap Router
    uniswapRouter = await UniswapV2RouterMock.new()

    // Setup Pool
    pool = await Pool.new(cDai.address, fyDai1.address, comptroller.address, uniswapRouter.address, 'Name', 'Symbol', {
      from: owner,
    })

    await cDai.setExchangeRate(toRay(3)) // exchangeRate = 3.0
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
    await dai.mint(user1, initialDai)

    await dai.approve(pool.address, initialDai, { from: user1 })
    const tx = await pool.mint(user1, user1, initialDai, { from: user1 })
    const event = tx.logs[tx.logs.length - 1]

    assert.equal(event.event, 'Liquidity')
    assert.equal(event.args.from, user1)
    assert.equal(event.args.to, user1)
    assert.equal(event.args.daiTokens.toString(), initialDai.neg().toString())
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
      await dai.mint(user1, initialDai)
      await dai.approve(pool.address, initialDai, { from: user1 })
      await pool.mint(user1, user1, initialDai, { from: user1 })
    })

    it('sells fyDai', async () => {
      const daiReserves = await pool.getDaiReserves()
      const fyDaiReserves = await pool.getFYDaiReserves()
      const fyDaiIn = toWad(1)
      const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
      const timeTillMaturity = new BN(maturity1).sub(now)

      assert.equal(
        await dai.balanceOf(to),
        0,
        "'To' wallet should have no dai, instead has " + (await dai.balanceOf(to))
      )

      // Test preview since we are here
      const daiOutPreview = await pool.sellFYDaiPreview(fyDaiIn, { from: operator })

      const expectedDaiOut = sellFYDai(
        daiReserves.toString(),
        fyDaiReserves.toString(),
        fyDaiIn.toString(),
        timeTillMaturity.toString(),
        1.0
      )

      await pool.addDelegate(operator, { from: from })
      await fyDai1.mint(from, fyDaiIn, { from: owner })
      await fyDai1.approve(pool.address, fyDaiIn, { from: from })
      const tx = await pool.sellFYDai(from, to, fyDaiIn, { from: operator })
      const event = tx.logs[tx.logs.length - 1]

      assert.equal(event.event, 'Trade')
      assert.equal(event.args.from, from)
      assert.equal(event.args.to, to)
      assert.equal(event.args.daiTokens, (await dai.balanceOf(to)).toString())
      assert.equal(event.args.fyDaiTokens, fyDaiIn.neg().toString())

      assert.equal(await fyDai1.balanceOf(from), 0, "'From' wallet should have no fyDai tokens")

      const daiOut = await dai.balanceOf(to)

      almostEqual(daiOut, floor(expectedDaiOut).toFixed(), fyDaiIn.divn(1000000))
      almostEqual(daiOutPreview, floor(expectedDaiOut).toFixed(), fyDaiIn.divn(1000000))
    })

    it('buys dai', async () => {
      const daiReserves = await pool.getDaiReserves()
      const fyDaiReserves = await pool.getFYDaiReserves()
      const daiOut = toWad(1)
      const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
      const timeTillMaturity = new BN(maturity1).sub(now)

      await fyDai1.mint(from, fyDaiTokens, { from: owner })

      assert.equal(
        await fyDai1.balanceOf(from),
        fyDaiTokens.toString(),
        "'From' wallet should have " + fyDaiTokens + ' fyDai, instead has ' + (await fyDai1.balanceOf(from))
      )

      // Test preview since we are here
      const fyDaiInPreview = await pool.buyDaiPreview(daiOut, { from: operator })

      const expectedFYDaiIn = buyVYDai(
        daiReserves.toString(),
        fyDaiReserves.toString(),
        daiOut.toString(),
        timeTillMaturity.toString(),
        '1.0'
      )

      await pool.addDelegate(operator, { from: from })
      await fyDai1.approve(pool.address, fyDaiTokens, { from: from })
      const tx = await pool.buyDai(from, to, daiOut, { from: operator })
      const event = tx.logs[tx.logs.length - 1]

      const fyDaiIn = fyDaiTokens.sub(await fyDai1.balanceOf(from))

      assert.equal(event.event, 'Trade')
      assert.equal(event.args.from, from)
      assert.equal(event.args.to, to)
      assert.equal(event.args.daiTokens, daiOut.toString())
      assert.equal(event.args.fyDaiTokens, fyDaiIn.neg().toString())

      assert.equal(await dai.balanceOf(to), daiOut.toString(), 'Receiver account should have 1 dai token')

      almostEqual(fyDaiIn, floor(expectedFYDaiIn).toFixed(), daiOut.divn(1000000))
      almostEqual(fyDaiInPreview, floor(expectedFYDaiIn).toFixed(), daiOut.divn(1000000))
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
        const daiReserves = await dai.balanceOf(pool.address)
        const fyDaiReserves = await fyDai1.balanceOf(pool.address)
        const supply = await pool.totalSupply()
        const daiIn = toWad(1)

        await dai.mint(user1, daiIn, { from: owner })
        await fyDai1.mint(user1, fyDaiTokens, { from: owner })

        const fyDaiBefore = await fyDai1.balanceOf(user1)
        const poolTokensBefore = await pool.balanceOf(user2)

        await dai.approve(pool.address, oneToken, { from: user1 })
        await fyDai1.approve(pool.address, fyDaiTokens, { from: user1 })
        const tx = await pool.mint(user1, user2, oneToken, { from: user1 })
        const event = tx.logs[tx.logs.length - 1]

        const [expectedMinted, expectedFYDaiIn] = mint(
          daiReserves.toString(),
          fyDaiReserves.toString(),
          supply.toString(),
          daiIn.toString()
        )

        const minted = (await pool.balanceOf(user2)).sub(poolTokensBefore)
        const fyDaiIn = fyDaiBefore.sub(await fyDai1.balanceOf(user1))

        assert.equal(event.event, 'Liquidity')
        assert.equal(event.args.from, user1)
        assert.equal(event.args.to, user2)
        assert.equal(event.args.daiTokens, oneToken.neg().toString())
        assert.equal(event.args.fyDaiTokens, fyDaiIn.neg().toString())
        assert.equal(event.args.poolTokens, minted.toString())

        almostEqual(minted, floor(expectedMinted).toFixed(), daiIn.div(new BN('10000')))
        almostEqual(fyDaiIn, floor(expectedFYDaiIn).toFixed(), daiIn.div(new BN('10000')))
      })

      it('burns liquidity tokens', async () => {
        // Use this to test: https://www.desmos.com/calculator/ubsalzunpo

        const daiReserves = await dai.balanceOf(pool.address)
        const fyDaiReserves = await fyDai1.balanceOf(pool.address)
        const supply = await pool.totalSupply()
        const lpTokensIn = toWad(1)

        await pool.approve(pool.address, lpTokensIn, { from: user1 })
        const tx = await pool.burn(user1, user2, lpTokensIn, { from: user1 })
        const event = tx.logs[tx.logs.length - 1]

        const [expectedDaiOut, expectedFYDaiOut] = mint(
          daiReserves.toString(),
          fyDaiReserves.toString(),
          supply.toString(),
          lpTokensIn.toString()
        )

        const daiOut = daiReserves.sub(await dai.balanceOf(pool.address))
        const fyDaiOut = fyDaiReserves.sub(await fyDai1.balanceOf(pool.address))

        assert.equal(event.event, 'Liquidity')
        assert.equal(event.args.from, user1)
        assert.equal(event.args.to, user2)
        assert.equal(event.args.poolTokens, lpTokensIn.neg().toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())
        assert.equal(event.args.daiTokens, daiOut.toString())

        almostEqual(daiOut, floor(expectedDaiOut).toFixed(), lpTokensIn.div(new BN('10000')))
        almostEqual(fyDaiOut, floor(expectedFYDaiOut).toFixed(), lpTokensIn.div(new BN('10000')))
      })

      it('sells dai', async () => {
        const daiReserves = await pool.getDaiReserves()
        const fyDaiReserves = await pool.getFYDaiReserves()
        const daiIn = toWad(1)

        const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
        const timeTillMaturity = new BN(maturity1).sub(now)

        assert.equal(
          await fyDai1.balanceOf(to),
          0,
          "'To' wallet should have no fyDai, instead has " + (await fyDai1.balanceOf(operator))
        )

        // Test preview since we are here
        const fyDaiOutPreview = await pool.sellDaiPreview(daiIn, { from: operator })

        const expectedFYDaiOut = sellVYDai(
          daiReserves.toString(),
          fyDaiReserves.toString(),
          daiIn.toString(),
          timeTillMaturity.toString(),
          '1.0'
        )

        await pool.addDelegate(operator, { from: from })
        await dai.mint(from, daiIn)
        await dai.approve(pool.address, daiIn, { from: from })

        const tx = await pool.sellDai(from, to, daiIn, { from: operator })
        const event = tx.logs[tx.logs.length - 4]

        const fyDaiOut = await fyDai1.balanceOf(to)

        assert.equal(event.event, 'Trade')
        assert.equal(event.args.from, from)
        assert.equal(event.args.to, to)
        assert.equal(event.args.daiTokens, daiIn.neg().toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())

        assert.equal(await dai.balanceOf(from), 0, "'From' wallet should have no dai tokens")

        almostEqual(fyDaiOut, floor(expectedFYDaiOut).toFixed(), daiIn.divn(1000000))
        almostEqual(fyDaiOutPreview, floor(expectedFYDaiOut).toFixed(), daiIn.divn(1000000))
      })

      it('buys fyDai', async () => {
        const daiReserves = await pool.getDaiReserves()
        const fyDaiReserves = await pool.getFYDaiReserves()
        const fyDaiOut = toWad(1)
        const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
        const timeTillMaturity = new BN(maturity1).sub(now)

        assert.equal(
          await fyDai1.balanceOf(to),
          0,
          "'To' wallet should have no fyDai, instead has " + (await fyDai1.balanceOf(to))
        )

        // Test preview since we are here
        const daiInPreview = await pool.buyFYDaiPreview(fyDaiOut, { from: operator })

        const expectedDaiIn = buyFYDai(
          daiReserves.toString(),
          fyDaiReserves.toString(),
          fyDaiOut.toString(),
          timeTillMaturity.toString(),
          '1.0'
        )

        await pool.addDelegate(operator, { from: from })
        await dai.mint(from, daiTokens)
        const daiBalanceBefore = await dai.balanceOf(from)

        await dai.approve(pool.address, daiTokens, { from: from })
        const tx = await pool.buyFYDai(from, to, fyDaiOut, { from: operator })
        const event = tx.logs[tx.logs.length - 4]

        const daiIn = daiBalanceBefore.sub(await dai.balanceOf(from))

        assert.equal(event.event, 'Trade')
        assert.equal(event.args.from, from)
        assert.equal(event.args.to, to)
        assert.equal(event.args.daiTokens, daiIn.neg().toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())

        assert.equal(await fyDai1.balanceOf(to), fyDaiOut.toString(), "'To' wallet should have 1 fyDai token")

        almostEqual(daiIn, floor(expectedDaiIn).toFixed(), daiIn.divn(1000000))
        almostEqual(daiInPreview, floor(expectedDaiIn).toFixed(), daiIn.divn(1000000))
      })

      it("once mature, doesn't allow trading", async () => {
        await helper.advanceTime(31556952)
        await helper.advanceBlock()
        const oneToken = toWad(1)

        await expectRevert(pool.sellDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.sellDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.buyDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.buyDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.sellFYDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.sellFYDai(from, to, oneToken, { from: from }), 'Pool: Too late')
        await expectRevert(pool.buyFYDaiPreview(oneToken, { from: operator }), 'Pool: Too late')
        await expectRevert(pool.buyFYDai(from, to, oneToken, { from: from }), 'Pool: Too late')
      })
    })
  })
})
