// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/IUniswapV2Router.sol";

contract UniswapV2RouterMock is IUniswapV2Router {
  function WETH() external override pure returns (address) {
    return address(0);
  }

  function swapExactTokensForTokens(
      uint amountIn,
      uint /*amountOutMin*/,
      address[] calldata path,
      address to,
      uint /*deadline*/
  ) external override returns (uint[] memory amounts) {
    amounts = new uint[](path.length + 1);
    amounts[0] = amountIn;
    SafeERC20.safeTransferFrom(IERC20(path[0]), msg.sender, address(this), amountIn);
    SafeERC20.safeTransfer(IERC20(path[path.length - 1]), to, amountIn);
    amounts[path.length] = amountIn;
  }
}
