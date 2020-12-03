// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.10;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./VariableYieldMath.sol";
import "./helpers/Delegable.sol";
import "./helpers/ERC20Permit.sol";
import "./interfaces/IPot.sol";
import "./interfaces/IFYDai.sol";
import "./interfaces/IVYDai.sol";
import "./interfaces/IVYPool.sol";


/// @dev The VYPool contract exchanges vyDai for fyDai at a price defined by a specific formula.
contract VYPool is IVYPool, Delegable(), ERC20Permit {

    event Trade(uint256 maturity, address indexed from, address indexed to, int256 vyDaiTokens, int256 fyDaiTokens);
    event Liquidity(uint256 maturity, address indexed from, address indexed to, int256 vyDaiTokens, int256 fyDaiTokens, int256 poolTokens);

    int128 constant public k = int128(uint256((1 << 64)) / 126144000); // 1 / Seconds in 4 years, in 64.64
    int128 constant public g1 = int128(uint256((950 << 64)) / 1000); // To be used when selling vyDai to the pool. All constants are `ufixed`, to divide them they must be converted to uint256
    int128 constant public g2 = int128(uint256((1000 << 64)) / 950); // To be used when selling fyDai to the pool. All constants are `ufixed`, to divide them they must be converted to uint256
    uint128 immutable public maturity;
    int128 immutable public c0;

    IVYDai public override vyDai;
    IFYDai public override fyDai;

    constructor(IVYDai vyDai_, IFYDai fyDai_, string memory name_, string memory symbol_)
        public
        ERC20Permit(name_, symbol_)
    {
        vyDai = vyDai_;
        fyDai = fyDai_;

        maturity = toUint128(fyDai.maturity());
        c0 = int128((vyDai.exchangeRate() << 64) / 10 ** 27); // Initially RAY, converted to 64.64
    }

    /// @dev Trading can only be done before maturity
    modifier beforeMaturity() {
        require(
            now < maturity,
            "Pool: Too late"
        );
        _;
    }

    /// @dev Overflow-protected addition, from OpenZeppelin
    function add(uint128 a, uint128 b)
        internal pure returns (uint128)
    {
        uint128 c = a + b;
        require(c >= a, "Pool: vyDai reserves too high");

        return c;
    }

    /// @dev Overflow-protected substraction, from OpenZeppelin
    function sub(uint128 a, uint128 b) internal pure returns (uint128) {
        require(b <= a, "Pool: fyDai reserves too low");
        uint128 c = a - b;

        return c;
    }

    /// @dev Safe casting from uint256 to uint128
    function toUint128(uint256 x) internal pure returns(uint128) {
        require(
            x <= type(uint128).max,
            "Pool: Cast overflow"
        );
        return uint128(x);
    }

    /// @dev Safe casting from uint256 to int256
    function toInt256(uint256 x) internal pure returns(int256) {
        require(
            x <= uint256(type(int256).max),
            "Pool: Cast overflow"
        );
        return int256(x);
    }

    /// @dev Mint initial liquidity tokens.
    /// The liquidity provider needs to have called `vyDai.approve`
    /// @param vyDaiIn The initial vyDai liquidity to provide.
    function init(uint256 vyDaiIn)
        internal
        beforeMaturity
        returns (uint256)
    {
        require(
            totalSupply() == 0,
            "Pool: Already initialized"
        );
        // no fyDai transferred, because initial fyDai deposit is entirely virtual
        vyDai.transferFrom(msg.sender, address(this), vyDaiIn);
        _mint(msg.sender, vyDaiIn);
        emit Liquidity(maturity, msg.sender, msg.sender, -toInt256(vyDaiIn), 0, toInt256(vyDaiIn));

        return vyDaiIn;
    }

    /// @dev Mint liquidity tokens in exchange for adding vyDai and fyDai
    /// The liquidity provider needs to have called `vyDai.approve` and `fyDai.approve`.
    /// @param from Wallet providing the vyDai and fyDai. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the minted liquidity tokens.
    /// @param vyDaiOffered Amount of `vyDai` being invested, an appropriate amount of `fyDai` to be invested alongside will be calculated and taken by this function from the caller.
    /// @return The amount of liquidity tokens minted.
    function mint(address from, address to, uint256 vyDaiOffered)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns (uint256)
    {
        uint256 supply = totalSupply();
        if (supply == 0) return init(vyDaiOffered);

        uint256 vyDaiReserves = vyDai.balanceOf(address(this));
        // use the actual reserves rather than the virtual reserves
        uint256 fyDaiReserves = fyDai.balanceOf(address(this));
        uint256 tokensMinted = supply.mul(vyDaiOffered).div(vyDaiReserves);
        uint256 fyDaiRequired = fyDaiReserves.mul(tokensMinted).div(supply);

        require(vyDaiReserves.add(vyDaiOffered) <= type(uint128).max); // vyDaiReserves can't go over type(uint128).max
        require(supply.add(fyDaiReserves.add(fyDaiRequired)) <= type(uint128).max); // fyDaiReserves can't go over type(uint128).max

        require(vyDai.transferFrom(from, address(this), vyDaiOffered));
        require(fyDai.transferFrom(from, address(this), fyDaiRequired));
        _mint(to, tokensMinted);
        emit Liquidity(maturity, from, to, -toInt256(vyDaiOffered), -toInt256(fyDaiRequired), toInt256(tokensMinted));

        return tokensMinted;
    }

    /// @dev Burn liquidity tokens in exchange for vyDai and fyDai.
    /// The liquidity provider needs to have called `pool.approve`.
    /// @param from Wallet providing the liquidity tokens. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the vyDai and fyDai.
    /// @param tokensBurned Amount of liquidity tokens being burned.
    /// @return The amount of reserve tokens returned (vyDaiTokens, fyDaiTokens).
    function burn(address from, address to, uint256 tokensBurned)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns (uint256, uint256)
    {
        uint256 supply = totalSupply();
        uint256 vyDaiReserves = vyDai.balanceOf(address(this));
        // use the actual reserves rather than the virtual reserves
        uint256 vyDaiReturned;
        uint256 fyDaiReturned;
        { // avoiding stack too deep
            uint256 fyDaiReserves = fyDai.balanceOf(address(this));
            vyDaiReturned = tokensBurned.mul(vyDaiReserves).div(supply);
            fyDaiReturned = tokensBurned.mul(fyDaiReserves).div(supply);
        }

        _burn(from, tokensBurned);
        vyDai.transfer(to, vyDaiReturned);
        fyDai.transfer(to, fyDaiReturned);
        emit Liquidity(maturity, from, to, toInt256(vyDaiReturned), toInt256(fyDaiReturned), -toInt256(tokensBurned));

        return (vyDaiReturned, fyDaiReturned);
    }

    /// @dev Sell vyDai for fyDai
    /// The trader needs to have called `vyDai.approve`
    /// @param from Wallet providing the vyDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the fyDai being bought
    /// @param vyDaiIn Amount of vyDai being sold that will be taken from the user's wallet
    /// @return Amount of fyDai that will be deposited on `to` wallet
    function sellVYDai(address from, address to, uint128 vyDaiIn)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 fyDaiOut = sellVYDaiPreview(vyDaiIn);

        vyDai.transferFrom(from, address(this), vyDaiIn);
        fyDai.transfer(to, fyDaiOut);
        emit Trade(maturity, from, to, -toInt256(vyDaiIn), toInt256(fyDaiOut));

        return fyDaiOut;
    }

    /// @dev Returns how much fyDai would be obtained by selling `vyDaiIn` vyDai
    /// @param vyDaiIn Amount of vyDai hypothetically sold.
    /// @return Amount of fyDai hypothetically bought.
    function sellVYDaiPreview(uint128 vyDaiIn)
        public view override
        beforeMaturity
        returns(uint128)
    {
        uint128 vyDaiReserves = getVYDaiReserves();
        uint128 fyDaiReserves = getFYDaiReserves();

        uint128 fyDaiOut = VariableYieldMath.fyDaiOutForVYDaiInNormalized(
            vyDaiReserves,
            fyDaiReserves,
            vyDaiIn,
            toUint128(maturity - now), // This can't be called after maturity
            k,
            g1,
            c0,
            int128((vyDai.exchangeRate() << 64) / 10 ** 27)
        );

        require(
            sub(fyDaiReserves, fyDaiOut) >= add(vyDaiReserves, vyDaiIn),
            "Pool: fyDai reserves too low"
        );

        return fyDaiOut;
    }

    /// @dev Buy vyDai for fyDai
    /// The trader needs to have called `fyDai.approve`
    /// @param from Wallet providing the fyDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the vyDai being bought
    /// @param vyDaiOut Amount of vyDai being bought that will be deposited in `to` wallet
    /// @return Amount of fyDai that will be taken from `from` wallet
    function buyVYDai(address from, address to, uint128 vyDaiOut)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 fyDaiIn = buyVYDaiPreview(vyDaiOut);

        fyDai.transferFrom(from, address(this), fyDaiIn);
        vyDai.transfer(to, vyDaiOut);
        emit Trade(maturity, from, to, toInt256(vyDaiOut), -toInt256(fyDaiIn));

        return fyDaiIn;
    }

    /// @dev Returns how much fyDai would be required to buy `vyDaiOut` vyDai.
    /// @param vyDaiOut Amount of vyDai hypothetically desired.
    /// @return Amount of fyDai hypothetically required.
    function buyVYDaiPreview(uint128 vyDaiOut)
        public view override
        beforeMaturity
        returns(uint128)
    {
        return VariableYieldMath.fyDaiInForVYDaiOutNormalized(
            getVYDaiReserves(),
            getFYDaiReserves(),
            vyDaiOut,
            toUint128(maturity - now), // This can't be called after maturity
            k,
            g2,
            c0,
            int128((vyDai.exchangeRate() << 64) / 10 ** 27)
        );
    }

    /// @dev Sell fyDai for vyDai
    /// The trader needs to have called `fyDai.approve`
    /// @param from Wallet providing the fyDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the vyDai being bought
    /// @param fyDaiIn Amount of fyDai being sold that will be taken from the user's wallet
    /// @return Amount of vyDai that will be deposited on `to` wallet
    function sellFYDai(address from, address to, uint128 fyDaiIn)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 vyDaiOut = sellFYDaiPreview(fyDaiIn);

        fyDai.transferFrom(from, address(this), fyDaiIn);
        vyDai.transfer(to, vyDaiOut);
        emit Trade(maturity, from, to, toInt256(vyDaiOut), -toInt256(fyDaiIn));

        return vyDaiOut;
    }

    /// @dev Returns how much vyDai would be obtained by selling `fyDaiIn` fyDai.
    /// @param fyDaiIn Amount of fyDai hypothetically sold.
    /// @return Amount of vyDai hypothetically bought.
    function sellFYDaiPreview(uint128 fyDaiIn)
        public view override
        beforeMaturity
        returns(uint128)
    {
        return VariableYieldMath.vyDaiOutForFYDaiInNormalized(
            getVYDaiReserves(),
            getFYDaiReserves(),
            fyDaiIn,
            toUint128(maturity - now), // This can't be called after maturity
            k,
            g2,
            c0,
            int128((vyDai.exchangeRate() << 64) / 10 ** 27)
        );
    }

    /// @dev Buy fyDai for vyDai
    /// The trader needs to have called `vyDai.approve`
    /// @param from Wallet providing the vyDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the fyDai being bought
    /// @param fyDaiOut Amount of fyDai being bought that will be deposited in `to` wallet
    /// @return Amount of vyDai that will be taken from `from` wallet
    function buyFYDai(address from, address to, uint128 fyDaiOut)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 vyDaiIn = buyFYDaiPreview(fyDaiOut);

        vyDai.transferFrom(from, address(this), vyDaiIn);
        fyDai.transfer(to, fyDaiOut);
        emit Trade(maturity, from, to, -toInt256(vyDaiIn), toInt256(fyDaiOut));

        return vyDaiIn;
    }


    /// @dev Returns how much vyDai would be required to buy `fyDaiOut` fyDai.
    /// @param fyDaiOut Amount of fyDai hypothetically desired.
    /// @return Amount of vyDai hypothetically required.
    function buyFYDaiPreview(uint128 fyDaiOut)
        public view override
        beforeMaturity
        returns(uint128)
    {
        uint128 vyDaiReserves = getVYDaiReserves();
        uint128 fyDaiReserves = getFYDaiReserves();

        uint128 vyDaiIn = VariableYieldMath.vyDaiInForFYDaiOutNormalized(
            vyDaiReserves,
            fyDaiReserves,
            fyDaiOut,
            toUint128(maturity - now), // This can't be called after maturity
            k,
            g1,
            c0,
            int128((vyDai.exchangeRate() << 64) / 10 ** 27)
        );

        require(
            sub(fyDaiReserves, fyDaiOut) >= add(vyDaiReserves, vyDaiIn),
            "Pool: fyDai reserves too low"
        );

        return vyDaiIn;
    }

    /// @dev Returns the "virtual" fyDai reserves
    function getFYDaiReserves()
        public view override
        returns(uint128)
    {
        return toUint128(fyDai.balanceOf(address(this)).add(totalSupply()));
    }

    /// @dev Returns the vyDai reserves
    function getVYDaiReserves()
        public view override
        returns(uint128)
    {
        return toUint128(vyDai.balanceOf(address(this)));
    }
}
