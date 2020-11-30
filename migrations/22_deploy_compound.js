const Migrations = artifacts.require('Migrations')
const WETH9 = artifacts.require('WETH9')
const Dai = artifacts.require('Dai')
const Comptroller = artifacts.require('Comptroller')
const InterestRateModel = artifacts.require('WhitePaperInterestRateModel')
const CErc20 = artifacts.require('CErc20')

const { BigNumber } = require('ethers')

function toWad(value) {
  let exponent = BigNumber.from(10).pow(BigNumber.from(8))
  return BigNumber.from(value * 10 ** 10).mul(exponent)
}

function toRay(value) {
  let exponent = BigNumber.from(10).pow(BigNumber.from(17))
  return BigNumber.from(value * 10 ** 10).mul(exponent)
}

function toRad(value) {
  let exponent = BigNumber.from(10).pow(BigNumber.from(35))
  return BigNumber.from(value * 10 ** 10).mul(exponent)
}

function subBN(x, y) {
  return BigNumber.from(x).sub(BigNumber.from(y))
}

module.exports = async (deployer, network, accounts) => {
  const migrations = await Migrations.deployed()

  let wethAddress, daiAddress

  if (network === 'mainnet' || network === 'mainnet-ganache') {
    wethAddress = fixed_addrs[network].wethAddress
    daiAddress = fixed_addrs[network].daiAddress
  } else {
    wethAddress = (await WETH9.deployed()).address
    daiAddress = (await Dai.deployed()).address
  }

  const weth = await WETH9.at(wethAddress)
  const dai = await Dai.at(daiAddress)

  await deployer.deploy(Comptroller)
  const comptroller = await Comptroller.deployed()

  let baseRatePerYear = toWad(1.05)
  let multiplierPerYear = toWad(2)
  await deployer.deploy(InterestRateModel, baseRatePerYear, multiplierPerYear)
  let interestRateModel = await InterestRateModel.deployed()

  let initialExchangeRateMantissa = toWad(1.1)
  await deployer.deploy(CErc20)
  const cWeth = await CErc20.deployed()
  await cWeth.initialize(
    weth.address,
    comptroller.address,
    interestRateModel.address,
    initialExchangeRateMantissa,
    "cWeth",
    "cWeth",
    18,
  )

  baseRatePerYear = toWad(1.02)
  multiplierPerYear = toWad(2)
  await deployer.deploy(InterestRateModel, baseRatePerYear, multiplierPerYear)
  interestRateModel = await InterestRateModel.deployed()

  initialExchangeRateMantissa = toWad(1.03)
  await deployer.deploy(CErc20)
  const cDai = await CErc20.deployed()
  await cDai.initialize(
    dai.address,
    comptroller.address,
    interestRateModel.address,
    initialExchangeRateMantissa,
    "cDai",
    "cDai",
    18,
  )

  // Commit addresses to migrations registry
  const deployed = {
    Weth: weth.address,
    Dai: dai.address,
    Comptroller: comptroller.address,
    CWeth: cWeth.address,
    CDai: cDai.address,
  }

  for (name in deployed) {
    await migrations.register(web3.utils.fromAscii(name), deployed[name])
  }
  console.log(deployed)
}
