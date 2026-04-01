import { expect } from 'chai';
import { ethers } from 'hardhat';
import { AgentRegistry, TaskEscrow } from '../typechain-types';

describe('TaskEscrow', function () {
  let agentRegistry: AgentRegistry;
  let taskEscrow: TaskEscrow;
  let owner: Awaited<ReturnType<typeof ethers.provider.getSigner>>;
  let requester: Awaited<ReturnType<typeof ethers.provider.getSigner>>;
  let executorOwner: Awaited<ReturnType<typeof ethers.provider.getSigner>>;
  let operatorWallet: Awaited<ReturnType<typeof ethers.provider.getSigner>>;

  const TASK_AMOUNT = ethers.parseEther('0.01');
  const REQUIREMENTS_CID = 'ipfs://bafy-requirements';

  beforeEach(async function () {
    const [ownerSigner, requesterSigner, executorOwnerSigner, operatorWalletSigner] =
      await ethers.getSigners();
    owner = ownerSigner;
    requester = requesterSigner;
    executorOwner = executorOwnerSigner;
    operatorWallet = operatorWalletSigner;

    const AgentRegistryFactory = await ethers.getContractFactory('AgentRegistry');
    agentRegistry = (await AgentRegistryFactory.deploy(
      await owner.getAddress()
    )) as AgentRegistry;
    await agentRegistry.waitForDeployment();

    const TaskEscrowFactory = await ethers.getContractFactory('TaskEscrow');
    taskEscrow = (await TaskEscrowFactory.deploy(
      await owner.getAddress(),
      await agentRegistry.getAddress()
    )) as TaskEscrow;
    await taskEscrow.waitForDeployment();

    await agentRegistry.connect(executorOwner).registerAgent('ipfs://bafy-executor');
  });

  describe('createTask', function () {
    it('creates a task for a registered executor agent', async function () {
      await taskEscrow
        .connect(requester)
        .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, futureDeadline());

      expect(await taskEscrow.totalTasks()).to.equal(1n);
    });

    it('rejects unknown executor agent ids', async function () {
      await expect(
        taskEscrow
          .connect(requester)
          .createTask(99n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, futureDeadline())
      ).to.be.revertedWith('TaskEscrow: unknown executor agent');
    });
  });

  describe('acceptTask', function () {
    beforeEach(async function () {
      await taskEscrow
        .connect(requester)
        .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, futureDeadline());
      await taskEscrow.connect(requester).fundTask(1n, { value: TASK_AMOUNT });
    });

    it('allows the registered agent owner to accept when no operator wallet is set', async function () {
      await expect(taskEscrow.connect(executorOwner).acceptTask(1n))
        .to.emit(taskEscrow, 'TaskAccepted')
        .withArgs(1n, 1n);

      const task = await taskEscrow.getTask(1n);
      expect(task.executor).to.equal(await executorOwner.getAddress());
      expect(task.status).to.equal(2n);
    });

    it('allows the linked operator wallet to accept after ERC-8004 wallet verification', async function () {
      const deadline = await typedDataDeadline();
      const signature = await operatorWallet.signTypedData(
        await registryDomain(agentRegistry),
        {
          SetAgentWallet: [
            { name: 'agentId', type: 'uint256' },
            { name: 'newWallet', type: 'address' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        {
          agentId: 1n,
          newWallet: await operatorWallet.getAddress(),
          deadline,
        }
      );

      await agentRegistry
        .connect(executorOwner)
        .setAgentWallet(1n, await operatorWallet.getAddress(), deadline, signature);

      await expect(taskEscrow.connect(operatorWallet).acceptTask(1n))
        .to.emit(taskEscrow, 'TaskAccepted')
        .withArgs(1n, 1n);

      const task = await taskEscrow.getTask(1n);
      expect(task.executor).to.equal(await operatorWallet.getAddress());
    });

    it('rejects callers that are not the registered executor wallet', async function () {
      await expect(taskEscrow.connect(owner).acceptTask(1n)).to.be.revertedWith(
        'TaskEscrow: caller is not registered executor'
      );
    });
  });

  describe('funding and dispute lifecycle', function () {
    beforeEach(async function () {
      await taskEscrow
        .connect(requester)
        .createTask(1n, TASK_AMOUNT, ethers.ZeroAddress, REQUIREMENTS_CID, futureDeadline());
    });

    it('funds a task with ETH and emits payment events', async function () {
      await expect(taskEscrow.connect(requester).fundTask(1n, { value: TASK_AMOUNT }))
        .to.emit(taskEscrow, 'TaskFunded')
        .withArgs(1n, TASK_AMOUNT, ethers.ZeroAddress)
        .and.to.emit(taskEscrow, 'PaymentReceived');
    });

    it('allows requester disputes after funding', async function () {
      await taskEscrow.connect(requester).fundTask(1n, { value: TASK_AMOUNT });

      await expect(taskEscrow.connect(requester).disputeTask(1n))
        .to.emit(taskEscrow, 'TaskDisputed')
        .withArgs(1n, await requester.getAddress());
    });
  });
});

function futureDeadline() {
  return Math.floor(Date.now() / 1000) + 86400;
}

async function typedDataDeadline() {
  const block = await ethers.provider.getBlock('latest');
  return BigInt((block?.timestamp ?? Math.floor(Date.now() / 1000)) + 3600);
}

async function registryDomain(agentRegistry: AgentRegistry) {
  const { chainId } = await ethers.provider.getNetwork();
  return {
    name: 'AgentMesh Agent Identity',
    version: '1',
    chainId,
    verifyingContract: await agentRegistry.getAddress(),
  };
}
