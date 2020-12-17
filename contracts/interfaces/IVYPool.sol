// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IDelegable.sol";
import "./IERC2612.sol";
import "./IFYDai.sol";
import "./IVYDai.sol";

interface IVYPool is IDelegable, IERC20, IERC2612 {
    function vyDai() external view returns(IVYDai);
    function fyDai() external view returns(IFYDai);
    function getVYDaiReserves() external view returns(uint128);
    function getFYDaiReserves() external view returns(uint128);
    function sellVYDai(address from, address to, uint128 vyDaiIn) external returns(uint128);
    function buyVYDai(address from, address to, uint128 vyDaiOut) external returns(uint128);
    function sellFYDai(address from, address to, uint128 fyDaiIn) external returns(uint128);
    function buyFYDai(address from, address to, uint128 fyDaiOut) external returns(uint128);
    function sellVYDaiPreview(uint128 vyDaiIn) external view returns(uint128);
    function buyVYDaiPreview(uint128 vyDaiOut) external view returns(uint128);
    function sellFYDaiPreview(uint128 fyDaiIn) external view returns(uint128);
    function buyFYDaiPreview(uint128 fyDaiOut) external view returns(uint128);
    function mint(address from, address to, uint256 daiOffered) external returns (uint256);
    function burn(address from, address to, uint256 tokensBurned) external returns (uint256, uint256);
}