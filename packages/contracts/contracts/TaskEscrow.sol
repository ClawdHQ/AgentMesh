// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAgentIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

/// @title TaskEscrow - Onchain settlement for registered autonomous agents
/// @notice Holds requester funds in escrow and only allows completion by the registered
/// agent wallet or ERC-8004 owner linked to the executor agent id.
contract TaskEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum TaskStatus {
        Created,
        Funded,
        Accepted,
        Completed,
        Disputed,
        Refunded
    }

    struct Task {
        uint256 taskId;
        address requester;
        address executor;
        uint256 executorAgentId;
        uint256 amount;
        address token;
        TaskStatus status;
        string requirementsCID;
        string resultCID;
        uint256 createdAt;
        uint256 deadline;
    }

    uint256 private _nextTaskId;
    mapping(uint256 => Task) private _tasks;
    mapping(address => uint256[]) private _requesterTasks;

    IAgentIdentityRegistry public immutable agentRegistry;

    event PaymentReceived(
        uint256 indexed taskId,
        address indexed requester,
        uint256 indexed executorAgentId,
        uint256 amount,
        address token,
        uint256 timestamp
    );

    event TaskCreated(
        uint256 indexed taskId,
        address indexed requester,
        uint256 executorAgentId,
        string requirementsCID
    );
    event TaskFunded(uint256 indexed taskId, uint256 amount, address token);
    event TaskAccepted(uint256 indexed taskId, uint256 executorAgentId);
    event TaskCompleted(uint256 indexed taskId, string resultCID, uint256 paymentAmount);
    event TaskDisputed(uint256 indexed taskId, address indexed disputant);
    event DisputeResolved(uint256 indexed taskId, bool favorRequester);
    event TaskRefunded(uint256 indexed taskId, address indexed requester, uint256 amount);

    constructor(address initialOwner, address agentRegistryAddress) Ownable(initialOwner) {
        require(agentRegistryAddress != address(0), "TaskEscrow: zero registry");
        agentRegistry = IAgentIdentityRegistry(agentRegistryAddress);
        _nextTaskId = 1;
    }

    function createTask(
        uint256 executorAgentId,
        uint256 amount,
        address token,
        string calldata requirementsCID,
        uint256 deadline
    ) external returns (uint256 taskId) {
        require(bytes(requirementsCID).length > 0, "TaskEscrow: empty requirements CID");
        require(deadline > block.timestamp, "TaskEscrow: deadline in the past");
        require(amount > 0, "TaskEscrow: zero amount");
        require(_agentExists(executorAgentId), "TaskEscrow: unknown executor agent");

        taskId = _nextTaskId++;
        _tasks[taskId] = Task({
            taskId: taskId,
            requester: msg.sender,
            executor: address(0),
            executorAgentId: executorAgentId,
            amount: amount,
            token: token,
            status: TaskStatus.Created,
            requirementsCID: requirementsCID,
            resultCID: "",
            createdAt: block.timestamp,
            deadline: deadline
        });

        _requesterTasks[msg.sender].push(taskId);
        emit TaskCreated(taskId, msg.sender, executorAgentId, requirementsCID);
    }

    function fundTask(uint256 taskId) external payable nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.requester != address(0), "TaskEscrow: task not found");
        require(task.requester == msg.sender, "TaskEscrow: not requester");
        require(task.status == TaskStatus.Created, "TaskEscrow: task not in Created state");

        if (task.token == address(0)) {
            require(msg.value == task.amount, "TaskEscrow: incorrect ETH amount");
        } else {
            require(msg.value == 0, "TaskEscrow: ETH not accepted for token task");
            IERC20(task.token).safeTransferFrom(msg.sender, address(this), task.amount);
        }

        task.status = TaskStatus.Funded;

        emit TaskFunded(taskId, task.amount, task.token);
        emit PaymentReceived(
            taskId,
            msg.sender,
            task.executorAgentId,
            task.amount,
            task.token,
            block.timestamp
        );
    }

    function acceptTask(uint256 taskId) external {
        Task storage task = _tasks[taskId];
        require(task.requester != address(0), "TaskEscrow: task not found");
        require(task.status == TaskStatus.Funded, "TaskEscrow: task not funded");
        require(block.timestamp <= task.deadline, "TaskEscrow: deadline passed");

        address expectedExecutor = _resolveExecutor(task.executorAgentId);
        require(msg.sender == expectedExecutor, "TaskEscrow: caller is not registered executor");

        task.status = TaskStatus.Accepted;
        task.executor = msg.sender;

        emit TaskAccepted(taskId, task.executorAgentId);
    }

    function completeTask(uint256 taskId, string calldata resultCID) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.requester != address(0), "TaskEscrow: task not found");
        require(task.status == TaskStatus.Accepted, "TaskEscrow: task not accepted");
        require(msg.sender == task.executor, "TaskEscrow: only executor can complete");
        require(bytes(resultCID).length > 0, "TaskEscrow: empty result CID");

        task.status = TaskStatus.Completed;
        task.resultCID = resultCID;

        _releasePayment(task);
        emit TaskCompleted(taskId, resultCID, task.amount);
    }

    function disputeTask(uint256 taskId) external {
        Task storage task = _tasks[taskId];
        require(task.requester != address(0), "TaskEscrow: task not found");
        require(
            task.status == TaskStatus.Funded || task.status == TaskStatus.Accepted,
            "TaskEscrow: cannot dispute"
        );
        require(
            msg.sender == task.requester || msg.sender == owner(),
            "TaskEscrow: not authorized"
        );

        task.status = TaskStatus.Disputed;
        emit TaskDisputed(taskId, msg.sender);
    }

    function resolveDispute(uint256 taskId, bool favorRequester) external onlyOwner nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.status == TaskStatus.Disputed, "TaskEscrow: not disputed");

        if (favorRequester) {
            task.status = TaskStatus.Refunded;
            _refundTask(task);
            emit TaskRefunded(taskId, task.requester, task.amount);
        } else {
            task.status = TaskStatus.Completed;
            _releasePayment(task);
        }

        emit DisputeResolved(taskId, favorRequester);
    }

    function autoRelease(uint256 taskId) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.status == TaskStatus.Accepted, "TaskEscrow: task not accepted");
        require(block.timestamp > task.deadline, "TaskEscrow: deadline not passed");

        task.status = TaskStatus.Completed;
        _releasePayment(task);
        emit TaskCompleted(taskId, task.resultCID, task.amount);
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        require(_tasks[taskId].requester != address(0), "TaskEscrow: task not found");
        return _tasks[taskId];
    }

    function getTasksByRequester(address requester) external view returns (uint256[] memory) {
        return _requesterTasks[requester];
    }

    function totalTasks() external view returns (uint256) {
        return _nextTaskId - 1;
    }

    function _agentExists(uint256 agentId) internal view returns (bool) {
        try agentRegistry.ownerOf(agentId) returns (address ownerAddr) {
            return ownerAddr != address(0);
        } catch {
            return false;
        }
    }

    function _resolveExecutor(uint256 executorAgentId) internal view returns (address) {
        address executorWallet = agentRegistry.getAgentWallet(executorAgentId);
        if (executorWallet != address(0)) {
            return executorWallet;
        }

        return agentRegistry.ownerOf(executorAgentId);
    }

    function _releasePayment(Task storage task) internal {
        require(task.executor != address(0), "TaskEscrow: no executor set");
        if (task.token == address(0)) {
            (bool success, ) = payable(task.executor).call{value: task.amount}("");
            require(success, "TaskEscrow: ETH transfer failed");
        } else {
            IERC20(task.token).safeTransfer(task.executor, task.amount);
        }
    }

    function _refundTask(Task storage task) internal {
        if (task.token == address(0)) {
            (bool success, ) = payable(task.requester).call{value: task.amount}("");
            require(success, "TaskEscrow: ETH refund failed");
        } else {
            IERC20(task.token).safeTransfer(task.requester, task.amount);
        }
    }

    receive() external payable {}
}
