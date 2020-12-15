const VariableYieldMathWrapper = artifacts.require('VariableYieldMathWrapper')
const VariableYieldMath = artifacts.require('VariableYieldMath')

// @ts-ignore
import helper from 'ganache-time-traveler'
import { Contract } from './shared/fixtures'
// @ts-ignore
import { BN } from '@openzeppelin/test-helpers'
import { expect } from 'chai'
// const { bignumber, add, subtract, multiply, divide, pow, floor } = require('mathjs')
import { sellVYDaiNormalized, sellFYDaiNormalized, buyVYDaiNormalized, buyFYDaiNormalized } from './shared/yieldspace'
const { bignumber, floor, multiply } = require('mathjs')

const ONE = new BN('1')
const TWO = new BN('2')
const THREE = new BN('3')
const FOUR = new BN('4')
const TEN = new BN('10')
const TWENTY = new BN('20')

const MAX = new BN('340282366920938463463374607431768211455') // type(uint128).max
const OneToken = new BN('1000000000000000000') // 1e18
const ONE64 = new BN('18446744073709551616') // In 64.64 format
const secondsInOneYear = new BN(60 * 60 * 24 * 365) // Seconds in 4 years
const secondsInFourYears = secondsInOneYear.mul(FOUR) // Seconds in 4 years
const k = ONE64.div(secondsInFourYears)

const g0 = ONE64 // No fees
const g1 = new BN('950').mul(ONE64).div(new BN('1000')) // Sell vyDai to the pool
const g2 = new BN('1000').mul(ONE64).div(new BN('950')) // Sell fyDai to the pool

const PRECISION = new BN('1000000000000000000') // 1e18

function toBigNumber(x: any) {
  if (typeof x == 'object') x = x.toString()
  if (typeof x == 'number') return new BN(x)
  else if (typeof x == 'string') {
    if (x.startsWith('0x') || x.startsWith('0X')) return new BN(x.substring(2), 16)
    else return new BN(x)
  }
}

function decTo6464(x: any): BN {
  return new BN(floor(multiply(bignumber(x), 1000000000000000)).toString()).mul(ONE64).div(new BN('1000000000000000'))
}

function almostEqual(x: any, y: any, p: any) {
  // Check that abs(x - y) < p:
  const xb = toBigNumber(x)
  const yb = toBigNumber(y)
  const pb = toBigNumber(p)
  const diff = xb.gt(yb) ? xb.sub(yb) : yb.sub(xb)
  expect(diff).to.be.bignumber.lt(pb)
}

contract('VariableYieldMath - Surface', async (accounts) => {
  let snapshot: any
  let snapshotId: string

  let yieldMath: Contract

  const vyDaiReserves = [
    // '100000000000000000000000',
    // '1000000000000000000000000',
    // '10000000000000000000000000',
    // '100000000000000000000000000',
    '1000000000000000000000000000',
  ]
  const fyDaiReserveDeltas = [
    // '10000000000000000000',
    // '1000000000000000000000',
    // '100000000000000000000000',
    // '10000000000000000000000000',
    '1000000000000000000000000000',
  ]
  const tradeSizes = [
    // '1000000000000000000',
    // '10000000000000000000',
    // '100000000000000000000',
    // '1000000000000000000000',
    '10000000000000000000000',
  ]
  const timesTillMaturity = [
    // '4',
    // '40',
    // '4000',
    // '400000',
    // '40000000',
    '80000000',
  ]
  const initialRates = [
    '0.000101',
    '0.0101',
    '0.101',
    '1.01',
  ]
  const normalizedRates = [
    '0.000101',
    '0.0101',
    '0.101',
    '1.01',
  ]

  before(async () => {
    const yieldMathLibrary = await VariableYieldMath.new()
    await VariableYieldMathWrapper.link(yieldMathLibrary)
  })

  beforeEach(async () => {
    snapshot = await helper.takeSnapshot()
    snapshotId = snapshot['result']

    // Setup YieldMathWrapper
    yieldMath = await VariableYieldMathWrapper.new()
  })

  afterEach(async () => {
    await helper.revertToSnapshot(snapshotId)
  })

  describe('Test scenarios', async () => {
    it('Compare a lattice of on-chain vs off-chain yieldspace trades', async function () {
      this.timeout(0)

      for (var vyDaiReserve of vyDaiReserves) {
        for (var fyDaiReserveDelta of fyDaiReserveDeltas) {
          for (var tradeSize of tradeSizes) {
            for (var timeTillMaturity of timesTillMaturity) {
              for (var initialRate of initialRates) {
                for (var normalizedRate of normalizedRates) {
                  console.log(
                    `vyDaiReserve, fyDaiReserveDelta, tradeSize, timeTillMaturity, initialRate, normalizedRate`
                  )
                  console.log(
                    `${vyDaiReserve}, ${fyDaiReserveDelta}, ${tradeSize}, ${timeTillMaturity}, ${initialRate}, ${normalizedRate}`
                  )
                  const fyDaiReserve = new BN(vyDaiReserve).add(new BN(fyDaiReserveDelta)).toString()
                  const currentRate = Number(initialRate) * Number(normalizedRate)

                  let offChain, onChain
                  offChain = sellFYDaiNormalized(
                    vyDaiReserve,
                    fyDaiReserve,
                    tradeSize,
                    timeTillMaturity,
                    initialRate,
                    currentRate
                  )
                  onChain = await yieldMath.vyDaiOutForFYDaiInNormalized(
                    vyDaiReserve,
                    fyDaiReserve,
                    tradeSize,
                    timeTillMaturity,
                    k,
                    g2,
                    decTo6464(initialRate),
                    decTo6464(currentRate)
                  )
                  console.log(`offChain sellFYDai: ${floor(offChain).toFixed()}`)
                  console.log(`onChain sellFYDai: ${onChain}`)
                  almostEqual(onChain, floor(offChain).toFixed(), PRECISION)

                  offChain = sellVYDaiNormalized(
                    vyDaiReserve,
                    fyDaiReserve,
                    tradeSize,
                    timeTillMaturity,
                    initialRate,
                    currentRate
                  )
                  onChain = await yieldMath.fyDaiOutForVYDaiInNormalized(
                    vyDaiReserve,
                    fyDaiReserve,
                    tradeSize,
                    timeTillMaturity,
                    k,
                    g1,
                    decTo6464(initialRate),
                    decTo6464(currentRate)
                  )
                  console.log(`offChain sellVYDai: ${floor(offChain).toFixed()}`)
                  console.log(`onChain sellVYDai: ${onChain}`)
                  almostEqual(onChain, floor(offChain).toFixed(), PRECISION)

                  offChain = buyVYDaiNormalized(
                    vyDaiReserve,
                    fyDaiReserve,
                    tradeSize,
                    timeTillMaturity,
                    initialRate,
                    currentRate
                  )
                  onChain = await yieldMath.fyDaiInForVYDaiOutNormalized(
                    vyDaiReserve,
                    fyDaiReserve,
                    tradeSize,
                    timeTillMaturity,
                    k,
                    g2,
                    decTo6464(initialRate),
                    decTo6464(currentRate)
                  )
                  console.log(`offChain buyVYDai: ${floor(offChain).toFixed()}`)
                  console.log(`onChain buyVYDai: ${onChain}`)
                  almostEqual(onChain, floor(offChain).toFixed(), PRECISION)

                  offChain = buyFYDaiNormalized(
                    vyDaiReserve,
                    fyDaiReserve,
                    tradeSize,
                    timeTillMaturity,
                    initialRate,
                    currentRate
                  )
                  onChain = await yieldMath.vyDaiInForFYDaiOutNormalized(
                    vyDaiReserve,
                    fyDaiReserve,
                    tradeSize,
                    timeTillMaturity,
                    k,
                    g1,
                    decTo6464(initialRate),
                    decTo6464(currentRate)
                  )
                  console.log(`offChain buyFYDai: ${floor(offChain).toFixed()}`)
                  console.log(`onChain buyFYDai: ${onChain}`)
                  almostEqual(onChain, floor(offChain).toFixed(), PRECISION)

                  console.log()
                }
              }
            }
          }
        }
      }
    })
  })
})
