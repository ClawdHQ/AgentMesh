// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentRegistry - ERC-8004 compliant identity registry for autonomous agents
/// @notice Manages agent registration, identity, and reputation scores
contract AgentRegistry is Ownable, AccessControl, ReentrancyGuard {
    bytes32 public constant REPUTATION_UPDATER_ROLE = keccak256("REPUTATION_UPDATER_ROLE");

    struct AgentRecord {
        address owner;
        string agentCardCID;
        uint256 reputationScore;
        uint256 taskCount;
        uint256 successCount;
        bool active;
        uint256 registeredAt;
    }

    uint256 private _nextAgentId;
    mapping(uint256 => AgentRecord) private _agents;
    mapping(address => uint256[]) private _ownerAgents;
    uint256[] private _allAgentIds;

    uint256 public constant INITIAL_REPUTATION = 50;
    uint256 public constant MAX_REPUTATION = 100;
    uint256 public constant REPUTATION_SUCCESS_DELTA = 2;
    uint256 public constant REPUTATION_FAILURE_DELTA = 5;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentCardCID, uint256 timestamp);
    event ReputationUpdated(uint256 indexed agentId, bool success, uint256 newScore, uint256 paymentAmount);
    event AgentDeactivated(uint256 indexed agentId, address indexed owner);
    event AgentCardUpdated(uint256 indexed agentId, string newCID);

    constructor(address initialOwner) Ownable(initialOwner) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(REPUTATION_UPDATER_ROLE, initialOwner);
        _nextAgentId = 1;
    }

    /// @notice Register a new agent with an IPFS CID pointing to the agent card
    /// @param agentCardCID IPFS CID of the agent's ERC-8004 compliant agent card
    /// @return agentId The unique identifier assigned to this agent
    function registerAgent(string calldata agentCardCID) external nonReentrant returns (uint256 agentId) {
        require(bytes(agentCardCID).length > 0, "AgentRegistry: empty agent card CID");

        agentId = _nextAgentId++;
        _agents[agentId] = AgentRecord({
            owner: msg.sender,
            agentCardCID: agentCardCID,
            reputationScore: INITIAL_REPUTATION,
            taskCount: 0,
            successCount: 0,
            active: true,
            registeredAt: block.timestamp
        });

        _ownerAgents[msg.sender].push(agentId);
        _allAgentIds.push(agentId);

        emit AgentRegistered(agentId, msg.sender, agentCardCID, block.timestamp);
    }

    /// @notice Update agent reputation after task completion
    /// @param agentId The agent to update
    /// @param success Whether the task was successful
    /// @param paymentAmount The payment amount for the task (in token smallest unit)
    function updateReputation(
        uint256 agentId,
        bool success,
        uint256 paymentAmount
    ) external onlyRole(REPUTATION_UPDATER_ROLE) {
        AgentRecord storage agent = _agents[agentId];
        require(agent.owner != address(0), "AgentRegistry: agent not found");
        require(agent.active, "AgentRegistry: agent not active");

        agent.taskCount++;
        if (success) {
            agent.successCount++;
            uint256 newScore = agent.reputationScore + REPUTATION_SUCCESS_DELTA;
            agent.reputationScore = newScore > MAX_REPUTATION ? MAX_REPUTATION : newScore;
        } else {
            uint256 delta = REPUTATION_FAILURE_DELTA;
            agent.reputationScore = agent.reputationScore > delta
                ? agent.reputationScore - delta
                : 0;
        }

        emit ReputationUpdated(agentId, success, agent.reputationScore, paymentAmount);
    }

    /// @notice Get agent record by ID
    /// @param agentId The agent ID to look up
    function getAgent(uint256 agentId) external view returns (AgentRecord memory) {
        require(_agents[agentId].owner != address(0), "AgentRegistry: agent not found");
        return _agents[agentId];
    }

    /// @notice Deactivate an agent (only owner or contract owner)
    /// @param agentId The agent to deactivate
    function deactivateAgent(uint256 agentId) external {
        AgentRecord storage agent = _agents[agentId];
        require(agent.owner != address(0), "AgentRegistry: agent not found");
        require(
            msg.sender == agent.owner || msg.sender == owner(),
            "AgentRegistry: not authorized"
        );
        require(agent.active, "AgentRegistry: already deactivated");

        agent.active = false;
        emit AgentDeactivated(agentId, agent.owner);
    }

    /// @notice Update the agent card CID
    /// @param agentId The agent to update
    /// @param newCID New IPFS CID for the agent card
    function updateAgentCard(uint256 agentId, string calldata newCID) external {
        AgentRecord storage agent = _agents[agentId];
        require(agent.owner == msg.sender, "AgentRegistry: not agent owner");
        require(agent.active, "AgentRegistry: agent not active");
        require(bytes(newCID).length > 0, "AgentRegistry: empty CID");

        agent.agentCardCID = newCID;
        emit AgentCardUpdated(agentId, newCID);
    }

    /// @notice Get the top agents by reputation score
    /// @param limit Maximum number of agents to return
    function getTopAgents(uint256 limit) external view returns (uint256[] memory) {
        uint256 count = _allAgentIds.length < limit ? _allAgentIds.length : limit;
        uint256[] memory topIds = new uint256[](count);

        // Simple selection sort for small datasets
        uint256[] memory sortable = new uint256[](_allAgentIds.length);
        for (uint256 i = 0; i < _allAgentIds.length; i++) {
            sortable[i] = _allAgentIds[i];
        }

        for (uint256 i = 0; i < count; i++) {
            uint256 maxIdx = i;
            for (uint256 j = i + 1; j < sortable.length; j++) {
                uint256 idA = sortable[j];
                uint256 idB = sortable[maxIdx];
                if (
                    _agents[idA].active &&
                    _agents[idA].reputationScore > _agents[idB].reputationScore
                ) {
                    maxIdx = j;
                }
            }
            topIds[i] = sortable[maxIdx];
            sortable[maxIdx] = sortable[i];
        }

        return topIds;
    }

    /// @notice Get all agents owned by an address
    function getAgentsByOwner(address ownerAddr) external view returns (uint256[] memory) {
        return _ownerAgents[ownerAddr];
    }

    /// @notice Grant reputation updater role to an address
    function grantReputationUpdater(address updater) external onlyOwner {
        grantRole(REPUTATION_UPDATER_ROLE, updater);
    }

    /// @notice Get total number of registered agents
    function totalAgents() external view returns (uint256) {
        return _allAgentIds.length;
    }

    /// @notice Check if contract supports interface
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
