// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AuditLogger - On-chain CID anchoring for decision audit trails
/// @notice Stores cryptographic proof of every agent decision on-chain
contract AuditLogger is Ownable, AccessControl {
    bytes32 public constant LOGGER_ROLE = keccak256("LOGGER_ROLE");

    struct DecisionRecord {
        uint256 agentId;
        bytes32 decisionHash;
        string ipfsCID;
        uint256 timestamp;
        address logger;
    }

    mapping(uint256 => DecisionRecord[]) private _agentDecisions;
    uint256 private _totalDecisions;

    event DecisionLogged(
        uint256 indexed agentId,
        bytes32 indexed decisionHash,
        string ipfsCID,
        uint256 timestamp,
        address logger
    );

    constructor(address initialOwner) Ownable(initialOwner) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(LOGGER_ROLE, initialOwner);
    }

    /// @notice Log a decision with its IPFS CID and hash
    /// @param agentId The agent that made the decision
    /// @param decisionHash SHA-256 hash of the decision data
    /// @param ipfsCID IPFS CID where the full decision is stored
    function logDecision(
        uint256 agentId,
        bytes32 decisionHash,
        string calldata ipfsCID
    ) external onlyRole(LOGGER_ROLE) {
        require(bytes(ipfsCID).length > 0, "AuditLogger: empty CID");
        require(decisionHash != bytes32(0), "AuditLogger: empty hash");

        DecisionRecord memory record = DecisionRecord({
            agentId: agentId,
            decisionHash: decisionHash,
            ipfsCID: ipfsCID,
            timestamp: block.timestamp,
            logger: msg.sender
        });

        _agentDecisions[agentId].push(record);
        _totalDecisions++;

        emit DecisionLogged(agentId, decisionHash, ipfsCID, block.timestamp, msg.sender);
    }

    /// @notice Get all decisions for an agent
    function getDecisions(uint256 agentId) external view returns (DecisionRecord[] memory) {
        return _agentDecisions[agentId];
    }

    /// @notice Get a specific decision by index
    function getDecision(uint256 agentId, uint256 index) external view returns (DecisionRecord memory) {
        require(index < _agentDecisions[agentId].length, "AuditLogger: index out of bounds");
        return _agentDecisions[agentId][index];
    }

    /// @notice Get decision count for an agent
    function getDecisionCount(uint256 agentId) external view returns (uint256) {
        return _agentDecisions[agentId].length;
    }

    /// @notice Get total decisions logged across all agents
    function totalDecisions() external view returns (uint256) {
        return _totalDecisions;
    }

    /// @notice Grant logger role to an address
    function grantLogger(address logger) external onlyOwner {
        grantRole(LOGGER_ROLE, logger);
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
