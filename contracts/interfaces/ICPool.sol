// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.10;

import "./IPoolBase.sol";
import "./ICToken.sol";


interface ICPool is IPoolBase {
    function cDai() external view returns(ICToken);
    function getCDaiReserves() external view returns(uint128);
    function sellCDai(address from, address to, uint128 cDaiIn) external returns(uint128);
    function buyCDai(address from, address to, uint128 cDaiOut) external returns(uint128);
    function sellCDaiPreview(uint128 cDaiIn) external view returns(uint128);
    function buyCDaiPreview(uint128 cDaiOut) external view returns(uint128);
    function sellCDaiCurrent(uint128 cDaiIn) external returns(uint128);
    function buyCDaiCurrent(uint128 cDaiOut) external returns(uint128);
    function sellCDaiAtRate(uint128 cDaiIn, int128 exchangeRate) external view returns(uint128);
    function buyCDaiAtRate(uint128 cDaiOut, int128 exchangeRate) external view returns(uint128);

    // To be moved to IPoolBase when Pool.sol implements them
    function sellFYDaiCurrent(uint128 fyDaiIn) external returns(uint128);
    function buyFYDaiCurrent(uint128 fyDaiOut) external returns(uint128);
    function sellFYDaiAtRate(uint128 fyDaiIn, int128 exchangeRate) external view returns(uint128);
    function buyFYDaiAtRate(uint128 fyDaiOut, int128 exchangeRate) external view returns(uint128);
}