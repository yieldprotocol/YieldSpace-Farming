// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../interfaces/IComptroller.sol";
import "../interfaces/ICToken.sol";
import "../interfaces/IUniswapV2Router.sol";

import "../CPool.sol";

/// @dev CPoolStrategy is a CPool that allows for Comp rewards to be harvested and converted to cDai, which is added to the reserves.
contract CPoolStrategy is CPool {
    using SafeMath for uint256;

    address public immutable comp;
    address public immutable dai;
    ICToken public immutable cdai;

    IUniswapV2Router public immutable uniswap;
    address public immutable weth; // used for comp <> weth <> dai route

    IComptroller public immutable comptroller;

    event Harvested(uint256 wantEarned, uint256 lifetimeEarned);

    constructor(ICToken cDai_, IFYDai fyDai_, IComptroller comptroller_, IUniswapV2Router uniswap_, string memory name_, string memory symbol_)
        CPool(cDai_, fyDai_, name_, symbol_)
    {
        comptroller = comptroller_;
        comp = comptroller_.getCompAddress();
        dai = cDai_.underlying();
        uniswap = uniswap_;
        weth = uniswap_.WETH();
    }

    function harvest() public {
        // require(msg.sender == strategist || msg.sender == governance, "!authorized");

        uint256 _comp = claimComp();
        if (_comp > 0) {
            // IERC20(comp).safeApprove(uni, 0);
            IERC20(comp).approve(address(uniswap), _comp);

            address[] memory path = new address[](3);
            path[0] = comp;
            path[1] = weth;
            path[2] = dai;

            uniswap.swapExactTokensForTokens(_comp, uint256(0), path, address(this), block.timestamp.add(1800));
        }
        uint256 _dai = IERC20(dai).balanceOf(address(this));
        if (_dai > 0) {
            IERC20(dai).approve(address(cdai), _dai);
            cdai.mint(_dai);
        }

        emit Harvested(_dai, _dai);
    }

    function claimComp() private returns (uint256) {
        address[] memory holders = new address[](1);
        holders[0] = address(this);
        address[] memory cTokens = new address[](1);
        cTokens[0] = address(cdai);

        comptroller.claimComp(holders, cTokens, false, true);

        return IERC20(comp).balanceOf(address(this));
    }
}
