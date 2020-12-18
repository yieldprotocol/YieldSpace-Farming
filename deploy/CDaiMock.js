const cDaiAddresses = {
  '' : {
    '1' : '',
    '42' : ''
  },
  '' : {
    '1' : '',
    '42' : ''
  },
  '' : {
    '1' : '',
    '42' : ''
  },
  '' : {
    '1' : '',
    '42' : ''
  },
  '' : {
    '1' : '',
    '42' : ''
  },
}

const func = async function ({ deployments, getNamedAccounts, getChainId }) {
  const { deploy, read, execute } = deployments;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId()

  if (chainId !== '31337') { // buidlerevm's chainId
    console.log('Testnet deployments not implemented')
    return
  } else {
    cdai = await deploy('CDaiMock', {
      from: deployer,
      deterministicDeployment: true,
      args: [],
    })
    console.log(`Deployed CDaiMock to ${cdai.address}`);
  }
};

module.exports = func;
module.exports.tags = ["CDaiMock"];
