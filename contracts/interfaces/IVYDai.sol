// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVYDai is IERC20 {
    function exchangeRate() external view returns(uint); // In Dai terms, in RAY units
}
