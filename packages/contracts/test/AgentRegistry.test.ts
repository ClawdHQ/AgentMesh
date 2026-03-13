import { expect } from 'chai';
import { ethers } from 'hardhat';
import { AgentRegistry } from '../typechain-types';

describe('AgentRegistry', function () {
  let agentRegistry: AgentRegistry;
  let owner: ReturnType<typeof ethers.provider.getSigner> extends Promise<infer T> ? T : never;
  let addr1: ReturnType<typeof ethers.provider.getSigner> extends Promise<infer T> ? T : never;

  beforeEach(async function () {
    const [ownerSigner, addr1Signer] = await ethers.getSigners();
    owner = ownerSigner;
    addr1 = addr1Signer;

    const AgentRegistryFactory = await ethers.getContractFactory('AgentRegistry');
    agentRegistry = (await AgentRegistryFactory.deploy(
      await owner.getAddress()
    )) as AgentRegistry;
    await agentRegistry.waitForDeployment();
  });

  describe('registerAgent', function () {
    it('should register an agent and return agentId 1', async function () {
      const tx = await agentRegistry.registerAgent('QmTestCID1234');
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;

      const agentId = await agentRegistry.totalAgents();
      expect(agentId).to.equal(1n);
    });

    it('should emit AgentRegistered event', async function () {
      await expect(agentRegistry.registerAgent('QmTestCID1234'))
        .to.emit(agentRegistry, 'AgentRegistered')
        .withArgs(1n, await owner.getAddress(), 'QmTestCID1234', await getTimestamp());
    });

    it('should revert with empty CID', async function () {
      await expect(agentRegistry.registerAgent('')).to.be.revertedWith(
        'AgentRegistry: empty agent card CID'
      );
    });

    it('should set initial reputation to 50', async function () {
      await agentRegistry.registerAgent('QmTestCID1234');
      const agent = await agentRegistry.getAgent(1n);
      expect(agent.reputationScore).to.equal(50n);
    });

    it('should mark agent as active', async function () {
      await agentRegistry.registerAgent('QmTestCID1234');
      const agent = await agentRegistry.getAgent(1n);
      expect(agent.active).to.be.true;
    });
  });

  describe('updateReputation', function () {
    beforeEach(async function () {
      await agentRegistry.registerAgent('QmTestCID1234');
    });

    it('should increase reputation on success', async function () {
      await agentRegistry.updateReputation(1n, true, 1000n);
      const agent = await agentRegistry.getAgent(1n);
      expect(agent.reputationScore).to.equal(52n);
    });

    it('should decrease reputation on failure', async function () {
      await agentRegistry.updateReputation(1n, false, 0n);
      const agent = await agentRegistry.getAgent(1n);
      expect(agent.reputationScore).to.equal(45n);
    });

    it('should cap reputation at 100', async function () {
      // Set up near max reputation
      for (let i = 0; i < 25; i++) {
        await agentRegistry.updateReputation(1n, true, 1000n);
      }
      const agent = await agentRegistry.getAgent(1n);
      expect(agent.reputationScore).to.equal(100n);
    });

    it('should not allow negative reputation', async function () {
      for (let i = 0; i < 15; i++) {
        await agentRegistry.updateReputation(1n, false, 0n);
      }
      const agent = await agentRegistry.getAgent(1n);
      expect(agent.reputationScore).to.equal(0n);
    });

    it('should only allow REPUTATION_UPDATER_ROLE', async function () {
      const ROLE = await agentRegistry.REPUTATION_UPDATER_ROLE();
      await expect(
        agentRegistry.connect(addr1).updateReputation(1n, true, 1000n)
      ).to.be.revertedWithCustomError(agentRegistry, 'AccessControlUnauthorizedAccount')
        .withArgs(await addr1.getAddress(), ROLE);
    });
  });

  describe('deactivateAgent', function () {
    beforeEach(async function () {
      await agentRegistry.registerAgent('QmTestCID1234');
    });

    it('should deactivate agent by owner', async function () {
      await agentRegistry.deactivateAgent(1n);
      const agent = await agentRegistry.getAgent(1n);
      expect(agent.active).to.be.false;
    });

    it('should emit AgentDeactivated event', async function () {
      await expect(agentRegistry.deactivateAgent(1n))
        .to.emit(agentRegistry, 'AgentDeactivated')
        .withArgs(1n, await owner.getAddress());
    });

    it('should revert if not owner', async function () {
      await expect(
        agentRegistry.connect(addr1).deactivateAgent(1n)
      ).to.be.revertedWith('AgentRegistry: not authorized');
    });
  });

  describe('getTopAgents', function () {
    it('should return agents sorted by reputation', async function () {
      await agentRegistry.registerAgent('QmCID1');
      await agentRegistry.registerAgent('QmCID2');
      await agentRegistry.registerAgent('QmCID3');

      // Give agent 2 higher reputation
      await agentRegistry.updateReputation(2n, true, 1000n);
      await agentRegistry.updateReputation(2n, true, 1000n);

      const top = await agentRegistry.getTopAgents(3n);
      expect(top[0]).to.equal(2n);
    });
  });
});

async function getTimestamp() {
  const block = await ethers.provider.getBlock('latest');
  return block ? BigInt(block.timestamp + 1) : 0n;
}
