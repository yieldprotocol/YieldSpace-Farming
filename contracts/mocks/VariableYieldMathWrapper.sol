// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.7.0;

import "../VariableYieldMath.sol";

/**
 * Wrapper for the Variable Yield Math Smart Contract Library.
 */
contract VariableYieldMathWrapper {
  /**
   * Calculate the amount of fyDai a user would get for given amount of DAI.
   *
   * @param vyDaiReserves DAI reserves amount
   * @param fyDaiReserves fyDai reserves amount
   * @param vyDaiAmount DAI amount to be traded
   * @param timeTillMaturity time till maturity in seconds
   * @param k time till maturity coefficient, multiplied by 2^64
   * @param g fee coefficient, multiplied by 2^64
   * @param c vyDai price in terms of dai, multiplied by 2^64
   * @return the amount of fyDai a user would get for given amount of DAI
   */
  function fyDaiOutForVYDaiIn(
    uint128 vyDaiReserves, uint128 fyDaiReserves, uint128 vyDaiAmount,
    uint128 timeTillMaturity, int128 k, int128 g, int128 c)
  public pure returns(uint128) {
    return VariableYieldMath.fyDaiOutForVYDaiIn(
      vyDaiReserves, fyDaiReserves, vyDaiAmount, timeTillMaturity, k, g, c
    );
  }

  /**
   * Calculate the amount of DAI a user would get for certain amount of fyDai.
   *
   * @param vyDaiReserves DAI reserves amount
   * @param fyDaiReserves fyDai reserves amount
   * @param fyDaiAmount fyDai amount to be traded
   * @param timeTillMaturity time till maturity in seconds
   * @param k time till maturity coefficient, multiplied by 2^64
   * @param g fee coefficient, multiplied by 2^64
   * @param c vyDai price in terms of dai, multiplied by 2^64
   * @return the amount of DAI a user would get for given amount of fyDai
   */
  function vyDaiOutForFYDaiIn(
    uint128 vyDaiReserves, uint128 fyDaiReserves, uint128 fyDaiAmount,
    uint128 timeTillMaturity, int128 k, int128 g, int128 c)
  public pure returns(uint128) {
    return VariableYieldMath.vyDaiOutForFYDaiIn(
      vyDaiReserves, fyDaiReserves, fyDaiAmount, timeTillMaturity, k, g, c
    );
  }

  /**
   * Calculate the amount of fyDai a user could sell for given amount of DAI.
   *
   * @param vyDaiReserves DAI reserves amount
   * @param fyDaiReserves fyDai reserves amount
   * @param vyDaiAmount DAI amount to be traded
   * @param timeTillMaturity time till maturity in seconds
   * @param k time till maturity coefficient, multiplied by 2^64
   * @param g fee coefficient, multiplied by 2^64
   * @param c vyDai price in terms of dai, multiplied by 2^64
   * @return the amount of fyDai a user could sell for given amount of DAI
   */
  function fyDaiInForVYDaiOut(
    uint128 vyDaiReserves, uint128 fyDaiReserves, uint128 vyDaiAmount,
    uint128 timeTillMaturity, int128 k, int128 g, int128 c)
  public pure returns(uint128) {
    return VariableYieldMath.fyDaiInForVYDaiOut(
      vyDaiReserves, fyDaiReserves, vyDaiAmount, timeTillMaturity, k, g, c
    );
  }

  /**
   * Calculate the amount of DAI a user would have to pay for certain amount of
   * fyDai.
   *
   * @param vyDaiReserves DAI reserves amount
   * @param fyDaiReserves fyDai reserves amount
   * @param fyDaiAmount fyDai amount to be traded
   * @param timeTillMaturity time till maturity in seconds
   * @param k time till maturity coefficient, multiplied by 2^64
   * @param g fee coefficient, multiplied by 2^64
   * @param c vyDai price in terms of dai, multiplied by 2^64
   * @return the amount of DAI a user would have to pay for given amount of
   *         fyDai
   */
  function vyDaiInForFYDaiOut(
    uint128 vyDaiReserves, uint128 fyDaiReserves, uint128 fyDaiAmount,
    uint128 timeTillMaturity, int128 k, int128 g, int128 c)
  public pure returns(uint128) {
    return VariableYieldMath.vyDaiInForFYDaiOut(
      vyDaiReserves, fyDaiReserves, fyDaiAmount, timeTillMaturity, k, g, c
    );
  }

  /**
   * Calculate the amount of fyDai a user would get for given amount of VYDai.
   * A normalization parameter is taken to normalize the exchange rate at a certain value.
   * This is used for liquidity pools to be initialized with balanced reserves.
   * @param vyDaiReserves VYDai reserves amount
   * @param fyDaiReserves fyDai reserves amount
   * @param vyDaiAmount VYDai amount to be traded
   * @param timeTillMaturity time till maturity in seconds
   * @param k time till maturity coefficient, multiplied by 2^64
   * @param g fee coefficient, multiplied by 2^64
   * @param c0 price of VYDai in terms of VYDai as it was at protocol
   *        initialization time, multiplied by 2^64
   * @param c price of VYDai in terms of VYDai, multiplied by 2^64
   * @return the amount of fyDai a user would get for given amount of VYDai
   */
  function fyDaiOutForVYDaiInNormalized(
    uint128 vyDaiReserves, uint128 fyDaiReserves, uint128 vyDaiAmount,
    uint128 timeTillMaturity, int128 k, int128 g, int128 c0, int128 c)
  public pure returns(uint128) {
    return VariableYieldMath.fyDaiOutForVYDaiInNormalized(
      vyDaiReserves, fyDaiReserves, vyDaiAmount, timeTillMaturity, k, g, c0, c
    );
  }

  /**
   * Calculate the amount of VYDai a user would get for certain amount of fyDai.
   * A normalization parameter is taken to normalize the exchange rate at a certain value.
   * This is used for liquidity pools to be initialized with balanced reserves.
   * @param vyDaiReserves VYDai reserves amount
   * @param fyDaiReserves fyDai reserves amount
   * @param fyDaiAmount fyDai amount to be traded
   * @param timeTillMaturity time till maturity in seconds
   * @param k time till maturity coefficient, multiplied by 2^64
   * @param g fee coefficient, multiplied by 2^64
   * @param c0 price of VYDai in terms of VYDai as it was at protocol
   *        initialization time, multiplied by 2^64
   * @param c price of VYDai in terms of VYDai, multiplied by 2^64
   * @return the amount of VYDai a user would get for given amount of fyDai
   */
  function vyDaiOutForFYDaiInNormalized(
    uint128 vyDaiReserves, uint128 fyDaiReserves, uint128 fyDaiAmount,
    uint128 timeTillMaturity, int128 k, int128 g, int128 c0, int128 c)
  public pure returns(uint128) {
    return VariableYieldMath.vyDaiOutForFYDaiInNormalized(
      vyDaiReserves, fyDaiReserves, fyDaiAmount, timeTillMaturity, k, g, c0, c
    );
  }

  /**
   * Calculate the amount of fyDai a user could sell for given amount of VYDai.
   * 
   * @param vyDaiReserves VYDai reserves amount
   * @param fyDaiReserves fyDai reserves amount
   * @param vyDaiAmount VYDai amount to be traded
   * @param timeTillMaturity time till maturity in seconds
   * @param k time till maturity coefficient, multiplied by 2^64
   * @param g fee coefficient, multiplied by 2^64
   * @param c0 price of VYDai in terms of VYDai as it was at protocol
   *        initialization time, multiplied by 2^64
   * @param c price of VYDai in terms of VYDai, multiplied by 2^64
   * @return the amount of fyDai a user could sell for given amount of VYDai
   */
  function fyDaiInForVYDaiOutNormalized(
    uint128 vyDaiReserves, uint128 fyDaiReserves, uint128 vyDaiAmount,
    uint128 timeTillMaturity, int128 k, int128 g, int128 c0, int128 c)
  public pure returns(uint128) {
    return VariableYieldMath.fyDaiInForVYDaiOutNormalized(
      vyDaiReserves, fyDaiReserves, vyDaiAmount, timeTillMaturity, k, g, c0, c
    );
  }

  /**
   * Calculate the amount of VYDai a user would have to pay for certain amount of
   * fyDai.
   *
   * @param vyDaiReserves VYDai reserves amount
   * @param fyDaiReserves fyDai reserves amount
   * @param fyDaiAmount fyDai amount to be traded
   * @param timeTillMaturity time till maturity in seconds
   * @param k time till maturity coefficient, multiplied by 2^64
   * @param g fee coefficient, multiplied by 2^64
   * @param c0 price of VYDai in terms of VYDai as it was at protocol
   *        initialization time, multiplied by 2^64
   * @param c price of VYDai in terms of VYDai, multiplied by 2^64
   * @return the amount of VYDai a user would have to pay for given amount of
   *         fyDai
   */
  function vyDaiInForFYDaiOutNormalized(
    uint128 vyDaiReserves, uint128 fyDaiReserves, uint128 fyDaiAmount,
    uint128 timeTillMaturity, int128 k, int128 g, int128 c0, int128 c)
  public pure returns(uint128) {
    return VariableYieldMath.vyDaiInForFYDaiOutNormalized(
      vyDaiReserves, fyDaiReserves, fyDaiAmount, timeTillMaturity, k, g, c0, c
    );
  }

  /**
   * Raise given number x into power specified as a simple fraction y/z and then
   * multiply the result by the normalization factor 2^(128 *(1 - y/z)).
   * Revert if z is zero, or if both x and y are zeros.
   *
   * @param x number to raise into given power y/z
   * @param y numerator of the power to raise x into
   * @param z denominator of the power to raise x into
   * @return x raised into power y/z and then multiplied by 2^(128 *(1 - y/z))
   */
  function pow(uint128 x, uint128 y, uint128 z)
  public pure returns(bool, uint256) {
    return(
      true,
      Exp64x64.pow(x, y, z));
  }

  /**
   * Calculate base 2 logarithm of an unsigned 128-bit integer number.  Revert
   * in case x is zero.
   *
   * @param x number to calculate 2-base logarithm of
   * @return 2-base logarithm of x, multiplied by 2^121
   */
  function log_2(uint128 x)
  public pure returns(bool, uint128) {
    return(
      true,
      Exp64x64.log_2(x));
  }

  /**
   * Calculate 2 raised into given power.
   *
   * @param x power to raise 2 into, multiplied by 2^121
   * @return 2 raised into given power
   */
  function pow_2(uint128 x)
  public pure returns(bool, uint128) {
    return(
      true,
      Exp64x64.pow_2(x));
  }
}