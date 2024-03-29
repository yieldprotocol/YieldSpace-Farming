// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IERC2612.sol";

interface IFYDai is IERC20, IERC2612 {
    function maturity() external view returns(uint);
}
