import { ethers } from 'hardhat';

type SeedAgent = {
  name: string;
  role: string;
  description: string;
  capabilities: string[];
};

const AGENTS: SeedAgent[] = [
  {
    name: 'Orchestrator Agent',
    role: 'orchestrator',
    description: 'Plans work, coordinates registered agents, and manages approval boundaries.',
    capabilities: ['route_tasks', 'negotiate', 'compose_decisions'],
  },
  {
    name: 'Data Agent',
    role: 'data',
    description: 'Collects vendor and market signals from registered services.',
    capabilities: ['discover_vendors', 'collect_quotes', 'normalize_market_data'],
  },
  {
    name: 'Compute Agent',
    role: 'compute',
    description: 'Uses OpenRouter inference to score vendor bids and reason about risk.',
    capabilities: ['score_bids', 'reason_over_trust', 'recommend_counter_offer'],
  },
  {
    name: 'Executor Agent',
    role: 'executor',
    description: 'Submits Ethereum transactions, updates the audit trail, and finalizes settlement.',
    capabilities: ['create_escrow', 'fund_settlement', 'complete_task'],
  },
  {
    name: 'Vertex Inference Market',
    role: 'vendor',
    description: 'Offers performant inference capacity with moderate price flexibility.',
    capabilities: ['gpu_inference', 'batch_scoring'],
  },
  {
    name: 'Nimbus Compute Mesh',
    role: 'vendor',
    description: 'Offers lower-cost execution with reliable delivery and tight settlement discipline.',
    capabilities: ['execution', 'transaction_settlement'],
  },
  {
    name: 'Atlas Autonomous Services',
    role: 'vendor',
    description: 'High-reputation premium operator for long-running autonomous tasks.',
    capabilities: ['autonomous_workflows', 'proof_attestation'],
  },
];

function parseRegistrationUri(registrationUri: string): { name?: string } | null {
  if (!registrationUri.startsWith('data:application/json;base64,')) {
    return null;
  }

  try {
    const base64 = registrationUri.replace('data:application/json;base64,', '');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as { name?: string };
  } catch {
    return null;
  }
}

function buildRegistrationDataUri(agent: SeedAgent): string {
  return `data:application/json;base64,${Buffer.from(
    JSON.stringify({
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: agent.name,
      description: agent.description,
      services: [
        {
          name: agent.role,
          type: 'agentmesh',
          description: agent.description,
          capabilities: agent.capabilities,
        },
      ],
      supportedTrust: ['onchain-reputation', 'audit-log', 'filecoin-storage'],
      metadata: {
        role: agent.role,
      },
    })
  ).toString('base64')}`;
}

async function ensureAgentRegistered(
  registry: ethers.Contract,
  owner: ethers.Wallet,
  agent: SeedAgent
): Promise<number> {
  const ownedAgentIds = (await registry.getAgentsByOwner(owner.address)) as any[];

  for (const ownedAgentId of ownedAgentIds) {
    const agentId = Number(ownedAgentId.toString());
    const tokenUri = String(await registry.tokenURI(agentId));
    if (parseRegistrationUri(tokenUri)?.name === agent.name) {
      return agentId;
    }
  }

  const registrationUri = buildRegistrationDataUri(agent);
  const registerTx = await registry.registerAgent(registrationUri);
  const registerReceipt = await registerTx.wait();
  const registeredEvent = registerReceipt.events?.find((event: any) => event.event === 'Registered');
  const agentId = Number(registeredEvent?.args?.agentId?.toString() ?? 0);

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signature = await owner._signTypedData(
    {
      name: 'AgentMesh Agent Identity',
      version: '1',
      chainId: 11155111,
      verifyingContract: registry.address,
    },
    {
      SetAgentWallet: [
        { name: 'agentId', type: 'uint256' },
        { name: 'newWallet', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    {
      agentId,
      newWallet: owner.address,
      deadline,
    }
  );

  const walletTx = await registry.setAgentWallet(agentId, owner.address, deadline, signature);
  await walletTx.wait();

  return agentId;
}

async function main() {
  const registryAddress = process.env.AGENT_REGISTRY_ADDRESS;
  const taskEscrowAddress = process.env.TASK_ESCROW_ADDRESS;
  const reputationOracleAddress = process.env.REPUTATION_ORACLE_ADDRESS;
  const auditLoggerAddress = process.env.AUDIT_LOGGER_ADDRESS;

  if (!registryAddress || !taskEscrowAddress || !reputationOracleAddress || !auditLoggerAddress) {
    throw new Error('Contract addresses are missing from the environment');
  }

  const [deployer] = (await ethers.getSigners()) as unknown as [ethers.Wallet];
  const registry = await ethers.getContractAt(
    [
      'function registerAgent(string agentURI) external returns (uint256 agentId)',
      'function getAgentsByOwner(address ownerAddr) external view returns (uint256[])',
      'function tokenURI(uint256 agentId) external view returns (string)',
      'function setAgentWallet(uint256 agentId,address newWallet,uint256 deadline,bytes signature) external',
      'function getAgent(uint256 agentId) external view returns (tuple(address owner,address operatorWallet,string agentURI,uint256 reputationScore,uint256 taskCount,uint256 successCount,bool active,uint256 registeredAt))',
      'function updateReputation(uint256 agentId,bool success,uint256 paymentAmount) external',
      'event Registered(uint256 indexed agentId,string agentURI,address indexed owner)',
    ],
    registryAddress,
    deployer
  );
  const taskEscrow = await ethers.getContractAt(
    [
      'function createTask(uint256 executorAgentId,uint256 amount,address token,string requirementsCID,uint256 deadline) external returns (uint256 taskId)',
      'function getTasksByRequester(address requester) external view returns (uint256[])',
      'function fundTask(uint256 taskId) external payable',
      'function acceptTask(uint256 taskId) external',
      'function completeTask(uint256 taskId,string resultCID) external',
      'event TaskCreated(uint256 indexed taskId,address indexed requester,uint256 executorAgentId,string requirementsCID)',
    ],
    taskEscrowAddress,
    deployer
  );
  const auditLogger = await ethers.getContractAt(
    ['function logDecision(uint256 agentId,bytes32 decisionHash,string ipfsCID) external'],
    auditLoggerAddress,
    deployer
  );

  const agentIds = new Map<string, number>();
  for (const agent of AGENTS) {
    const agentId = await ensureAgentRegistered(registry, deployer, agent);
    agentIds.set(agent.name, agentId);
  }

  const orchestratorId = agentIds.get('Orchestrator Agent');
  const executorId = agentIds.get('Executor Agent');
  const vendorIds = [
    agentIds.get('Vertex Inference Market'),
    agentIds.get('Nimbus Compute Mesh'),
    agentIds.get('Atlas Autonomous Services'),
  ].filter((value): value is number => typeof value === 'number');

  if (!orchestratorId || !executorId || vendorIds.length === 0) {
    throw new Error('Failed to prepare seeded agent identities');
  }

  const seedTasks = [
    {
      executorAgentId: vendorIds[1] ?? vendorIds[0],
      amountWei: ethers.parseEther('0.0094'),
      requirementsCID: 'ipfs://seed-requirements-benchmark',
      resultCID: 'ipfs://seed-result-benchmark',
    },
    {
      executorAgentId: vendorIds[2] ?? vendorIds[0],
      amountWei: ethers.parseEther('0.0101'),
      requirementsCID: 'ipfs://seed-requirements-inference',
      resultCID: 'ipfs://seed-result-inference',
    },
  ];

  for (const [index, taskConfig] of seedTasks.entries()) {
    const deadline = Math.floor(Date.now() / 1000) + 72 * 60 * 60;
    const createTx = await taskEscrow.createTask(
      taskConfig.executorAgentId,
      taskConfig.amountWei,
      ethers.ZeroAddress,
      taskConfig.requirementsCID,
      deadline
    );
    await createTx.wait();
    const requesterTasks = (await taskEscrow.getTasksByRequester(deployer.address)) as bigint[];
    const taskId = Number(requesterTasks[requesterTasks.length - 1] ?? 0n);

    const fundTx = await taskEscrow.fundTask(taskId, { value: taskConfig.amountWei });
    await fundTx.wait();

    const acceptTx = await taskEscrow.acceptTask(taskId);
    await acceptTx.wait();

    const completeTx = await taskEscrow.completeTask(taskId, taskConfig.resultCID);
    await completeTx.wait();

    await auditLogger.logDecision(
      orchestratorId,
      ethers.keccak256(ethers.toUtf8Bytes(`seed-requirements-${taskId}`)),
      taskConfig.requirementsCID
    );
    await auditLogger.logDecision(
      executorId,
      ethers.keccak256(ethers.toUtf8Bytes(`seed-result-${taskId}`)),
      taskConfig.resultCID
    );

    await registry.updateReputation(taskConfig.executorAgentId, true, taskConfig.amountWei);
    await registry.updateReputation(executorId, true, taskConfig.amountWei);

    console.log(`Seeded task ${index + 1}: escrow task #${taskId}`);
  }

  for (const [name, agentId] of agentIds.entries()) {
    const agent = await registry.getAgent(agentId);
    console.log(
      `${name}: agentId=${agentId} rep=${agent.reputationScore.toString()} tasks=${agent.taskCount.toString()}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
