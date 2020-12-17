const IERC20 = artifacts.require('IERC20')
const CDaiStrategy = artifacts.require('CDaiStrategy')
const ComptrollerMock = artifacts.require('ComptrollerMock')
const CDaiMock = artifacts.require('CDaiMock')
const UniswapV2RouterMock = artifacts.require('UniswapV2RouterMock')

import { toWad } from './shared/utils'
import { Contract } from './shared/fixtures'
import { assert } from 'chai'

contract('CDaiStrategy', async ([owner, user1, user2]) => {
  let dai: Contract
  let cdai: Contract
  let cDaiStrategy: Contract
  let comptroller: Contract
  let uniswapRouter: Contract

  beforeEach(async () => {
    comptroller = await ComptrollerMock.new()
    cdai = await CDaiMock.new()
    uniswapRouter = await UniswapV2RouterMock.new()
    dai = await IERC20.at(await cdai.underlying())

    await cdai.mintDai(uniswapRouter.address, toWad(10000));
    
    cDaiStrategy = await CDaiStrategy.new(comptroller.address, cdai.address, uniswapRouter.address)
  })

  it('get the size of the contract', async () => {
    console.log()
    console.log('    ·--------------------|------------------|------------------|------------------·')
    console.log('    |  Contract          ·  Bytecode        ·  Deployed        ·  Constructor     |')
    console.log('    ·····················|··················|··················|···················')

    const bytecode = cDaiStrategy.constructor._json.bytecode
    const deployed = cDaiStrategy.constructor._json.deployedBytecode
    const sizeOfB = bytecode.length / 2
    const sizeOfD = deployed.length / 2
    const sizeOfC = sizeOfB - sizeOfD
    console.log(
      '    |  ' +
        cDaiStrategy.constructor._json.contractName.padEnd(18, ' ') +
        '|' +
        ('' + sizeOfB).padStart(16, ' ') +
        '  ' +
        '|' +
        ('' + sizeOfD).padStart(16, ' ') +
        '  ' +
        '|' +
        ('' + sizeOfC).padStart(16, ' ') +
        '  |'
    )
    console.log('    ·--------------------|------------------|------------------|------------------·')
    console.log()
  })

  it('should deposit cDai into yvcDai, harvest and withdraw', async () => {
    await cdai.mintCDai(user1, toWad(10), { from: user1 })

    await cdai.approve(cDaiStrategy.address, toWad(10), { from: user1 })
    await cDaiStrategy.deposit(toWad(10), { from: user1 })

    assert.equal(await cDaiStrategy.balanceOf(user1), toWad(10).toString())
    assert.equal(await cDaiStrategy.balanceOfUnderlying(user1), toWad(10).toString())

    await cDaiStrategy.harvest()

    assert.equal(await cDaiStrategy.balanceOfUnderlying(user1), toWad(11).toString())
  })

  it('should allocate yields correctly with multiple users', async () => {
    await cdai.mintCDai(user1, toWad(10), { from: user1 })
    await cdai.mintCDai(user2, toWad(20), { from: user2 })

    await cdai.approve(cDaiStrategy.address, toWad(10), { from: user1 })
    await cDaiStrategy.deposit(toWad(10), { from: user1 })

    await cdai.approve(cDaiStrategy.address, toWad(20), { from: user2 })
    await cDaiStrategy.deposit(toWad(20), { from: user2 })

    assert.equal(await cDaiStrategy.balanceOf(user1), toWad(10).toString())
    assert.equal(await cDaiStrategy.balanceOfUnderlying(user1), toWad(10).toString())
    assert.equal(await cDaiStrategy.balanceOf(user2), toWad(20).toString())
    assert.equal(await cDaiStrategy.balanceOfUnderlying(user2), toWad(20).toString())

    await cDaiStrategy.harvest()
    await cDaiStrategy.harvest()
    await cDaiStrategy.harvest()

    assert.equal(await cDaiStrategy.balanceOfUnderlying(user1), toWad(11).toString())
    assert.equal(await cDaiStrategy.balanceOfUnderlying(user2), toWad(22).toString())
  })

  it('should allow deposits and withdrawls in Dai', async () => {
    await cdai.mintDai(user1, toWad(10), { from: user1 })

    await dai.approve(cDaiStrategy.address, toWad(10), { from: user1 })
    await cDaiStrategy.depositDai(toWad(10), { from: user1 })

    assert.equal(await cDaiStrategy.balanceOf(user1), toWad(10).toString())
    assert.equal(await cDaiStrategy.balanceOfUnderlying(user1), toWad(10).toString())

    await cDaiStrategy.harvest()

    assert.equal(await cDaiStrategy.balanceOfUnderlying(user1), toWad(11).toString())

    await cDaiStrategy.withdrawDai(toWad(10), { from: user1 })

    assert.equal(await dai.balanceOf(user1), toWad(11).toString())
  })
})
