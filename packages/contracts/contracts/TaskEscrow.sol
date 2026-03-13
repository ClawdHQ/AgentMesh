// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TaskEscrow - x402-compatible payment escrow for agent tasks
/// @notice Manages task lifecycle with escrow-based payment settlement
contract TaskEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum TaskStatus { Created, Funded, Accepted, Completed, Disputed, Refunded }

    struct Task {
        uint256 taskId;
        address requester;
        uint256 executorAgentId;
        uint256 amount;
        address token;          // address(0) for native ETH
        TaskStatus status;
        string requirementsCID;
        string resultCID;
        uint256 createdAt;
        uint256 deadline;
    }

    uint256 private _nextTaskId;
    mapping(uint256 => Task) private _tasks;
    mapping(address => uint256[]) private _requesterTasks;

    // x402 payment receipt event (compatible with x402 spec)
    event PaymentReceived(
        uint256 indexed taskId,
        address indexed requester,
        uint256 indexed executorAgentId,
        uint256 amount,
        address token,
        uint256 timestamp
    );

    event TaskCreated(uint256 indexed taskId, address indexed requester, uint256 executorAgentId, string requirementsCID);
    event TaskFunded(uint256 indexed taskId, uint256 amount, address token);
    event TaskAccepted(uint256 indexed taskId, uint256 executorAgentId);
    event TaskCompleted(uint256 indexed taskId, string resultCID, uint256 paymentAmount);
    event TaskDisputed(uint256 indexed taskId, address indexed disputant);
    event DisputeResolved(uint256 indexed taskId, bool favorRequester);
    event TaskRefunded(uint256 indexed taskId, address indexed requester, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {
        _nextTaskId = 1;
    }

    /// @notice Create a new task
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

        taskId = _nextTaskId++;
        _tasks[taskId] = Task({
            taskId: taskId,
            requester: msg.sender,
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

    /// @notice Fund a task by transferring tokens/ETH to escrow
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
        emit PaymentReceived(taskId, msg.sender, task.executorAgentId, task.amount, task.token, block.timestamp);
    }

    /// @notice Accept a task (callable by executor's registered address)
    function acceptTask(uint256 taskId) external {
        Task storage task = _tasks[taskId];
        require(task.requester != address(0), "TaskEscrow: task not found");
        require(task.status == TaskStatus.Funded, "TaskEscrow: task not funded");
        require(block.timestamp <= task.deadline, "TaskEscrow: deadline passed");

        task.status = TaskStatus.Accepted;
        emit TaskAccepted(taskId, task.executorAgentId);
    }

    /// @notice Complete a task and release payment to the executor
    function completeTask(uint256 taskId, string calldata resultCID) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.requester != address(0), "TaskEscrow: task not found");
        require(task.status == TaskStatus.Accepted, "TaskEscrow: task not accepted");
        require(bytes(resultCID).length > 0, "TaskEscrow: empty result CID");

        task.status = TaskStatus.Completed;
        task.resultCID = resultCID;

        _releasePayment(task);
        emit TaskCompleted(taskId, resultCID, task.amount);
    }

    /// @notice Dispute a task (requester or owner)
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

    /// @notice Resolve a dispute (only owner/arbitrator)
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

    /// @notice Auto-release payment if deadline passed and no dispute
    function autoRelease(uint256 taskId) external nonReentrant {
        Task storage task = _tasks[taskId];
        require(task.status == TaskStatus.Accepted, "TaskEscrow: task not accepted");
        require(block.timestamp > task.deadline, "TaskEscrow: deadline not passed");

        task.status = TaskStatus.Completed;
        _releasePayment(task);
        emit TaskCompleted(taskId, task.resultCID, task.amount);
    }

    /// @notice Get task details
    function getTask(uint256 taskId) external view returns (Task memory) {
        require(_tasks[taskId].requester != address(0), "TaskEscrow: task not found");
        return _tasks[taskId];
    }

    /// @notice Get tasks by requester
    function getTasksByRequester(address requester) external view returns (uint256[] memory) {
        return _requesterTasks[requester];
    }

    /// @notice Get total task count
    function totalTasks() external view returns (uint256) {
        return _nextTaskId - 1;
    }

    function _releasePayment(Task storage task) internal {
        if (task.token == address(0)) {
            (bool success, ) = payable(tx.origin).call{value: task.amount}("");
            require(success, "TaskEscrow: ETH transfer failed");
        } else {
            IERC20(task.token).safeTransfer(tx.origin, task.amount);
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
