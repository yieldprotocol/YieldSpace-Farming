pragma solidity ^0.6.0;

abstract contract ComptrollerInterface {
    /// @notice Indicator that this is a Comptroller abstract contract (for inspection)
    bool public constant isComptroller = true;

    /*** Assets You Are In ***/

    function enterMarkets(address[] memory cTokens) public virtual returns (uint[] memory);
    function exitMarket(address cToken) public virtual returns (uint);

    /*** Policy Hooks ***/

    function mintAllowed(address cToken, address minter, uint mintAmount) public virtual returns (uint);
    function mintVerify(address cToken, address minter, uint mintAmount, uint mintTokens) public virtual;

    function redeemAllowed(address cToken, address redeemer, uint redeemTokens) public virtual returns (uint);
    function redeemVerify(address cToken, address redeemer, uint redeemAmount, uint redeemTokens) public virtual;

    function borrowAllowed(address cToken, address borrower, uint borrowAmount) public virtual returns (uint);
    function borrowVerify(address cToken, address borrower, uint borrowAmount) public virtual;

    function repayBorrowAllowed(
        address cToken,
        address payer,
        address borrower,
        uint repayAmount) public virtual returns (uint);
    function repayBorrowVerify(
        address cToken,
        address payer,
        address borrower,
        uint repayAmount,
        uint borrowerIndex) public virtual;

    function liquidateBorrowAllowed(
        address cTokenBorrowed,
        address cTokenCollateral,
        address liquidator,
        address borrower,
        uint repayAmount) public virtual returns (uint);
    function liquidateBorrowVerify(
        address cTokenBorrowed,
        address cTokenCollateral,
        address liquidator,
        address borrower,
        uint repayAmount,
        uint seizeTokens) public virtual;

    function seizeAllowed(
        address cTokenCollateral,
        address cTokenBorrowed,
        address liquidator,
        address borrower,
        uint seizeTokens) public virtual returns (uint);
    function seizeVerify(
        address cTokenCollateral,
        address cTokenBorrowed,
        address liquidator,
        address borrower,
        uint seizeTokens) public virtual;

    function transferAllowed(address cToken, address src, address dst, uint transferTokens) public virtual returns (uint);
    function transferVerify(address cToken, address src, address dst, uint transferTokens) public virtual;

    /*** Liquidity/Liquidation Calculations ***/

    function liquidateCalculateSeizeTokens(
        address cTokenBorrowed,
        address cTokenCollateral,
        uint repayAmount) public virtual view returns (uint, uint);
}
