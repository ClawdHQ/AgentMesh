import { expect } from 'chai';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { ethers } from 'hardhat';
import { AgentRegistry } from '../typechain-types';

describe('AgentRegistry', function () {
  let agentRegistry: AgentRegistry;
  let owner: Awaited<ReturnType<typeof ethers.provider.getSigner>>;
  let addr1: Awaited<ReturnType<typeof ethers.provider.getSigner>>;
  let addr2: Awaited<ReturnType<typeof ethers.provider.getSigner>>;

  beforeEach(async function () {
    const [ownerSigner, addr1Signer, addr2Signer] = await ethers.getSigners();
    owner = ownerSigner;
    addr1 = addr1Signer;
    addr2 = addr2Signer;

    const AgentRegistryFactory = await ethers.getContractFactory('AgentRegistry');
    agentRegistry = (await AgentRegistryFactory.deploy(
      await owner.getAddress()
    )) as AgentRegistry;
    await agentRegistry.waitForDeployment();
  });

  describe('registerAgent', function () {
    it('registers an agent identity as ERC-721 token 1', async function () {
      await agentRegistry.registerAgent('ipfs://bafy-test-agent-card');

      expect(await agentRegistry.totalAgents()).to.equal(1n);
      expect(await agentRegistry.ownerOf(1n)).to.equal(await owner.getAddress());
      expect(await agentRegistry.tokenURI(1n)).to.equal('ipfs://bafy-test-agent-card');
    });

    it('emits ERC-8004 registration events', async function () {
      await expect(agentRegistry.registerAgent('ipfs://bafy-test-agent-card'))
        .to.emit(agentRegistry, 'Registered')
        .withArgs(1n, 'ipfs://bafy-test-agent-card', await owner.getAddress())
        .and.to.emit(agentRegistry, 'AgentRegistered')
        .withArgs(1n, await owner.getAddress(), 'ipfs://bafy-test-agent-card', anyValue);
    });

    it('initializes operator wallet metadata to the owner wallet', async function () {
      await agentRegistry.registerAgent('ipfs://bafy-test-agent-card');

      const rawMetadata = await agentRegistry.getMetadata(1n, 'agentWallet');
      const [operatorWallet] = ethers.AbiCoder.defaultAbiCoder().decode(['address'], rawMetadata);

      expect(await agentRegistry.getAgentWallet(1n)).to.equal(await owner.getAddress());
      expect(operatorWallet).to.equal(await owner.getAddress());
    });

    it('sets the initial reputation to 50', async function () {
      await agentRegistry.registerAgent('ipfs://bafy-test-agent-card');
      const agent = await agentRegistry.getAgent(1n);

      expect(agent.reputationScore).to.equal(50n);
      expect(agent.active).to.equal(true);
    });
  });

  describe('setAgentWallet', function () {
    beforeEach(async function () {
      await agentRegistry.registerAgent('ipfs://bafy-test-agent-card');
    });

    it('links an operator wallet after signature verification', async function () {
      const deadline = (await timeLatest()) + 3600n;
      const domain = await buildDomain(agentRegistry);
      const types = {
        SetAgentWallet: [
          { name: 'agentId', type: 'uint256' },
          { name: 'newWallet', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      const value = {
        agentId: 1n,
        newWallet: await addr1.getAddress(),
        deadline,
      };

      const signature = await addr1.signTypedData(domain, types, value);

      await expect(agentRegistry.setAgentWallet(1n, await addr1.getAddress(), deadline, signature))
        .to.emit(agentRegistry, 'AgentWalletSet')
        .withArgs(1n, await addr1.getAddress(), await owner.getAddress());

      expect(await agentRegistry.getAgentWallet(1n)).to.equal(await addr1.getAddress());
    });

    it('rejects an invalid operator wallet signature', async function () {
      const deadline = (await timeLatest()) + 3600n;
      const domain = await buildDomain(agentRegistry);
      const types = {
        SetAgentWallet: [
          { name: 'agentId', type: 'uint256' },
          { name: 'newWallet', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      };
      const value = {
        agentId: 1n,
        newWallet: await addr1.getAddress(),
        deadline,
      };

      const badSignature = await addr2.signTypedData(domain, types, value);

      await expect(
        agentRegistry.setAgentWallet(1n, await addr1.getAddress(), deadline, badSignature)
      ).to.be.revertedWith('AgentRegistry: invalid operator wallet signature');
    });

    it('clears the linked operator wallet on transfer', async function () {
      const deadline = (await timeLatest()) + 3600n;
      const domain = await buildDomain(agentRegistry);
      const signature = await addr1.signTypedData(
        domain,
        {
          SetAgentWallet: [
            { name: 'agentId', type: 'uint256' },
            { name: 'newWallet', type: 'address' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        {
          agentId: 1n,
          newWallet: await addr1.getAddress(),
          deadline,
        }
      );

      await agentRegistry.setAgentWallet(1n, await addr1.getAddress(), deadline, signature);
      await agentRegistry.transferFrom(await owner.getAddress(), await addr2.getAddress(), 1n);

      expect(await agentRegistry.getAgentWallet(1n)).to.equal(ethers.ZeroAddress);
      expect(await agentRegistry.ownerOf(1n)).to.equal(await addr2.getAddress());
    });
  });

  describe('updateReputation', function () {
    beforeEach(async function () {
      await agentRegistry.registerAgent('ipfs://bafy-test-agent-card');
    });

    it('increases reputation on success', async function () {
      await agentRegistry.updateReputation(1n, true, 1_000_000n);
      const agent = await agentRegistry.getAgent(1n);

      expect(agent.reputationScore).to.equal(52n);
      expect(agent.taskCount).to.equal(1n);
      expect(agent.successCount).to.equal(1n);
    });

    it('decreases reputation on failure', async function () {
      await agentRegistry.updateReputation(1n, false, 0n);
      const agent = await agentRegistry.getAgent(1n);

      expect(agent.reputationScore).to.equal(45n);
      expect(agent.taskCount).to.equal(1n);
      expect(agent.successCount).to.equal(0n);
    });

    it('only allows the reputation updater role', async function () {
      const role = await agentRegistry.REPUTATION_UPDATER_ROLE();

      await expect(
        agentRegistry.connect(addr1).updateReputation(1n, true, 1_000_000n)
      )
        .to.be.revertedWithCustomError(agentRegistry, 'AccessControlUnauthorizedAccount')
        .withArgs(await addr1.getAddress(), role);
    });
  });

  describe('query helpers', function () {
    it('returns top agents ordered by reputation', async function () {
      await agentRegistry.connect(owner).registerAgent('ipfs://agent-1');
      await agentRegistry.connect(addr1).registerAgent('ipfs://agent-2');
      await agentRegistry.connect(addr2).registerAgent('ipfs://agent-3');

      await agentRegistry.updateReputation(2n, true, 1_000_000n);
      await agentRegistry.updateReputation(2n, true, 1_000_000n);
      await agentRegistry.updateReputation(3n, true, 1_000_000n);

      const topAgents = await agentRegistry.getTopAgents(3n);
      expect(topAgents[0]).to.equal(2n);
      expect(topAgents).to.deep.equal([2n, 3n, 1n]);
    });

    it('returns current tokens owned by an address', async function () {
      await agentRegistry.registerAgent('ipfs://agent-1');
      await agentRegistry.registerAgent('ipfs://agent-2');
      await agentRegistry.transferFrom(await owner.getAddress(), await addr1.getAddress(), 2n);

      expect(await agentRegistry.getAgentsByOwner(await owner.getAddress())).to.deep.equal([1n]);
      expect(await agentRegistry.getAgentsByOwner(await addr1.getAddress())).to.deep.equal([2n]);
    });
  });
});

async function buildDomain(agentRegistry: AgentRegistry) {
  const { chainId } = await ethers.provider.getNetwork();
  return {
    name: 'AgentMesh Agent Identity',
    version: '1',
    chainId,
    verifyingContract: await agentRegistry.getAddress(),
  };
}

async function timeLatest() {
  const block = await ethers.provider.getBlock('latest');
  return BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));
}
