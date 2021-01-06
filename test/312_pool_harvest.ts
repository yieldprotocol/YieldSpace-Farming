import { artifacts, contract, web3 } from 'hardhat'

const Pool = artifacts.require('Pool')
const Dai = artifacts.require('DaiMock')
const CDai = artifacts.require('CDaiMock')
const FYDai = artifacts.require('FYDaiMock')
const YieldMath = artifacts.require('YieldMath')
const ComptrollerMock = artifacts.require('ComptrollerMock')
const UniswapV2RouterMock = artifacts.require('UniswapV2RouterMock')

import * as helper from 'ganache-time-traveler'
import { toWad, toRay, mulRay, divRay, ZERO, MAX } from './shared/utils'

// @ts-ignore
import { BN } from '@openzeppelin/test-helpers'
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

contract('Pool - Harvest', async (accounts) => {
  let [owner, user1, user2, operator, from, to] = accounts

  const oneToken = new BN('1000000000000000000')
  const MAX_BUFFER = oneToken.muln(50000)
  const MID_BUFFER = oneToken.muln(30000)
  const MIN_BUFFER = oneToken.muln(10000)
  const BUFFER_TRIGGER = oneToken.muln(10000)

  const cDaiTokens = oneToken.muln(1000000)
  const exchangeRate = toRay(0.5)
  const fyDaiTokens = cDaiTokens
  const initialDai = cDaiTokens

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
    await cDai.setExchangeRate(exchangeRate)

    // Set Comptroller
    comptroller = await ComptrollerMock.new()

    // Set Uniswap Router
    uniswapRouter = await UniswapV2RouterMock.new()
    await dai.mint(uniswapRouter.address, toWad(10000))

    // Setup Pool
    pool = await Pool.new(cDai.address, fyDai1.address, comptroller.address, uniswapRouter.address, 'Name', 'Symbol', {
      from: owner,
    })
  })

  afterEach(async () => {
    await helper.revertToSnapshot(snapshotId)
  })

  describe('mint and invest', () => {
    beforeEach(async () => {
      await dai.mint(user1, oneToken.muln(1000000))
      await dai.approve(pool.address, MAX, { from: user1 })
    })

    it('mints below MAX_BUFFER and BUFFER_TRIGGER don\'t cause to invest', async () => {
      
      await pool.mint(user1, user1, MID_BUFFER, { from: user1 }) // The initial mint doesn't cause an investing event
      await pool.mint(user1, user1, oneToken, { from: user1 })

      assert.equal(
        (await cDai.balanceOf(pool.address)).toString(),
        ZERO.toString()
      )
      assert.equal(
        (await dai.balanceOf(pool.address)).toString(),
        MID_BUFFER.add(oneToken).toString()
      )
    })

    it('mints above BUFFER_TRIGGER cause to invest', async () => {
      await pool.mint(user1, user1, MID_BUFFER, { from: user1 }) // The initial mint doesn't cause an investing event
      await pool.mint(user1, user1, BUFFER_TRIGGER.muln(1.5), { from: user1 })

      assert.equal(
        (await cDai.balanceOf(pool.address)).toString(),
        divRay(BUFFER_TRIGGER.muln(1.5).toString(), exchangeRate.toString()).toString()
      )
      assert.equal(
        (await dai.balanceOf(pool.address)).toString(),
        MID_BUFFER.toString()
      )
    })

    it('mints above MAX_BUFFER cause to invest', async () => {
      await pool.mint(user1, user1, MAX_BUFFER, { from: user1 }) // The initial mint doesn't cause an investing event
      await pool.mint(user1, user1, oneToken.muln(1000), { from: user1 })

      assert.equal(
        (await cDai.balanceOf(pool.address)).toString(),
        divRay(MAX_BUFFER.add(oneToken.muln(1000)).sub(MID_BUFFER).toString(), exchangeRate.toString()).toString()
      )
      assert.equal(
        (await dai.balanceOf(pool.address)).toString(),
        MID_BUFFER.toString()
      )
    })

    it('investedRate is the prorrated exchangeRate of each investment', async () => {
      assert.equal(
        (await pool.investedRate()).toString(),
        exchangeRate.toString()
      )

      await pool.mint(user1, user1, MID_BUFFER, { from: user1 })
      assert.equal(
        (await pool.investedRate()).toString(),
        exchangeRate.toString()
      )

      await pool.mint(user1, user1, BUFFER_TRIGGER.muln(2), { from: user1 })
      assert.equal(
        (await pool.investedRate()).toString(),
        toRay(0.5).toString()// exchangeRate.toString()
      )

      const exchangeRate2 = toRay(1)
      await cDai.setExchangeRate(exchangeRate2)

      await pool.mint(user1, user1, BUFFER_TRIGGER.muln(2), { from: user1 })
      assert.equal(
        (await pool.investedRate()).toString(),
        toRay(0.75).toString()// exchangeRate.toString()
      )

      const exchangeRate3 = toRay(1.5)
      await cDai.setExchangeRate(exchangeRate3)
      await pool.mint(user1, user1, BUFFER_TRIGGER.muln(2), { from: user1 })
      assert.equal(
        (await pool.investedRate()).toString(),
        toRay(1).toString() // exchangeRate.toString()
      )
    })
  })

  describe('burn and invest', () => {
    beforeEach(async () => {
      await dai.mint(user1, oneToken.muln(1000000))
      await dai.approve(pool.address, MAX, { from: user1 })
      await pool.mint(user1, user1, MAX_BUFFER, { from: user1 })
      await pool.mint(user1, user1, MID_BUFFER, { from: user1 })

      assert.equal(
        (await cDai.balanceOf(pool.address)).toString(),
        divRay(MAX_BUFFER.toString(), exchangeRate.toString()).toString())
      assert.equal(
        (await dai.balanceOf(pool.address)).toString(),
        MID_BUFFER.toString()
      )
    })

    it('burns above MIN_BUFFER and BUFFER_TRIGGER don\'t cause to divest', async () => {
      
      await pool.burn(user1, user1, oneToken, { from: user1 }) // 1 LP == 1 Dai so far

      assert.equal(
        (await cDai.balanceOf(pool.address)).toString(),
        divRay(MAX_BUFFER.toString(), exchangeRate.toString()).toString()
      )
      assert.equal(
        (await dai.balanceOf(pool.address)).toString(),
        MID_BUFFER.sub(oneToken).toString()
      )
    })

    it('burns above BUFFER_TRIGGER cause to divest', async () => {
      await pool.burn(user1, user1, BUFFER_TRIGGER.muln(1.5), { from: user1 })

      assert.equal(
        (await cDai.balanceOf(pool.address)).toString(),
        divRay(MAX_BUFFER.sub(BUFFER_TRIGGER.muln(1.5)).toString(), exchangeRate.toString()).toString()
      )
      assert.equal(
        (await dai.balanceOf(pool.address)).toString(),
        MID_BUFFER.toString()
      )
    })

    it('burns below MIN_BUFFER cause to divest', async () => {
      await pool.burn(user1, user1, BUFFER_TRIGGER, { from: user1 }) // Trade needs to be larger that BUFFER_TRIGGER to divest
      await pool.burn(user1, user1, BUFFER_TRIGGER, { from: user1 }) // Now we are at MIN_BUFFER

      await pool.burn(user1, user1, BUFFER_TRIGGER, { from: user1 }) // Divest!

      assert.equal(
        (await cDai.balanceOf(pool.address)).toString(),
        divRay(MAX_BUFFER.sub(BUFFER_TRIGGER.muln(3)).toString(), exchangeRate.toString()).toString()
      )
      assert.equal(
        (await dai.balanceOf(pool.address)).toString(),
        MID_BUFFER.toString()
      )
    })
  })

  describe('harvest', () => {
    beforeEach(async () => {
      await dai.mint(user1, oneToken.muln(1000000))
      await dai.approve(pool.address, MAX, { from: user1 })
    })

    it('harvests comp into dai', async () => {
      const daiReservesBefore = await pool.getLiquidityDaiReserves()
      await pool.harvest()

      assert.equal((await dai.balanceOf(pool.address)).toString(), daiReservesBefore.add(toWad(1)).toString())
      assert.equal((await pool.harvested()).toString(), toWad(1).toString())
    })
  })
})
