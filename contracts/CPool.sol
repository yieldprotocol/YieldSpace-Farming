// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./VariableYieldMath.sol";
import "./helpers/Delegable.sol";
import "./helpers/ERC20Permit.sol";
import "./interfaces/IFYDai.sol";
import "./interfaces/ICToken.sol";
import "./interfaces/ICPool.sol";


/// @dev The CPool contract exchanges cDai for fyDai at a price defined by a specific formula.
contract CPool is ICPool, Delegable(), ERC20Permit {
    using SafeMath for uint256;

    event Trade(uint256 maturity, address indexed from, address indexed to, int256 cDaiTokens, int256 fyDaiTokens);
    event Liquidity(uint256 maturity, address indexed from, address indexed to, int256 cDaiTokens, int256 fyDaiTokens, int256 poolTokens);

    int128 constant public k = int128(uint256((1 << 64)) / 126144000); // 1 / Seconds in 4 years, in 64.64
    int128 constant public g1 = int128(uint256((950 << 64)) / 1000); // To be used when selling cDai to the pool. All constants are `ufixed`, to divide them they must be converted to uint256
    int128 constant public g2 = int128(uint256((1000 << 64)) / 950); // To be used when selling fyDai to the pool. All constants are `ufixed`, to divide them they must be converted to uint256
    uint128 immutable public maturity;
    int128 immutable public c0;

    ICToken public override cDai;
    IFYDai public override fyDai;

    constructor(ICToken cDai_, IFYDai fyDai_, string memory name_, string memory symbol_)
        public
        ERC20Permit(name_, symbol_)
    {
        cDai = cDai_;
        fyDai = fyDai_;

        maturity = toUint128(fyDai.maturity());
        c0 = int128((cDai.exchangeRateCurrent() << 64) / 10 ** 27); // Initially RAY, converted to 64.64
    }

    /// @dev Trading can only be done before maturity
    modifier beforeMaturity() {
        require(
            block.timestamp < maturity,
            "Pool: Too late"
        );
        _;
    }

    /// @dev Overflow-protected addition, from OpenZeppelin
    function add(uint128 a, uint128 b)
        internal pure returns (uint128)
    {
        uint128 c = a + b;
        require(c >= a, "Pool: cDai reserves too high");

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
    /// The liquidity provider needs to have called `cDai.approve`
    /// @param cDaiIn The initial cDai liquidity to provide.
    function init(uint256 cDaiIn)
        internal
        beforeMaturity
        returns (uint256)
    {
        require(
            totalSupply() == 0,
            "Pool: Already initialized"
        );
        // no fyDai transferred, because initial fyDai deposit is entirely virtual
        cDai.transferFrom(msg.sender, address(this), cDaiIn);
        _mint(msg.sender, cDaiIn);
        emit Liquidity(maturity, msg.sender, msg.sender, -toInt256(cDaiIn), 0, toInt256(cDaiIn));

        return cDaiIn;
    }

    /// @dev Mint liquidity tokens in exchange for adding cDai and fyDai
    /// The liquidity provider needs to have called `cDai.approve` and `fyDai.approve`.
    /// @param from Wallet providing the cDai and fyDai. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the minted liquidity tokens.
    /// @param cDaiOffered Amount of `cDai` being invested, an appropriate amount of `fyDai` to be invested alongside will be calculated and taken by this function from the caller.
    /// @return The amount of liquidity tokens minted.
    function mint(address from, address to, uint256 cDaiOffered)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns (uint256)
    {
        uint256 supply = totalSupply();
        if (supply == 0) return init(cDaiOffered);

        uint256 cDaiReserves = cDai.balanceOf(address(this));
        // use the actual reserves rather than the virtual reserves
        uint256 fyDaiReserves = fyDai.balanceOf(address(this));
        uint256 tokensMinted = supply.mul(cDaiOffered).div(cDaiReserves);
        uint256 fyDaiRequired = fyDaiReserves.mul(tokensMinted).div(supply);

        require(cDaiReserves.add(cDaiOffered) <= type(uint128).max); // cDaiReserves can't go over type(uint128).max
        require(supply.add(fyDaiReserves.add(fyDaiRequired)) <= type(uint128).max); // fyDaiReserves can't go over type(uint128).max

        require(cDai.transferFrom(from, address(this), cDaiOffered));
        require(fyDai.transferFrom(from, address(this), fyDaiRequired));
        _mint(to, tokensMinted);
        emit Liquidity(maturity, from, to, -toInt256(cDaiOffered), -toInt256(fyDaiRequired), toInt256(tokensMinted));

        return tokensMinted;
    }

    /// @dev Burn liquidity tokens in exchange for cDai and fyDai.
    /// The liquidity provider needs to have called `pool.approve`.
    /// @param from Wallet providing the liquidity tokens. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the cDai and fyDai.
    /// @param tokensBurned Amount of liquidity tokens being burned.
    /// @return The amount of reserve tokens returned (cDaiTokens, fyDaiTokens).
    function burn(address from, address to, uint256 tokensBurned)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns (uint256, uint256)
    {
        uint256 supply = totalSupply();
        uint256 cDaiReserves = cDai.balanceOf(address(this));
        // use the actual reserves rather than the virtual reserves
        uint256 cDaiReturned;
        uint256 fyDaiReturned;
        { // avoiding stack too deep
            uint256 fyDaiReserves = fyDai.balanceOf(address(this));
            cDaiReturned = tokensBurned.mul(cDaiReserves).div(supply);
            fyDaiReturned = tokensBurned.mul(fyDaiReserves).div(supply);
        }

        _burn(from, tokensBurned);
        cDai.transfer(to, cDaiReturned);
        fyDai.transfer(to, fyDaiReturned);
        emit Liquidity(maturity, from, to, toInt256(cDaiReturned), toInt256(fyDaiReturned), -toInt256(tokensBurned));

        return (cDaiReturned, fyDaiReturned);
    }

    /// @dev Sell cDai for fyDai
    /// The trader needs to have called `cDai.approve`
    /// @param from Wallet providing the cDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the fyDai being bought
    /// @param cDaiIn Amount of cDai being sold that will be taken from the user's wallet
    /// @return Amount of fyDai that will be deposited on `to` wallet
    function sellCDai(address from, address to, uint128 cDaiIn)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 fyDaiOut = sellCDaiCurrent(cDaiIn);

        cDai.transferFrom(from, address(this), cDaiIn);
        fyDai.transfer(to, fyDaiOut);
        emit Trade(maturity, from, to, -toInt256(cDaiIn), toInt256(fyDaiOut));

        return fyDaiOut;
    }

    /// @dev Returns how much fyDai would be obtained by selling `cDaiIn` cDai with the stored exchange rate
    /// @param cDaiIn Amount of cDai hypothetically sold.
    /// @return Amount of fyDai hypothetically bought.
    function sellCDaiPreview(uint128 cDaiIn)
        public view override
        returns(uint128)
    {
        return sellCDaiAtRate(cDaiIn, int128((cDai.exchangeRateStored() << 64) / 10 ** 27));
    }

    /// @dev Returns how much fyDai would be obtained by selling `cDaiIn` cDai, updating the exchange rate
    /// @param cDaiIn Amount of cDai hypothetically sold.
    /// @return Amount of fyDai hypothetically bought.
    function sellCDaiCurrent(uint128 cDaiIn)
        public override
        returns(uint128)
    {
        return sellCDaiAtRate(cDaiIn, int128((cDai.exchangeRateCurrent() << 64) / 10 ** 27));
    }

    /// @dev Returns how much fyDai would be obtained by selling `cDaiIn` cDai at a given exchange rate.
    /// @param cDaiIn Amount of cDai hypothetically sold.
    /// @param exchangeRate cDai/Dai exchange rate, in 64.64
    /// @return Amount of fyDai hypothetically bought.
    function sellCDaiAtRate(uint128 cDaiIn, int128 exchangeRate)
        public view override
        beforeMaturity
        returns(uint128)
    {
        uint128 cDaiReserves = getCDaiReserves();
        uint128 fyDaiReserves = getFYDaiReserves();

        uint128 fyDaiOut = VariableYieldMath.fyDaiOutForVYDaiInNormalized(
            cDaiReserves,
            fyDaiReserves,
            cDaiIn,
            toUint128(maturity - block.timestamp), // This can't be called after maturity
            k,
            g1,
            c0,
            exchangeRate
        );

        require(
            sub(fyDaiReserves, fyDaiOut) >= add(cDaiReserves, cDaiIn),
            "Pool: fyDai reserves too low"
        );

        return fyDaiOut;
    }

    /// @dev Buy cDai for fyDai
    /// The trader needs to have called `fyDai.approve`
    /// @param from Wallet providing the fyDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the cDai being bought
    /// @param cDaiOut Amount of cDai being bought that will be deposited in `to` wallet
    /// @return Amount of fyDai that will be taken from `from` wallet
    function buyCDai(address from, address to, uint128 cDaiOut)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 fyDaiIn = buyCDaiCurrent(cDaiOut);

        fyDai.transferFrom(from, address(this), fyDaiIn);
        cDai.transfer(to, cDaiOut);
        emit Trade(maturity, from, to, toInt256(cDaiOut), -toInt256(fyDaiIn));

        return fyDaiIn;
    }

    /// @dev Returns how much fyDai would be required to buy `cDaiOut` cDai with the stored exchange rate
    /// @param cDaiOut Amount of cDai hypothetically desired.
    /// @return Amount of fyDai hypothetically required.
    function buyCDaiPreview(uint128 cDaiOut)
        public view override
        returns(uint128)
    {
        return buyCDaiAtRate(cDaiOut, int128((cDai.exchangeRateStored() << 64) / 10 ** 27));
    }

    /// @dev Returns how much fyDai would be required to buy `cDaiOut` cDai, updating the exchange rate
    /// @param cDaiOut Amount of cDai hypothetically desired.
    /// @return Amount of fyDai hypothetically required.
    function buyCDaiCurrent(uint128 cDaiOut)
        public override
        returns(uint128)
    {
        return buyCDaiAtRate(cDaiOut, int128((cDai.exchangeRateCurrent() << 64) / 10 ** 27));
    }

    /// @dev Returns how much fyDai would be required to buy `cDaiOut` cDai at a given exchange rate.
    /// @param cDaiOut Amount of cDai hypothetically desired.
    /// @param exchangeRate cDai/Dai exchange rate, in 64.64
    /// @return Amount of fyDai hypothetically required.
    function buyCDaiAtRate(uint128 cDaiOut, int128 exchangeRate)
        public view override
        beforeMaturity
        returns(uint128)
    {
        return VariableYieldMath.fyDaiInForVYDaiOutNormalized(
            getCDaiReserves(),
            getFYDaiReserves(),
            cDaiOut,
            toUint128(maturity - block.timestamp), // This can't be called after maturity
            k,
            g2,
            c0,
            exchangeRate
        );
    }

    /// @dev Sell fyDai for cDai
    /// The trader needs to have called `fyDai.approve`
    /// @param from Wallet providing the fyDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the cDai being bought
    /// @param fyDaiIn Amount of fyDai being sold that will be taken from the user's wallet
    /// @return Amount of cDai that will be deposited on `to` wallet
    function sellFYDai(address from, address to, uint128 fyDaiIn)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 cDaiOut = sellFYDaiCurrent(fyDaiIn);

        fyDai.transferFrom(from, address(this), fyDaiIn);
        cDai.transfer(to, cDaiOut);
        emit Trade(maturity, from, to, toInt256(cDaiOut), -toInt256(fyDaiIn));

        return cDaiOut;
    }

    /// @dev Returns how much cDai would be obtained by selling `fyDaiIn` fyDai with the stored exchange rate
    /// @param fyDaiIn Amount of fyDai hypothetically sold.
    /// @return Amount of cDai hypothetically bought.
    function sellFYDaiPreview(uint128 fyDaiIn)
        public view override
        returns(uint128)
    {
        return sellFYDaiAtRate(fyDaiIn, int128((cDai.exchangeRateStored() << 64) / 10 ** 27));
    }

    /// @dev Returns how much cDai would be obtained by selling `fyDaiIn` fyDai, updating the exchange rate
    /// @param fyDaiIn Amount of fyDai hypothetically sold.
    /// @return Amount of cDai hypothetically bought.
    function sellFYDaiCurrent(uint128 fyDaiIn)
        public override
        returns(uint128)
    {
        return sellFYDaiAtRate(fyDaiIn, int128((cDai.exchangeRateCurrent() << 64) / 10 ** 27));
    }

    /// @dev Returns how much cDai would be obtained by selling `fyDaiIn` fyDai.
    /// @param fyDaiIn Amount of fyDai hypothetically sold.
    /// @param exchangeRate cDai/Dai exchange rate, in 64.64
    /// @return Amount of cDai hypothetically bought.
    function sellFYDaiAtRate(uint128 fyDaiIn, int128 exchangeRate)
        public view override
        beforeMaturity
        returns(uint128)
    {
        return VariableYieldMath.vyDaiOutForFYDaiInNormalized(
            getCDaiReserves(),
            getFYDaiReserves(),
            fyDaiIn,
            toUint128(maturity - block.timestamp), // This can't be called after maturity
            k,
            g2,
            c0,
            exchangeRate
        );
    }

    /// @dev Buy fyDai for cDai
    /// The trader needs to have called `cDai.approve`
    /// @param from Wallet providing the cDai being sold. Must have approved the operator with `pool.addDelegate(operator)`.
    /// @param to Wallet receiving the fyDai being bought
    /// @param fyDaiOut Amount of fyDai being bought that will be deposited in `to` wallet
    /// @return Amount of cDai that will be taken from `from` wallet
    function buyFYDai(address from, address to, uint128 fyDaiOut)
        external override
        onlyHolderOrDelegate(from, "Pool: Only Holder Or Delegate")
        returns(uint128)
    {
        uint128 cDaiIn = buyFYDaiCurrent(fyDaiOut);

        cDai.transferFrom(from, address(this), cDaiIn);
        fyDai.transfer(to, fyDaiOut);
        emit Trade(maturity, from, to, -toInt256(cDaiIn), toInt256(fyDaiOut));

        return cDaiIn;
    }

    /// @dev Returns how much cDai would be required to buy `fyDaiOut` fyDai with the stored exchange rate
    /// @param fyDaiOut Amount of fyDai hypothetically desired.
    /// @return Amount of cDai hypothetically required.
    function buyFYDaiPreview(uint128 fyDaiOut)
        public view override
        returns(uint128)
    {
        return buyFYDaiAtRate(fyDaiOut, int128((cDai.exchangeRateStored() << 64) / 10 ** 27));
    }

    /// @dev Returns how much cDai would be required to buy `fyDaiOut` fyDai, updating the exchange rate
    /// @param fyDaiOut Amount of fyDai hypothetically desired.
    /// @return Amount of cDai hypothetically required.
    function buyFYDaiCurrent(uint128 fyDaiOut)
        public override
        returns(uint128)
    {
        return buyFYDaiAtRate(fyDaiOut, int128((cDai.exchangeRateCurrent() << 64) / 10 ** 27));
    }

    /// @dev Returns how much cDai would be required to buy `fyDaiOut` fyDai.
    /// @param fyDaiOut Amount of fyDai hypothetically desired.
    /// @param exchangeRate cDai/Dai exchange rate, in 64.64
    /// @return Amount of cDai hypothetically required.
    function buyFYDaiAtRate(uint128 fyDaiOut, int128 exchangeRate)
        public view override
        beforeMaturity
        returns(uint128)
    {
        uint128 cDaiReserves = getCDaiReserves();
        uint128 fyDaiReserves = getFYDaiReserves();

        uint128 cDaiIn = VariableYieldMath.vyDaiInForFYDaiOutNormalized(
            cDaiReserves,
            fyDaiReserves,
            fyDaiOut,
            toUint128(maturity - block.timestamp), // This can't be called after maturity
            k,
            g1,
            c0,
            exchangeRate
        );

        require(
            sub(fyDaiReserves, fyDaiOut) >= add(cDaiReserves, cDaiIn),
            "Pool: fyDai reserves too low"
        );

        return cDaiIn;
    }

    /// @dev Returns the "virtual" fyDai reserves
    function getFYDaiReserves()
        public view override
        returns(uint128)
    {
        return toUint128(fyDai.balanceOf(address(this)).add(totalSupply()));
    }

    /// @dev Returns the cDai reserves
    function getCDaiReserves()
        public view override
        returns(uint128)
    {
        return toUint128(cDai.balanceOf(address(this)));
    }
}
