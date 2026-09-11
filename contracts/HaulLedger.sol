// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Public ASOC haul ledger (Polygon)
/// @notice Permanent open-books record: which vehicle hauled which load.
contract HaulLedger is Ownable {
    struct Haul {
        string plate;
        string loadId;
        uint256 miles;
        uint256 rate;
        uint256 reserve;
        uint256 recordedAt;
        address recorder;
    }

    mapping(address => bool) public recorders;
    mapping(bytes32 => Haul) public hauls;
    bytes32[] public haulIds;
    mapping(string => bytes32) public latestByLoadId;
    mapping(string => uint256) public pickedUpAt;

    event PickupConfirmed(string loadId, string plate, uint256 confirmedAt);
    event HaulRecorded(
        bytes32 indexed haulHash,
        string plate,
        string loadId,
        uint256 miles,
        uint256 rate,
        uint256 reserve,
        uint256 recordedAt
    );

    constructor() Ownable(msg.sender) {
        recorders[msg.sender] = true;
    }

    function setRecorder(address who, bool allowed) external onlyOwner {
        recorders[who] = allowed;
    }

    function confirmPickup(string calldata loadId, string calldata plate) external {
        require(recorders[msg.sender], "not recorder");
        require(bytes(loadId).length > 0, "loadId");
        require(pickedUpAt[loadId] == 0, "already picked up");
        pickedUpAt[loadId] = block.timestamp;
        emit PickupConfirmed(loadId, plate, block.timestamp);
    }

    function recordHaul(
        string calldata plate,
        string calldata loadId,
        uint256 miles,
        uint256 rate,
        uint256 reserve
    ) external returns (bytes32 haulHash) {
        require(recorders[msg.sender], "not recorder");
        require(bytes(plate).length > 0, "plate");
        require(bytes(loadId).length > 0, "loadId");

        haulHash = keccak256(
            abi.encode(plate, loadId, miles, rate, reserve, block.timestamp, msg.sender, haulIds.length)
        );
        hauls[haulHash] = Haul({
            plate: plate,
            loadId: loadId,
            miles: miles,
            rate: rate,
            reserve: reserve,
            recordedAt: block.timestamp,
            recorder: msg.sender
        });
        haulIds.push(haulHash);
        latestByLoadId[loadId] = haulHash;

        emit HaulRecorded(haulHash, plate, loadId, miles, rate, reserve, block.timestamp);
    }

    function haulCount() external view returns (uint256) {
        return haulIds.length;
    }
}
