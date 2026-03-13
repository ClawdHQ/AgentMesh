// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ReputationOracle - On-chain reputation tracking for agents
/// @notice Aggregates and stores reputation scores from multiple sources
contract ReputationOracle is Ownable, AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    struct ReputationEntry {
        uint256 agentId;
        uint256 score;
        uint256 taskCount;
        uint256 successCount;
        uint256 lastUpdated;
    }

    mapping(uint256 => ReputationEntry) private _reputation;
    uint256[] private _trackedAgents;

    event ReputationRecorded(uint256 indexed agentId, uint256 newScore, uint256 timestamp);

    constructor(address initialOwner) Ownable(initialOwner) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(ORACLE_ROLE, initialOwner);
    }

    /// @notice Record or update reputation for an agent
    function recordReputation(
        uint256 agentId,
        uint256 score,
        uint256 taskCount,
        uint256 successCount
    ) external onlyRole(ORACLE_ROLE) {
        require(score <= 100, "ReputationOracle: score exceeds max");

        if (_reputation[agentId].lastUpdated == 0) {
            _trackedAgents.push(agentId);
        }

        _reputation[agentId] = ReputationEntry({
            agentId: agentId,
            score: score,
            taskCount: taskCount,
            successCount: successCount,
            lastUpdated: block.timestamp
        });

        emit ReputationRecorded(agentId, score, block.timestamp);
    }

    /// @notice Get reputation entry for an agent
    function getReputation(uint256 agentId) external view returns (ReputationEntry memory) {
        return _reputation[agentId];
    }

    /// @notice Get all tracked agent IDs
    function getTrackedAgents() external view returns (uint256[] memory) {
        return _trackedAgents;
    }

    /// @notice Grant oracle role to an address
    function grantOracle(address oracle) external onlyOwner {
        grantRole(ORACLE_ROLE, oracle);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
