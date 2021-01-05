// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "./IPoolBase.sol";
import "./IDai.sol";


interface IPool is IPoolBase {
    function dai() external view returns(IDai);
    function getTradingDaiReserves() external view returns(uint128);
    function getLiquidityDaiReserves() external view returns(uint128);
    function sellDai(address from, address to, uint128 daiIn) external returns(uint128);
    function buyDai(address from, address to, uint128 daiOut) external returns(uint128);
}