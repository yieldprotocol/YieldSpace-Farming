// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.10;

import "../helpers/ERC20Permit.sol";
import "../interfaces/IVYDai.sol";

contract VYDaiMock is IVYDai, ERC20Permit {
    uint256 public override exchangeRate;

    constructor (uint256 exchangeRate_) public ERC20Permit("Test", "TST") {
        exchangeRate = exchangeRate_;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }

    function setExchangeRate(uint256 exchangeRate_) public returns (uint256) {
        exchangeRate = exchangeRate_;
    }
}
