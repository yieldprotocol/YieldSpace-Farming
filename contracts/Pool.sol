// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./YieldMath.sol";
import "./helpers/Delegable.sol";
import "./helpers/DecimalMath.sol";
import "./helpers/SafeCast.sol";
import "./helpers/ERC20Permit.sol";
import "./interfaces/IDai.sol";
import "./interfaces/IFYDai.sol";
import "./interfaces/ICToken.sol";
import "./interfaces/IPool.sol";
import "./interfaces/IComptroller.sol";
import "./interfaces/ICToken.sol";
import "./interfaces/IUniswapV2Router.sol";
import "hardhat/console.sol";


/// @dev The Pool contract exchanges Dai for fyDai at a price defined by a specific formula.
contract Pool is IPool, Delegable, Ownable, ERC20Permit {
    using DecimalMath for uint256;
    using SafeMath for uint256;
    using SafeCast for uint256;

    event Trade(uint256 maturity, address indexed from, address indexed to, int256 daiTokens, int256 fyDaiTokens);
    event Liquidity(uint256 maturity, address indexed from, address indexed to, int256 daiTokens, int256 fyDaiTokens, int256 poolTokens);
    event Harvested(uint256 comp, uint256 dai);

    int128 constant public k = int128(uint256((1 << 64)) / 126144000); // 1 / Seconds in 4 years, in 64.64
    int128 constant public g1 = int128(uint256((950 << 64)) / 1000); // To be used when selling dai to the pool. All constants are `ufixed`, to divide them they must be converted to uint256
    int128 constant public g2 = int128(uint256((1000 << 64)) / 950); // To be used when selling fyDai to the pool. All constants are `ufixed`, to divide them they must be converted to uint256
    uint128 immutable public maturity;

    IDai public override dai;
    IFYDai public override fyDai;

    IERC20 public immutable comp;
    ICToken public cDai;
    IUniswapV2Router public immutable uniswap;
    IComptroller public immutable comptroller;

    uint256 harvested;

    constructor(ICToken cDai_, IFYDai fyDai_, IComptroller comptroller_, IUniswapV2Router uniswap_, string memory name_, string memory symbol_)
        ERC20Permit(name_, symbol_)
        Delegable()
        Ownable()
    {
        dai = IDai(cDai_.underlying());
        cDai = cDai_;
        fyDai = fyDai_;
        comptroller = comptroller_;
        comp = IERC20(comptroller_.getCompAddress());
        uniswap = uniswap_;

        maturity = fyDai.maturity().toUint128();

        dai.approve(address(cDai_), uint256(-1)); // Approve sending Dai to dai for minting
    }

    /// @dev Trading can only be done before maturity
    modifier beforeMaturity() {
        require(
            block.timestamp < maturity,
            "Pool: Too late"
        );
        _;
    }

    // TODO: Add this to a YieldSafeMath library
    /// @dev Overflow-protected addition, from OpenZeppelin
    function add(uint128 a, uint128 b)
        internal pure returns (uint128)
    {
        uint128 c = a + b;
        require(c >= a, "Pool: dai reserves too high");

        return c;
    }

    // TODO: Add this to a YieldSafeMath library
    /// @dev Overflow-protected substraction, from OpenZeppelin
    function sub(uint128 a, uint128 b) internal pure returns (uint128) {
        require(b <= a, "Pool: fyDai reserves too low");
        uint128 c = a - b;

        return c;
    }

    /// @dev Mint initial liquidity tokens.
    /// The liquidity provider needs to have called `dai.approve`
    /// @param daiIn The initial dai liquidity to provide.
    function init(uint256 daiIn)
        internal
        beforeMaturity
        returns (uint256)
    {
        require(
            totalSupply() == 0,
            "Pool: Already initialized"
        );
        // no fyDai transferred, because initial fyDai deposit is entirely virtual
        dai.transferFrom(msg.sender, address(this), daiIn);
        _mint(msg.sender, daiIn);
        emit Liquidity(maturity, msg.sender, msg.sender, -(daiIn.toInt256()), 0, daiIn.toInt256());

        return daiIn;
    }

    /// @dev Mint liquidity tokens in exchange for adding dai and fyDai
    /// The liquidity provider needs to have called `dai.approve` and `fyDai.approve`.
    /// @param from Wallet providing the dai and fyDai. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the minted liquidity tokens.
    /// @param daiOffered Amount of `dai` being invested, an appropriate amount of `fyDai` to be invested alongside will be calculated and taken by this function from the caller.
    /// @return The amount of liquidity tokens minted.
    function mint(address from, address to, uint256 daiOffered)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns (uint256)
    {
        uint256 supply = totalSupply();
        if (supply == 0) return init(daiOffered);

        uint256 daiReserves = dai.balanceOf(address(this));
        // use the actual reserves rather than the virtual reserves
        uint256 fyDaiReserves = fyDai.balanceOf(address(this));
        uint256 tokensMinted = supply.mul(daiOffered).div(daiReserves);
        uint256 fyDaiRequired = fyDaiReserves.mul(tokensMinted).div(supply);

        require(daiReserves.add(daiOffered) <= type(uint128).max); // daiReserves can't go over type(uint128).max
        require(supply.add(fyDaiReserves.add(fyDaiRequired)) <= type(uint128).max); // fyDaiReserves can't go over type(uint128).max

        require(dai.transferFrom(from, address(this), daiOffered));
        require(fyDai.transferFrom(from, address(this), fyDaiRequired));
        _mint(to, tokensMinted);
        emit Liquidity(maturity, from, to, -(daiOffered.toInt256()), -(fyDaiRequired.toInt256()), tokensMinted.toInt256());

        return tokensMinted;
    }

    /// @dev Burn liquidity tokens in exchange for dai and fyDai.
    /// The liquidity provider needs to have called `pool.approve`.
    /// @param from Wallet providing the liquidity tokens. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the dai and fyDai.
    /// @param tokensBurned Amount of liquidity tokens being burned.
    /// @return The amount of reserve tokens returned (daiTokens, fyDaiTokens).
    function burn(address from, address to, uint256 tokensBurned)
        external override
        beforeMaturity()
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns (uint256, uint256)
    {
        uint256 supply = totalSupply();
        uint256 daiReserves = dai.balanceOf(address(this));
        // use the actual reserves rather than the virtual reserves
        uint256 daiReturned;
        uint256 fyDaiReturned;
        { // avoiding stack too deep
            uint256 fyDaiReserves = fyDai.balanceOf(address(this));
            daiReturned = tokensBurned.mul(daiReserves).div(supply);
            fyDaiReturned = tokensBurned.mul(fyDaiReserves).div(supply);
        }

        _burn(from, tokensBurned);
        dai.transfer(to, daiReturned);
        fyDai.transfer(to, fyDaiReturned);
        emit Liquidity(maturity, from, to, daiReturned.toInt256(), fyDaiReturned.toInt256(), -(tokensBurned.toInt256()));

        return (daiReturned, fyDaiReturned);
    }

    /// @dev Hypothetical sell Dai for fyDai trade
    /// @param daiIn Amount of dai being sold that will be taken from the user's wallet
    /// @return Amount of fyDai that will be deposited on `to` wallet
    function sellDaiPreview(uint128 daiIn)
        external view
        beforeMaturity()
        returns(uint128)
    {
        return YieldMath.fyDaiOutForVYDaiIn(
            getDaiReserves(),
            getFYDaiReserves(),
            daiIn,
            (maturity - block.timestamp).toUint128(), // This can't be called after maturity
            k,
            g1
        );
    }

    /// @dev Sell dai for fyDai
    /// The trader needs to have called `dai.approve`
    /// @param from Wallet providing the dai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the fyDai being bought
    /// @param daiIn Amount of dai being sold that will be taken from the user's wallet
    /// @return Amount of fyDai that will be deposited on `to` wallet
    function sellDai(address from, address to, uint128 daiIn)
        external override
        beforeMaturity()
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 fyDaiOut = YieldMath.fyDaiOutForVYDaiIn(
            getDaiReserves(),
            getFYDaiReserves(),
            daiIn,
            (maturity - block.timestamp).toUint128(), // This can't be called after maturity
            k,
            g1
        );

        dai.transferFrom(from, address(this), daiIn);
        fyDai.transfer(to, fyDaiOut);
        emit Trade(maturity, from, to, -int256(daiIn), fyDaiOut);

        return fyDaiOut;
    }

    /// @dev Hypothetical buy Dai for fyDai trade
    /// @param daiOut Amount of dai being bought that will be deposited in `to` wallet
    /// @return Amount of fyDai that will be taken from `from` wallet
    function buyDaiPreview(uint128 daiOut)
        external view
        beforeMaturity()
        returns(uint128)
    {
        return YieldMath.fyDaiInForVYDaiOut(
            getDaiReserves(),
            getFYDaiReserves(),
            daiOut,
            (maturity - block.timestamp).toUint128(), // This can't be called after maturity
            k,
            g2
        );
    }

    /// @dev Buy dai for fyDai
    /// The trader needs to have called `fyDai.approve`
    /// @param from Wallet providing the fyDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the dai being bought
    /// @param daiOut Amount of dai being bought that will be deposited in `to` wallet
    /// @return Amount of fyDai that will be taken from `from` wallet
    function buyDai(address from, address to, uint128 daiOut)
        external override
        beforeMaturity()
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 fyDaiIn = YieldMath.fyDaiInForVYDaiOut(
            getDaiReserves(),
            getFYDaiReserves(),
            daiOut,
            (maturity - block.timestamp).toUint128(), // This can't be called after maturity
            k,
            g2
        );

        fyDai.transferFrom(from, address(this), fyDaiIn);
        dai.transfer(to, daiOut);
        emit Trade(maturity, from, to, daiOut, -int256(fyDaiIn));

        return fyDaiIn;
    }

    /// @dev Hypothetical sell fyDai for dai trade
    /// @param fyDaiIn Amount of fyDai being sold that will be taken from the user's wallet
    /// @return Amount of dai that will be deposited on `to` wallet
    function sellFYDaiPreview(uint128 fyDaiIn)
        external view
        beforeMaturity()
        returns(uint128)
    {
        return YieldMath.vyDaiOutForFYDaiIn(
            getDaiReserves(),
            getFYDaiReserves(),
            fyDaiIn,
            (maturity - block.timestamp).toUint128(), // This can't be called after maturity
            k,
            g2
        );
    }

    /// @dev Sell fyDai for dai
    /// The trader needs to have called `fyDai.approve`
    /// @param from Wallet providing the fyDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the dai being bought
    /// @param fyDaiIn Amount of fyDai being sold that will be taken from the user's wallet
    /// @return Amount of dai that will be deposited on `to` wallet
    function sellFYDai(address from, address to, uint128 fyDaiIn)
        external override
        beforeMaturity()
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 daiOut = YieldMath.vyDaiOutForFYDaiIn(
            getDaiReserves(),
            getFYDaiReserves(),
            fyDaiIn,
            (maturity - block.timestamp).toUint128(), // This can't be called after maturity
            k,
            g2
        );

        fyDai.transferFrom(from, address(this), fyDaiIn);
        dai.transfer(to, daiOut);
        emit Trade(maturity, from, to, daiOut, -int256(fyDaiIn));

        return daiOut;
    }

    /// @dev Hypothetical buy fyDai for dai trade
    /// @param fyDaiOut Amount of fyDai being bought that will be deposited in `to` wallet
    /// @return Amount of dai that will be taken from `from` wallet
    function buyFYDaiPreview(uint128 fyDaiOut)
        external view
        beforeMaturity()
        returns(uint128)
    {
        return YieldMath.vyDaiInForFYDaiOut(
            getDaiReserves(),
            getFYDaiReserves(),
            fyDaiOut,
            (maturity - block.timestamp).toUint128(), // This can't be called after maturity
            k,
            g1
        );
    }

    /// @dev Buy fyDai for dai
    /// The trader needs to have called `dai.approve`
    /// @param from Wallet providing the dai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the fyDai being bought
    /// @param fyDaiOut Amount of fyDai being bought that will be deposited in `to` wallet
    /// @return Amount of dai that will be taken from `from` wallet
    function buyFYDai(address from, address to, uint128 fyDaiOut)
        external override
        beforeMaturity()
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 daiIn = YieldMath.vyDaiInForFYDaiOut(
            getDaiReserves(),
            getFYDaiReserves(),
            fyDaiOut,
            (maturity - block.timestamp).toUint128(), // This can't be called after maturity
            k,
            g1
        );

        dai.transferFrom(from, address(this), daiIn);
        fyDai.transfer(to, fyDaiOut);
        emit Trade(maturity, from, to, -int256(daiIn), fyDaiOut);

        return daiIn;
    }

    /// @dev Returns the "virtual" fyDai reserves
    function getFYDaiReserves()
        public view override
        returns(uint128)
    {
        return fyDai.balanceOf(address(this)).add(totalSupply()).toUint128();
    }

    /// @dev Returns the dai reserves
    function getDaiReserves()
        public view override
        returns(uint128)
    {
        return dai.balanceOf(address(this)).toUint128();
    }

    /// @dev Claim comp, sell it for Dai, and mint dai which remains in the Pool reserves
    function harvest() public onlyOwner {

        uint256 compAmount = claimComp();
        if (compAmount == 0) return;
        
        // IERC20(comp).safeApprove(uni, 0);
        comp.approve(address(uniswap), compAmount);

        address[] memory path = new address[](3);
        path[0] = address(comp);
        path[1] = uniswap.WETH();
        path[2] = address(dai);

        uint256[] memory outputs = uniswap.swapExactTokensForTokens(compAmount, uint256(0), path, address(this), block.timestamp + 1800); // Unlikely to overflow
        
        harvested = harvested.add(outputs[3]);

        // invest if needed

        emit Harvested(compAmount, outputs[3]);
    }

    /// @dev Claim all due Comp
    function claimComp() private returns (uint256) {
        address[] memory holders = new address[](1);
        holders[0] = address(this);
        address[] memory cTokens = new address[](1);
        cTokens[0] = address(dai);

        comptroller.claimComp(holders, cTokens, false, true);

        return comp.balanceOf(address(this));
    }
}
