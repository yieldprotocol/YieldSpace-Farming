import { artifacts, contract, web3 } from "hardhat";

const Pool = artifacts.require('Pool')
const Dai = artifacts.require('DaiMock')
const CDai = artifacts.require('CDaiMock')
const FYDai = artifacts.require('FYDaiMock')
const YieldMath = artifacts.require('YieldMath')
const ComptrollerMock = artifacts.require('ComptrollerMock')
const UniswapV2RouterMock = artifacts.require('UniswapV2RouterMock')

import * as helper from 'ganache-time-traveler'
import { toWad } from './shared/utils'

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

contract('Pool', async (accounts) => {
  let [owner, user1, user2, operator, from, to] = accounts

  // These values impact the pool results
  const cDaiTokens = new BN('1000000000000000000000000')
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
    maturity1 = await currentTimestamp() + 31556952 // One year
    fyDai1 = await FYDai.new(maturity1)

    // Setup dai
    dai = await Dai.new()

    // Setup cDai
    cDai = await CDai.new(dai.address)

    // Set Comptroller
    comptroller = await ComptrollerMock.new()

    // Set Uniswap Router
    uniswapRouter = await UniswapV2RouterMock.new()
    await dai.mint(uniswapRouter.address, toWad(10000));

    // Setup Pool
    pool = await Pool.new(cDai.address, fyDai1.address, comptroller.address, uniswapRouter.address, 'Name', 'Symbol', { from: owner })

    await dai.mint(user1, initialDai)
    await dai.approve(pool.address, initialDai, { from: user1 })
    await pool.mint(user1, user1, initialDai, { from: user1 })
  })

  afterEach(async () => {
    await helper.revertToSnapshot(snapshotId)
  })

  it('harvests comp and converts it to cDai', async () => {
    const daiReservesBefore = await pool.getDaiReserves()
    await pool.harvest()

    assert.equal(
      (await pool.getDaiReserves()).toString(),
      daiReservesBefore.add(toWad(1)).toString()
    )
  })
})
