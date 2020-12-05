// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.6.10;

interface IComptroller {
    function claimComp(address[] memory holders, address[] memory cTokens, bool borrowers, bool suppliers) external;
    function getCompAddress() external view returns (address);
}
