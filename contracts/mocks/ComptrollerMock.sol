// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/IComptroller.sol";

contract Comp is ERC20("Compound", "COMP") {
  address public owner;

  constructor() public {
    owner = msg.sender;
  }

  function mint(address to, uint256 amount) public {
    require(msg.sender == owner);
    _mint(to, amount);
  }
}

contract ComptrollerMock is IComptroller {
  Comp public immutable comp;

  constructor() public {
    comp = new Comp();
  }

  function claimComp(address[] memory holders, address[] memory /*cTokens*/, bool /*borrowers*/, bool /*suppliers*/)
      public override {
    for (uint8 i = 0; i < holders.length; i++) {
      comp.mint(holders[i], 1 ether);
    }
  }

  function getCompAddress() public override view returns (address) {
    return address(comp);
  }
}
