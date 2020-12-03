const VYPool = artifacts.require('VYPool')
const VYDai = artifacts.require('VYDaiMock')

const { bignumber, floor, multiply } = require('mathjs')
import { keccak256, toUtf8Bytes } from 'ethers/lib/utils'
// @ts-ignore
import helper from 'ganache-time-traveler'
import { toWad, toRay, mulRay } from './shared/utils'
import { YieldEnvironmentLite, Contract } from './shared/fixtures'
import { sellVYDaiNormalized, sellFYDaiNormalized, buyVYDaiNormalized, buyFYDaiNormalized } from './shared/yieldspace'
// @ts-ignore
import { BN, expectRevert } from '@openzeppelin/test-helpers'
import { assert, expect } from 'chai'

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

contract('Pool', async (accounts) => {
  let [owner, user1, user2, operator, from, to] = accounts

  // These values impact the pool results
  const rate1 = toRay(1.02)
  const daiDebt1 = toWad(96)
  const daiTokens1 = mulRay(daiDebt1, rate1)
  const fyDaiTokens1 = daiTokens1

  const oneToken = toWad(1)
  const initialDai = daiTokens1

  let snapshot: any
  let snapshotId: string

  let env: YieldEnvironmentLite

  let dai: Contract
  let pool: Contract
  let fyDai1: Contract
  let vyDai: Contract

  let maturity1: number

  beforeEach(async () => {
    snapshot = await helper.takeSnapshot()
    snapshotId = snapshot['result']

    // Setup fyDai
    const block = await web3.eth.getBlockNumber()
    maturity1 = (await web3.eth.getBlock(block)).timestamp + 31556952 // One year
    env = await YieldEnvironmentLite.setup([maturity1])
    dai = env.maker.dai
    fyDai1 = env.fyDais[0]

    // Setup vyDai
    vyDai = await VYDai.new('2000000000000000000000000000') // exchangeRate = 2.0

    // Setup Pool
    pool = await VYPool.new(vyDai.address, fyDai1.address, 'Name', 'Symbol', { from: owner })

    // Allow owner to mint fyDai the sneaky way, without recording a debt in controller
    await fyDai1.orchestrate(owner, keccak256(toUtf8Bytes('mint(address,uint256)')), { from: owner })

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

    console.log('        initial liquidity...')
    console.log('        daiReserves: %d', initialDai.toString())

    await vyDai.approve(pool.address, initialDai, { from: user1 })
    // await fyDai1.approve(pool.address, fyDaiTokens1, { from: user1 });
    const tx = await pool.mint(user1, user1, initialDai, { from: user1 })
    const event = tx.logs[tx.logs.length - 1]

    assert.equal(event.event, 'Liquidity')
    assert.equal(event.args.from, user1)
    assert.equal(event.args.to, user1)
    assert.equal(event.args.vyDaiTokens.toString(), initialDai.mul(-1).toString())
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
      const timeTillMaturity = (new BN(maturity1)).sub(now)

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
      const tx = (await pool.sellFYDai(from, to, fyDaiIn, { from: operator }))
      const event = tx.logs[tx.logs.length - 1]

      assert.equal(event.event, 'Trade')
      assert.equal(event.args.from, from)
      assert.equal(event.args.to, to)
      assert.equal(event.args.vyDaiTokens, (await vyDai.balanceOf(to)).toString())
      assert.equal(event.args.fyDaiTokens, fyDaiIn.mul(new BN('-1')).toString())

      assert.equal(await fyDai1.balanceOf(from), 0, "'From' wallet should have no fyDai tokens")
      
      const vyDaiOut = new BN(await vyDai.balanceOf(to))

      almostEqual(vyDaiOut, floor(expectedVYDaiOut).toFixed(), fyDaiIn.div(new BN('1000000')))
      almostEqual(vyDaiOutPreview, floor(expectedVYDaiOut).toFixed(), fyDaiIn.div(new BN('1000000')))
    })

    it('buys vyDai', async () => {
      const vyDaiReserves = await pool.getVYDaiReserves()
      const fyDaiReserves = await pool.getFYDaiReserves()
      const vyDaiOut = new BN(toWad(1).toString())
      const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
      const timeTillMaturity = (new BN(maturity1)).sub(now)

      await fyDai1.mint(from, fyDaiTokens1, { from: owner })

      assert.equal(
        await fyDai1.balanceOf(from),
        fyDaiTokens1.toString(),
        "'From' wallet should have " + fyDaiTokens1 + ' fyDai, instead has ' + (await fyDai1.balanceOf(from))
      )

      // Test preview since we are here
      const fyDaiInPreview = await pool.buyVYDaiPreview(oneToken, { from: operator })

      const expectedFYDaiIn = buyVYDaiNormalized(
        vyDaiReserves.toString(),
        fyDaiReserves.toString(),
        vyDaiOut.toString(),
        timeTillMaturity.toString(),
        '2.0',
        '3.0'
      )

      await pool.addDelegate(operator, { from: from })
      await fyDai1.approve(pool.address, fyDaiTokens1, { from: from })
      const tx = (await pool.buyVYDai(from, to, vyDaiOut, { from: operator }))
      const event = tx.logs[tx.logs.length - 1]

      const fyDaiIn = new BN(fyDaiTokens1.toString()).sub(new BN(await fyDai1.balanceOf(from)))

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

      /*
      it('mints liquidity tokens', async () => {
        // Use this to test: https://www.desmos.com/calculator/mllhtohxfx

        console.log('          minting liquidity tokens...')
        console.log('          Real daiReserves: %d', await vyDai.balanceOf(pool.address))
        console.log('          Real fyDaiReserves: %d', await fyDai1.balanceOf(pool.address))
        console.log('          Pool supply: %d', await pool.totalSupply())
        console.log('          daiIn: %d', oneToken.toString())

        await vyDai.mint(user1, oneToken, { from: owner })
        await fyDai1.mint(user1, fyDaiTokens1, { from: owner })

        const fyDaiBefore = new BN(await fyDai1.balanceOf(user1))
        const poolTokensBefore = new BN(await pool.balanceOf(user2))

        await vyDai.approve(pool.address, oneToken, { from: user1 })
        await fyDai1.approve(pool.address, fyDaiTokens1, { from: user1 })
        const tx = await pool.mint(user1, user2, oneToken, { from: user1 })
        const event = tx.logs[tx.logs.length - 1]

        const expectedMinted = new BN('1473236946700000000')
        const expectedFYDaiIn = new BN('517558731280000000')

        const minted = new BN(await pool.balanceOf(user2)).sub(poolTokensBefore)
        const fyDaiIn = fyDaiBefore.sub(new BN(await fyDai1.balanceOf(user1)))

        assert.equal(event.event, 'Liquidity')
        assert.equal(event.args.from, user1)
        assert.equal(event.args.to, user2)
        assert.equal(event.args.vyDaiTokens, oneToken.mul(-1).toString())

        expect(minted).to.be.bignumber.gt(expectedMinted.mul(new BN('9999')).div(new BN('10000')))
        expect(minted).to.be.bignumber.lt(expectedMinted.mul(new BN('10001')).div(new BN('10000')))

        expect(fyDaiIn).to.be.bignumber.gt(expectedFYDaiIn.mul(new BN('9999')).div(new BN('10000')))
        expect(fyDaiIn).to.be.bignumber.lt(expectedFYDaiIn.mul(new BN('10001')).div(new BN('10000')))

        assert.equal(event.args.fyDaiTokens, fyDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.poolTokens, minted.toString())
      })

      it('burns liquidity tokens', async () => {
        // Use this to test: https://www.desmos.com/calculator/ubsalzunpo

        console.log('          burning liquidity tokens...')
        console.log('          Real daiReserves: %d', await vyDai.balanceOf(pool.address))
        console.log('          Real fyDaiReserves: %d', await fyDai1.balanceOf(pool.address))
        console.log('          Pool supply: %d', await pool.totalSupply())
        console.log('          Burned: %d', oneToken.toString())

        const fyDaiReservesBefore = new BN(await fyDai1.balanceOf(pool.address))
        const daiReservesBefore = new BN(await vyDai.balanceOf(pool.address))

        await pool.approve(pool.address, oneToken, { from: user1 })
        const tx = await pool.burn(user1, user2, oneToken, { from: user1 })
        const event = tx.logs[tx.logs.length - 1]

        const expectedFYDaiOut = new BN('351307189540000000')
        const expectedVYDaiOut = new BN('678777437820000000')

        const fyDaiOut = fyDaiReservesBefore.sub(new BN(await fyDai1.balanceOf(pool.address)))
        const vyDaiOut = daiReservesBefore.sub(new BN(await vyDai.balanceOf(pool.address)))

        assert.equal(event.event, 'Liquidity')
        assert.equal(event.args.from, user1)
        assert.equal(event.args.to, user2)
        assert.equal(event.args.poolTokens, oneToken.mul(-1).toString())

        expect(fyDaiOut).to.be.bignumber.gt(expectedFYDaiOut.mul(new BN('9999')).div(new BN('10000')))
        expect(fyDaiOut).to.be.bignumber.lt(expectedFYDaiOut.mul(new BN('10001')).div(new BN('10000')))

        expect(vyDaiOut).to.be.bignumber.gt(expectedVYDaiOut.mul(new BN('9999')).div(new BN('10000')))
        expect(vyDaiOut).to.be.bignumber.lt(expectedVYDaiOut.mul(new BN('10001')).div(new BN('10000')))

        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())
        assert.equal(event.args.vyDaiTokens, vyDaiOut.toString())
      })
      */

      it('sells vyDai', async () => {
        const vyDaiReserves = await pool.getVYDaiReserves()
        const fyDaiReserves = await pool.getFYDaiReserves()
        const vyDaiIn = new BN(toWad(1).toString())
        const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
        const timeTillMaturity = (new BN(maturity1)).sub(now)

        assert.equal(
          await fyDai1.balanceOf(to),
          0,
          "'To' wallet should have no fyDai, instead has " + (await fyDai1.balanceOf(operator))
        )

        // Test preview since we are here
        const fyDaiOutPreview = await pool.sellVYDaiPreview(oneToken, { from: operator })

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
        const tx = (await pool.sellVYDai(from, to, vyDaiIn, { from: operator }))
        const event = tx.logs[tx.logs.length - 1]

        const fyDaiOut = new BN(await fyDai1.balanceOf(to))

        assert.equal(event.event, 'Trade')
        assert.equal(event.args.from, from)
        assert.equal(event.args.to, to)
        assert.equal(event.args.vyDaiTokens, vyDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())

        assert.equal(
          await vyDai.balanceOf(from),
          0,
          "'From' wallet should have no vyDai tokens"
        )

        almostEqual(fyDaiOut, floor(expectedFYDaiOut).toFixed(), vyDaiIn.div(new BN('1000000')))
        almostEqual(fyDaiOutPreview, floor(expectedFYDaiOut).toFixed(), vyDaiIn.div(new BN('1000000')))
      })

      it('buys fyDai', async () => {
        const vyDaiReserves = await pool.getVYDaiReserves()
        const fyDaiReserves = await pool.getFYDaiReserves()
        const fyDaiOut = new BN(toWad(1).toString())
        const now = new BN((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp)
        const timeTillMaturity = (new BN(maturity1)).sub(now)

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
        await vyDai.mint(from, daiTokens1)
        await vyDai.approve(pool.address, daiTokens1, { from: from })
        const tx = await pool.buyFYDai(from, to, fyDaiOut, { from: operator })
        const event = tx.logs[tx.logs.length - 1]

        const vyDaiIn = new BN(daiTokens1.toString()).sub(new BN(await vyDai.balanceOf(from)))

        assert.equal(event.event, 'Trade')
        assert.equal(event.args.from, from)
        assert.equal(event.args.to, to)
        assert.equal(event.args.vyDaiTokens, vyDaiIn.mul(new BN('-1')).toString())
        assert.equal(event.args.fyDaiTokens, fyDaiOut.toString())

        assert.equal(await fyDai1.balanceOf(to), oneToken.toString(), "'To' wallet should have 1 fyDai token")

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
