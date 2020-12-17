// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "../helpers/ERC20Permit.sol";
import "../interfaces/ICToken.sol";

contract DaiMock is ERC20Permit("Dai", "DAI") {
  function mint(address to, uint256 amount) public {
    _mint(to, amount);
  }
}

contract CDaiMock is ERC20Permit("Compound Dai", "cDai"), ICToken {
  DaiMock private dai;
  uint256 public override exchangeRateStored;

  constructor() public {
    dai = new DaiMock();
    exchangeRateStored = 1e18;
  }

  function exchangeRateCurrent() external override returns (uint) {
    return exchangeRateStored;
  }

  function underlying() external override view returns (address) {
    return address(dai);
  }

  function mint(uint amount) external override returns (uint /*_error*/) {
    dai.transferFrom(msg.sender, address(this), amount);
    _mint(msg.sender, amount);
  }

  function redeem(uint amount) external override returns (uint /*_error*/) {
    _burn(msg.sender, amount);
    dai.transfer(msg.sender, amount);
  }

  function mintDai(address to, uint256 amount) public {
    dai.mint(to, amount);
  }

  function mintCDai(address to, uint256 amount) public {
    dai.mint(address(this), amount);
    _mint(to, amount);
  }

  function setExchangeRate(uint256 exchangeRate) public {
      exchangeRateStored = exchangeRate;
  }
}
