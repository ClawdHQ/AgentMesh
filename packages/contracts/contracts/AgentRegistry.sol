// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentRegistry - ERC-8004 style identity registry for autonomous agents
/// @notice Registers agents as ERC-721 identities with URI-based registration files,
/// operator-wallet linkage, optional metadata, and reputation updates.
contract AgentRegistry is
    Ownable,
    AccessControl,
    ERC721URIStorage,
    EIP712,
    ReentrancyGuard
{
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant REPUTATION_UPDATER_ROLE = keccak256("REPUTATION_UPDATER_ROLE");
    bytes32 private constant AGENT_WALLET_TYPEHASH =
        keccak256("SetAgentWallet(uint256 agentId,address newWallet,uint256 deadline)");

    string public constant RESERVED_AGENT_WALLET_KEY = "agentWallet";

    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    struct AgentRecord {
        address owner;
        address operatorWallet;
        string agentURI;
        uint256 reputationScore;
        uint256 taskCount;
        uint256 successCount;
        bool active;
        uint256 registeredAt;
    }

    uint256 private _nextAgentId;

    mapping(uint256 => string) private _agentUris;
    mapping(uint256 => uint256) private _reputationScores;
    mapping(uint256 => uint256) private _taskCounts;
    mapping(uint256 => uint256) private _successCounts;
    mapping(uint256 => bool) private _activeAgents;
    mapping(uint256 => uint256) private _registeredAt;
    mapping(uint256 => address) private _agentWallets;
    mapping(uint256 => mapping(bytes32 => bytes)) private _metadata;

    mapping(address => EnumerableSet.UintSet) private _ownerAgents;
    EnumerableSet.UintSet private _allAgentIds;

    uint256 public constant INITIAL_REPUTATION = 50;
    uint256 public constant MAX_REPUTATION = 100;
    uint256 public constant REPUTATION_SUCCESS_DELTA = 2;
    uint256 public constant REPUTATION_FAILURE_DELTA = 5;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );
    event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentCardCID, uint256 timestamp);
    event ReputationUpdated(uint256 indexed agentId, bool success, uint256 newScore, uint256 paymentAmount);
    event AgentDeactivated(uint256 indexed agentId, address indexed owner);
    event AgentCardUpdated(uint256 indexed agentId, string newCID);
    event AgentWalletSet(uint256 indexed agentId, address indexed operatorWallet, address indexed updatedBy);
    event AgentWalletUnset(uint256 indexed agentId, address indexed previousWallet, address indexed updatedBy);

    constructor(address initialOwner)
        Ownable(initialOwner)
        ERC721("AgentMesh Agent Identity", "AGENT")
        EIP712("AgentMesh Agent Identity", "1")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(REPUTATION_UPDATER_ROLE, initialOwner);
        _nextAgentId = 1;
    }

    /// @notice ERC-8004 registration with URI and optional metadata.
    function register(
        string calldata agentURI,
        MetadataEntry[] calldata metadataEntries
    ) external nonReentrant returns (uint256 agentId) {
        agentId = _registerInternal(agentURI);

        for (uint256 i = 0; i < metadataEntries.length; i++) {
            require(
                !_isReservedMetadataKey(metadataEntries[i].metadataKey),
                "AgentRegistry: reserved metadata key"
            );
            _setMetadataInternal(agentId, metadataEntries[i].metadataKey, metadataEntries[i].metadataValue);
        }
    }

    /// @notice ERC-8004 registration with a URI only.
    function register(string calldata agentURI) external nonReentrant returns (uint256 agentId) {
        agentId = _registerInternal(agentURI);
    }

    /// @notice ERC-8004 registration without a URI. URI can be set later.
    function register() external nonReentrant returns (uint256 agentId) {
        agentId = _registerInternal("");
    }

    /// @notice Backwards-compatible alias used by the existing codebase.
    function registerAgent(string calldata agentURI) external nonReentrant returns (uint256 agentId) {
        agentId = _registerInternal(agentURI);
    }

    /// @notice Update the agent URI referenced by the ERC-721 identity.
    function setAgentURI(uint256 agentId, string calldata newURI) external {
        address ownerAddr = _requireExistingAgent(agentId);
        _checkAuthorized(ownerAddr, msg.sender, agentId);
        _setAgentURIInternal(agentId, newURI);
    }

    /// @notice Backwards-compatible alias for updating the stored registration URI.
    function updateAgentCard(uint256 agentId, string calldata newCID) external {
        address ownerAddr = _requireExistingAgent(agentId);
        _checkAuthorized(ownerAddr, msg.sender, agentId);
        _setAgentURIInternal(agentId, newCID);
        emit AgentCardUpdated(agentId, newCID);
    }

    /// @notice Get an agent registration record.
    function getAgent(uint256 agentId) external view returns (AgentRecord memory) {
        address ownerAddr = _requireExistingAgent(agentId);
        return
            AgentRecord({
                owner: ownerAddr,
                operatorWallet: _agentWallets[agentId],
                agentURI: tokenURI(agentId),
                reputationScore: _reputationScores[agentId],
                taskCount: _taskCounts[agentId],
                successCount: _successCounts[agentId],
                active: _activeAgents[agentId],
                registeredAt: _registeredAt[agentId]
            });
    }

    /// @notice Set an arbitrary metadata key/value, excluding the reserved `agentWallet`.
    function setMetadata(
        uint256 agentId,
        string calldata metadataKey,
        bytes calldata metadataValue
    ) external {
        require(!_isReservedMetadataKey(metadataKey), "AgentRegistry: reserved metadata key");

        address ownerAddr = _requireExistingAgent(agentId);
        _checkAuthorized(ownerAddr, msg.sender, agentId);
        _setMetadataInternal(agentId, metadataKey, metadataValue);
    }

    /// @notice Read metadata for an agent.
    function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory) {
        _requireExistingAgent(agentId);

        if (_isReservedMetadataKey(metadataKey)) {
            return abi.encode(_agentWallets[agentId]);
        }

        return _metadata[agentId][_metadataKeyHash(metadataKey)];
    }

    /// @notice Link an operator wallet to an agent by proving control of that wallet.
    function setAgentWallet(
        uint256 agentId,
        address newWallet,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(newWallet != address(0), "AgentRegistry: zero operator wallet");
        require(block.timestamp <= deadline, "AgentRegistry: expired signature");

        address ownerAddr = _requireExistingAgent(agentId);
        _checkAuthorized(ownerAddr, msg.sender, agentId);

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(AGENT_WALLET_TYPEHASH, agentId, newWallet, deadline))
        );
        require(
            SignatureChecker.isValidSignatureNow(newWallet, digest, signature),
            "AgentRegistry: invalid operator wallet signature"
        );

        _agentWallets[agentId] = newWallet;
        emit AgentWalletSet(agentId, newWallet, msg.sender);
        emit MetadataSet(
            agentId,
            RESERVED_AGENT_WALLET_KEY,
            RESERVED_AGENT_WALLET_KEY,
            abi.encode(newWallet)
        );
    }

    /// @notice Read the linked operator wallet.
    function getAgentWallet(uint256 agentId) external view returns (address) {
        _requireExistingAgent(agentId);
        return _agentWallets[agentId];
    }

    /// @notice Clear the linked operator wallet.
    function unsetAgentWallet(uint256 agentId) external {
        address ownerAddr = _requireExistingAgent(agentId);
        _checkAuthorized(ownerAddr, msg.sender, agentId);

        address previousWallet = _agentWallets[agentId];
        _agentWallets[agentId] = address(0);

        emit AgentWalletUnset(agentId, previousWallet, msg.sender);
        emit MetadataSet(
            agentId,
            RESERVED_AGENT_WALLET_KEY,
            RESERVED_AGENT_WALLET_KEY,
            abi.encode(address(0))
        );
    }

    /// @notice Update reputation after task completion.
    function updateReputation(
        uint256 agentId,
        bool success,
        uint256 paymentAmount
    ) external onlyRole(REPUTATION_UPDATER_ROLE) {
        _requireExistingAgent(agentId);
        require(_activeAgents[agentId], "AgentRegistry: agent not active");

        _taskCounts[agentId] += 1;

        if (success) {
            _successCounts[agentId] += 1;
            uint256 newScore = _reputationScores[agentId] + REPUTATION_SUCCESS_DELTA;
            _reputationScores[agentId] = newScore > MAX_REPUTATION ? MAX_REPUTATION : newScore;
        } else {
            uint256 delta = REPUTATION_FAILURE_DELTA;
            _reputationScores[agentId] = _reputationScores[agentId] > delta
                ? _reputationScores[agentId] - delta
                : 0;
        }

        emit ReputationUpdated(agentId, success, _reputationScores[agentId], paymentAmount);
    }

    /// @notice Deactivate an agent.
    function deactivateAgent(uint256 agentId) external {
        address ownerAddr = _requireExistingAgent(agentId);
        require(
            msg.sender == ownerAddr || msg.sender == owner(),
            "AgentRegistry: not authorized"
        );
        require(_activeAgents[agentId], "AgentRegistry: already deactivated");

        _activeAgents[agentId] = false;
        emit AgentDeactivated(agentId, ownerAddr);
    }

    /// @notice Top agents ranked by reputation among active identities.
    function getTopAgents(uint256 limit) external view returns (uint256[] memory) {
        uint256 count = _allAgentIds.length() < limit ? _allAgentIds.length() : limit;
        uint256[] memory topIds = new uint256[](count);
        uint256[] memory sortable = new uint256[](_allAgentIds.length());

        for (uint256 i = 0; i < _allAgentIds.length(); i++) {
            sortable[i] = _allAgentIds.at(i);
        }

        for (uint256 i = 0; i < count; i++) {
            uint256 maxIdx = i;
            for (uint256 j = i + 1; j < sortable.length; j++) {
                uint256 idA = sortable[j];
                uint256 idB = sortable[maxIdx];
                if (_activeAgents[idA] && _reputationScores[idA] > _reputationScores[idB]) {
                    maxIdx = j;
                }
            }

            topIds[i] = sortable[maxIdx];
            sortable[maxIdx] = sortable[i];
        }

        return topIds;
    }

    /// @notice Return all agent ids owned by an address.
    function getAgentsByOwner(address ownerAddr) external view returns (uint256[] memory) {
        uint256 length = _ownerAgents[ownerAddr].length();
        uint256[] memory agentIds = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            agentIds[i] = _ownerAgents[ownerAddr].at(i);
        }

        return agentIds;
    }

    function grantReputationUpdater(address updater) external onlyOwner {
        grantRole(REPUTATION_UPDATER_ROLE, updater);
    }

    function totalAgents() external view returns (uint256) {
        return _allAgentIds.length();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address from) {
        from = super._update(to, tokenId, auth);

        if (from != address(0) && from != to) {
            _ownerAgents[from].remove(tokenId);

            address previousWallet = _agentWallets[tokenId];
            if (previousWallet != address(0)) {
                _agentWallets[tokenId] = address(0);
                emit AgentWalletUnset(tokenId, previousWallet, from);
                emit MetadataSet(
                    tokenId,
                    RESERVED_AGENT_WALLET_KEY,
                    RESERVED_AGENT_WALLET_KEY,
                    abi.encode(address(0))
                );
            }
        }

        if (to != address(0) && to != from) {
            _ownerAgents[to].add(tokenId);
        }
    }

    function _registerInternal(string memory agentURI) internal returns (uint256 agentId) {
        agentId = _nextAgentId++;

        _mint(msg.sender, agentId);
        _allAgentIds.add(agentId);

        _registeredAt[agentId] = block.timestamp;
        _reputationScores[agentId] = INITIAL_REPUTATION;
        _activeAgents[agentId] = true;
        _agentWallets[agentId] = msg.sender;

        if (bytes(agentURI).length > 0) {
            _setAgentURIInternal(agentId, agentURI);
        }

        emit Registered(agentId, agentURI, msg.sender);
        emit AgentRegistered(agentId, msg.sender, agentURI, block.timestamp);
        emit MetadataSet(
            agentId,
            RESERVED_AGENT_WALLET_KEY,
            RESERVED_AGENT_WALLET_KEY,
            abi.encode(msg.sender)
        );
    }

    function _setAgentURIInternal(uint256 agentId, string memory newURI) internal {
        _requireExistingAgent(agentId);
        _agentUris[agentId] = newURI;
        _setTokenURI(agentId, newURI);
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function _setMetadataInternal(
        uint256 agentId,
        string memory metadataKey,
        bytes memory metadataValue
    ) internal {
        _metadata[agentId][_metadataKeyHash(metadataKey)] = metadataValue;
        emit MetadataSet(agentId, metadataKey, metadataKey, metadataValue);
    }

    function _metadataKeyHash(string memory metadataKey) internal pure returns (bytes32) {
        return keccak256(bytes(metadataKey));
    }

    function _isReservedMetadataKey(string memory metadataKey) internal pure returns (bool) {
        return _metadataKeyHash(metadataKey) == _metadataKeyHash(RESERVED_AGENT_WALLET_KEY);
    }

    function _requireExistingAgent(uint256 agentId) internal view returns (address ownerAddr) {
        ownerAddr = _ownerOf(agentId);
        require(ownerAddr != address(0), "AgentRegistry: agent not found");
    }
}
