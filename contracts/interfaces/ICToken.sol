// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICToken is IERC20 {
    function underlying() external view returns (address);

    function mint(uint mintAmount) external returns (uint _error);
    function redeem(uint redeemTokens) external returns (uint _error);
    // function redeemUnderlying(uint redeemAmount) external returns (uint _error);
    function exchangeRateStored() external view returns (uint);
    function exchangeRateCurrent() external returns (uint);
}
