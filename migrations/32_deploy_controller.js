const { id } = require('ethers/lib/utils')
const Migrations = artifacts.require('Migrations')
const Treasury = artifacts.require('Treasury')
const Controller = artifacts.require('Controller')
const FYDai = artifacts.require('FYDai')

module.exports = async (deployer, network, accounts) => {
  const migrations = await Migrations.deployed()

  let treasuryAddress
  let controllerAddress

  treasury = await Treasury.deployed()
  treasuryAddress = treasury.address

  const fyDais = []
  for (let i = 0; i < (await migrations.length()); i++) {
    const contractName = web3.utils.toAscii(await migrations.names(i))
    if (contractName.includes('fyDai')) fyDais.push(await migrations.contracts(web3.utils.fromAscii(contractName)))
  }

  // Setup controller
  await deployer.deploy(Controller, treasuryAddress, fyDais)
  const controller = await Controller.deployed()
  controllerAddress = controller.address
  const treasuryFunctions = ['pushDai', 'pullDai', 'pushChai', 'pullChai', 'pushWeth', 'pullWeth'].map((func) =>
    id(func + '(address,uint256)')
  )
  await treasury.batchOrchestrate(controllerAddress, treasuryFunctions)

  // FYDai orchestration
  for (const addr of fyDais) {
    const fyDai = await FYDai.at(addr)
    await treasury.orchestrate(addr, id('pullDai(address,uint256)'))

    await fyDai.batchOrchestrate(controller.address, [id('mint(address,uint256)'), id('burn(address,uint256)')])
  }

  // Commit addresses to migrations registry
  const deployedCore = {
    Treasury: treasuryAddress,
    Controller: controllerAddress,
  }

  for (name in deployedCore) {
    await migrations.register(web3.utils.fromAscii(name), deployedCore[name])
  }
  console.log(deployedCore)
}
