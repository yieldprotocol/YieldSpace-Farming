// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../interfaces/IComptroller.sol";
import "../interfaces/ICToken.sol";
import "../interfaces/IUniswapV2Router.sol";

import "../CPool.sol";

/// @dev CPoolStrategy is a CPool that allows for Comp rewards to be harvested and converted to cDai, which is added to the reserves.
contract CPoolStrategy is CPool {

    IERC20 public immutable comp;
    IUniswapV2Router public immutable uniswap;
    IComptroller public immutable comptroller;

    /// @dev Comp harvested, and Dai obtained by its sale
    event Harvested(uint256 comp, uint256 dai);

    constructor(ICToken cDai_, IFYDai fyDai_, IComptroller comptroller_, IUniswapV2Router uniswap_, string memory name_, string memory symbol_)
        CPool(cDai_, fyDai_, name_, symbol_)
    {
        comptroller = comptroller_;
        comp = IERC20(comptroller_.getCompAddress());
        uniswap = uniswap_;
    }

    /// @dev Claim comp, sell it for Dai, and mint cDai which remains in the CPool reserves
    function harvest() public {
        // require(msg.sender == strategist || msg.sender == governance, "!authorized");
        IERC20 dai = IERC20(cDai.underlying());

        uint256 compAmount = claimComp();
        if (compAmount > 0) {
            // IERC20(comp).safeApprove(uni, 0);
            comp.approve(address(uniswap), compAmount);

            address[] memory path = new address[](3);
            path[0] = address(comp);
            path[1] = uniswap.WETH();
            path[2] = address(dai);

            uniswap.swapExactTokensForTokens(compAmount, uint256(0), path, address(this), block.timestamp + 1800); // Unlikely to overflow
        }
        uint256 daiAmount = dai.balanceOf(address(this));
        if (daiAmount > 0) {
            dai.approve(address(cDai), daiAmount);
            cDai.mint(daiAmount);
        }

        emit Harvested(compAmount, daiAmount);
    }

    /// @dev Claim all due Comp
    function claimComp() private returns (uint256) {
        address[] memory holders = new address[](1);
        holders[0] = address(this);
        address[] memory cTokens = new address[](1);
        cTokens[0] = address(cDai);

        comptroller.claimComp(holders, cTokens, false, true);

        return comp.balanceOf(address(this));
    }
}
