// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.10;

import "../helpers/ERC20Permit.sol";
import "../interfaces/IFYDai.sol";

contract FYDaiMock is IFYDai, ERC20Permit {
    uint256 public override maturity;

    constructor (uint256 maturity_) public ERC20Permit("Test", "TST") {
        maturity = maturity_;
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
}
