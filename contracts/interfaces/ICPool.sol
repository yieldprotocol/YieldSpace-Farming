// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "./IPoolBase.sol";
import "./ICToken.sol";


interface ICPool is IPoolBase {
    function cDai() external view returns(ICToken);
    function getCDaiReserves() external view returns(uint128);
    function sellCDai(address from, address to, uint128 cDaiIn) external returns(uint128);
    function buyCDai(address from, address to, uint128 cDaiOut) external returns(uint128);
    function sellCDaiAtRate(uint128 cDaiIn, uint256 exchangeRate) external view returns(uint128);
    function buyCDaiAtRate(uint128 cDaiOut, uint256 exchangeRate) external view returns(uint128);

    // To be moved to IPoolBase when VYPool.sol implements them
    function sellFYDaiAtRate(uint128 fyDaiIn, uint256 exchangeRate) external view returns(uint128);
    function buyFYDaiAtRate(uint128 fyDaiOut, uint256 exchangeRate) external view returns(uint128);
}