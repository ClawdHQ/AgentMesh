import { expect } from 'chai';
import { ethers } from 'hardhat';
import { TaskEscrow } from '../typechain-types';

describe('TaskEscrow', function () {
  let taskEscrow: TaskEscrow;
  let owner: ReturnType<typeof ethers.provider.getSigner> extends Promise<infer T> ? T : never;
  let requester: ReturnType<typeof ethers.provider.getSigner> extends Promise<infer T> ? T : never;

  const TASK_AMOUNT = ethers.parseEther('0.01');
  const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 86400;
  const REQUIREMENTS_CID = 'QmRequirementsCID1234';

  beforeEach(async function () {
    const [ownerSigner, requesterSigner] = await ethers.getSigners();
    owner = ownerSigner;
    requester = requesterSigner;

    const TaskEscrowFactory = await ethers.getContractFactory('TaskEscrow');
    taskEscrow = (await TaskEscrowFactory.deploy(
      await owner.getAddress()
    )) as TaskEscrow;
    await taskEscrow.waitForDeployment();
  });

  describe('createTask', function () {
    it('should create a task and return taskId 1', async function () {
      await taskEscrow
        .connect(requester)
        .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, FUTURE_DEADLINE);

      expect(await taskEscrow.totalTasks()).to.equal(1n);
    });

    it('should emit TaskCreated event', async function () {
      await expect(
        taskEscrow
          .connect(requester)
          .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, FUTURE_DEADLINE)
      )
        .to.emit(taskEscrow, 'TaskCreated')
        .withArgs(1n, await requester.getAddress(), 1n, REQUIREMENTS_CID);
    });

    it('should revert with empty requirements CID', async function () {
      await expect(
        taskEscrow
          .connect(requester)
          .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, '', FUTURE_DEADLINE)
      ).to.be.revertedWith('TaskEscrow: empty requirements CID');
    });

    it('should revert with past deadline', async function () {
      const pastDeadline = Math.floor(Date.now() / 1000) - 100;
      await expect(
        taskEscrow
          .connect(requester)
          .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, pastDeadline)
      ).to.be.revertedWith('TaskEscrow: deadline in the past');
    });

    it('should revert with zero amount', async function () {
      await expect(
        taskEscrow
          .connect(requester)
          .createTask(1n, 0n, ethers.ZeroAddress, REQUIREMENTS_CID, FUTURE_DEADLINE)
      ).to.be.revertedWith('TaskEscrow: zero amount');
    });
  });

  describe('fundTask with ETH', function () {
    beforeEach(async function () {
      await taskEscrow
        .connect(requester)
        .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, FUTURE_DEADLINE);
    });

    it('should fund task and emit events', async function () {
      await expect(
        taskEscrow.connect(requester).fundTask(1n, { value: TASK_AMOUNT })
      )
        .to.emit(taskEscrow, 'TaskFunded')
        .withArgs(1n, TASK_AMOUNT, ethers.ZeroAddress)
        .and.to.emit(taskEscrow, 'PaymentReceived');
    });

    it('should set task status to Funded', async function () {
      await taskEscrow.connect(requester).fundTask(1n, { value: TASK_AMOUNT });
      const task = await taskEscrow.getTask(1n);
      expect(task.status).to.equal(1n); // TaskStatus.Funded
    });

    it('should revert with incorrect ETH amount', async function () {
      await expect(
        taskEscrow.connect(requester).fundTask(1n, { value: TASK_AMOUNT / 2n })
      ).to.be.revertedWith('TaskEscrow: incorrect ETH amount');
    });

    it('should revert if not requester', async function () {
      await expect(
        taskEscrow.connect(owner).fundTask(1n, { value: TASK_AMOUNT })
      ).to.be.revertedWith('TaskEscrow: not requester');
    });
  });

  describe('acceptTask', function () {
    beforeEach(async function () {
      await taskEscrow
        .connect(requester)
        .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, FUTURE_DEADLINE);
      await taskEscrow.connect(requester).fundTask(1n, { value: TASK_AMOUNT });
    });

    it('should accept task and emit event', async function () {
      await expect(taskEscrow.acceptTask(1n))
        .to.emit(taskEscrow, 'TaskAccepted')
        .withArgs(1n, 1n);
    });

    it('should set status to Accepted', async function () {
      await taskEscrow.acceptTask(1n);
      const task = await taskEscrow.getTask(1n);
      expect(task.status).to.equal(2n); // TaskStatus.Accepted
    });
  });

  describe('disputeTask', function () {
    beforeEach(async function () {
      await taskEscrow
        .connect(requester)
        .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, FUTURE_DEADLINE);
      await taskEscrow.connect(requester).fundTask(1n, { value: TASK_AMOUNT });
    });

    it('should dispute funded task', async function () {
      await expect(taskEscrow.connect(requester).disputeTask(1n))
        .to.emit(taskEscrow, 'TaskDisputed')
        .withArgs(1n, await requester.getAddress());
    });

    it('should set status to Disputed', async function () {
      await taskEscrow.connect(requester).disputeTask(1n);
      const task = await taskEscrow.getTask(1n);
      expect(task.status).to.equal(4n); // TaskStatus.Disputed
    });
  });
});
