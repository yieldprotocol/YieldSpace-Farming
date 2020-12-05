// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.10;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../interfaces/IComptroller.sol";
import "../interfaces/ICToken.sol";
import "../interfaces/IUniswapV2Router.sol";

contract vycDai is ERC20 {
    using SafeMath for uint256;

    address public immutable comp;
    address public immutable dai;
    ICToken public immutable cdai;

    IUniswapV2Router public immutable uniswap;
    address public immutable weth; // used for comp <> weth <> dai route

    IComptroller public immutable comptroller;

    uint256 public earned;

    event Harvested(uint256 wantEarned, uint256 lifetimeEarned);

    constructor(IComptroller _comptroller, ICToken _cdai, IUniswapV2Router _uniswap)
        public ERC20("VY cDai", "vycDai")
    {
        comptroller = _comptroller;
        comp = _comptroller.getCompAddress();
        cdai = _cdai;
        dai = _cdai.underlying();
        uniswap = _uniswap;
        weth = _uniswap.WETH();
    }

    function depositAll() external {
        deposit(cdai.balanceOf(msg.sender));
    }

    function deposit(uint256 _amount) public {
        uint256 _pool = balance();
        cdai.transferFrom(msg.sender, address(this), _amount);

        uint256 shares = 0;
        if (totalSupply() == 0) {
            shares = _amount;
        } else {
            shares = (_amount.mul(totalSupply())).div(_pool);
        }
        _mint(msg.sender, shares);
    }

    function withdrawAll() external {
        withdraw(balanceOf(msg.sender));
    }

    // No rebalance implementation for lower fees and faster swaps
    function withdraw(uint256 _shares) public {
        uint256 r = (balance().mul(_shares)).div(totalSupply());
        _burn(msg.sender, _shares);

        cdai.transfer(msg.sender, r);
    }

    function getPricePerFullShare() public view returns (uint256) {
        return balance().mul(1e18).div(totalSupply());
    }

    function balanceOfUnderlying(address _account) public view returns (uint256) {
        return (balance().mul(balanceOf(_account))).div(totalSupply());
    }

    function balance() private view returns (uint256) {
        return cdai.balanceOf(address(this));
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

            uniswap.swapExactTokensForTokens(_comp, uint256(0), path, address(this), now.add(1800));
        }
        uint256 _dai = IERC20(dai).balanceOf(address(this));
        if (_dai > 0) {
            IERC20(dai).approve(address(cdai), _dai);
            cdai.mint(_dai);
        }
        earned = earned.add(_dai);
        emit Harvested(_dai, earned);
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
