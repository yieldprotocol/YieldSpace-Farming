import "@nomiclabs/hardhat-truffle5";
import "solidity-coverage";
import "hardhat-gas-reporter";
import * as fs from "fs";

const forkEnabled = !!process.env.FORK;

export default {
    defaultNetwork: "hardhat",
    solidity: {
        version: "0.7.5",
        settings: {
            optimizer: {
                enabled: true,
                runs: 20000
            },
        },
    },
    gasReporter: {
        enabled: true
    },
    paths: {
        artifacts: "./build",
        coverage: "./coverage",
        coverageJson: "./coverage.json",
    },
    networks: {
        hardhat: {
            accounts: {
                mnemonic: forkEnabled
                    ? "how are you gentlemen all your mnemonic are belong to us"
                    : "all your mnemonic are belong to us seed me up scotty over",
                accountsBalance: "1000000000000000000000000",
            },
            gasPrice: 0,
            chainId: forkEnabled ? 1 : 5777,
            gas: 0xfffffffffff,
            blockGasLimit: 0xfffffffffff,
            forking: {
                url: `https://mainnet.infura.io/v3/${fs.readFileSync(`${__dirname}/.infuraKey`)}`,
                enabled: forkEnabled,
            },
        },
        coverage: {
            url: "http://127.0.0.1:8555",
        },
    },
};
