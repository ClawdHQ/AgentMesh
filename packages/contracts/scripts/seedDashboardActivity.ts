import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { ethers } from 'hardhat';

type SeedAgent = {
  name: string;
  role: string;
  description: string;
  capabilities: string[];
};

type UploadedAgentCard = {
  tokenUri: string;
  rootCid: string;
  dataSetId?: string;
};

const execFileAsync = promisify(execFile);
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '11155111');
const FILECOIN_STORAGE_PROVIDER = process.env.FILECOIN_STORAGE_PROVIDER ?? 'lighthouse';
const FILECOIN_PIN_COMMAND = process.env.FILECOIN_PIN_COMMAND ?? resolveFilecoinPinCommand();
const FILECOIN_PIN_GATEWAY_URL = ensureTrailingSlash(
  process.env.FILECOIN_PIN_GATEWAY_URL ?? 'https://ipfs.io/ipfs/'
);
const PUBLIC_DASHBOARD_URL = (process.env.PUBLIC_DASHBOARD_URL ?? 'https://agent-mesh-os.vercel.app').replace(
  /\/$/,
  ''
);

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

function buildRegistrationDataUri(agent: SeedAgent, operatorWallet: string): string {
  return `data:application/json;base64,${Buffer.from(
    JSON.stringify(buildAgentCard(agent, operatorWallet))
  ).toString('base64')}`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function resolveFilecoinPinCommand(): string {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules/.bin/filecoin-pin'),
    path.resolve(__dirname, '../../../node_modules/.bin/filecoin-pin'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'filecoin-pin';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hasPersistentRegistration(registrationUri: string): boolean {
  return registrationUri.startsWith('ipfs://') || registrationUri.startsWith('https://');
}

function matchCliValue(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match?.[1];
}

function resolveAgentEndpoint(agent: SeedAgent): string | undefined {
  if (agent.role === 'orchestrator') {
    return process.env.ORCHESTRATOR_SERVICE_URL;
  }

  if (agent.role === 'data' || agent.role === 'compute' || agent.role === 'executor') {
    return process.env.SPECIALIST_SERVICE_URL;
  }

  if (agent.role === 'vendor') {
    return (process.env.VENDOR_SERVICE_URLS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)[0];
  }

  return undefined;
}

function buildAgentCard(agent: SeedAgent, operatorWallet: string) {
  const endpoint = resolveAgentEndpoint(agent);

  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: agent.name,
    description: agent.description,
    image: `${PUBLIC_DASHBOARD_URL}/mesh-icon.svg`,
    endpoints: [
      ...(endpoint
        ? [
            {
              name: 'Agent API',
              endpoint,
              version: '1.0.0',
              capabilities: {
                tools: agent.capabilities.map((capability) => ({
                  name: capability,
                  description: `${agent.name} can ${capability.replaceAll('_', ' ')}`,
                })),
              },
            },
          ]
        : []),
      {
        name: 'agentWallet',
        endpoint: `eip155:${CHAIN_ID}:${operatorWallet}`,
      },
    ],
    registrations: [],
    supportedTrust: ['onchain-reputation', 'audit-log', 'filecoin-storage'],
    metadata: {
      role: agent.role,
    },
  };
}

async function inspectRegistrationUri(registrationUri: string): Promise<{ name?: string } | null> {
  const parsed = parseRegistrationUri(registrationUri);
  if (parsed) {
    return parsed;
  }

  const gatewayUrl = resolveRegistrationUriUrl(registrationUri);
  if (!gatewayUrl) {
    return null;
  }

  try {
    const response = await fetch(gatewayUrl);
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { name?: unknown };
    return typeof payload.name === 'string' ? { name: payload.name } : null;
  } catch {
    return null;
  }
}

function resolveRegistrationUriUrl(registrationUri: string): string | undefined {
  if (registrationUri.startsWith('ipfs://')) {
    return `${FILECOIN_PIN_GATEWAY_URL}${registrationUri.replace(/^ipfs:\/\//, '')}`;
  }

  if (registrationUri.startsWith('https://') || registrationUri.startsWith('http://')) {
    return registrationUri;
  }

  return undefined;
}

async function uploadAgentCardToFilecoin(agent: SeedAgent, operatorWallet: string): Promise<UploadedAgentCard> {
  const fileName = `${slugify(agent.name)}-agent-card.json`;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentmesh-agent-card-'));
  const filePath = path.join(tmpDir, fileName);

  try {
    await writeFile(filePath, JSON.stringify(buildAgentCard(agent, operatorWallet), null, 2), 'utf8');
    const { stdout } = await execFileAsync(FILECOIN_PIN_COMMAND, ['add', '--auto-fund', filePath], {
      env: process.env,
    });

    const rootCid = matchCliValue(stdout, /Root CID:\s*([A-Za-z0-9]+)/i);
    if (!rootCid) {
      throw new Error('Filecoin Pin upload did not return a Root CID');
    }

    return {
      tokenUri: `ipfs://${rootCid}/${fileName}`,
      rootCid,
      dataSetId: matchCliValue(stdout, /Data Set ID:\s*([0-9]+)/i),
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function buildRegistrationUri(agent: SeedAgent, operatorWallet: string): Promise<string> {
  if (FILECOIN_STORAGE_PROVIDER !== 'filecoin-pin') {
    return buildRegistrationDataUri(agent, operatorWallet);
  }

  const uploaded = await uploadAgentCardToFilecoin(agent, operatorWallet);
  console.log(
    `Registered ${agent.name} agent card via Filecoin Pin: ${uploaded.tokenUri}${
      uploaded.dataSetId ? ` (dataset ${uploaded.dataSetId})` : ''
    }`
  );
  return uploaded.tokenUri;
}

async function ensureAgentRegistered(
  registry: ethers.Contract,
  owner: ethers.Wallet,
  agent: SeedAgent
): Promise<number> {
  const ownedAgentIds = (await registry.getAgentsByOwner(owner.address)) as any[];
  let fallbackMatch: number | null = null;

  for (const ownedAgentId of ownedAgentIds) {
    const agentId = Number(ownedAgentId.toString());
    const tokenUri = String(await registry.tokenURI(agentId));
    const registration = await inspectRegistrationUri(tokenUri);
    if (registration?.name !== agent.name) {
      continue;
    }

    if (hasPersistentRegistration(tokenUri)) {
      return agentId;
    }

    fallbackMatch = agentId;
  }

  if (fallbackMatch && FILECOIN_STORAGE_PROVIDER !== 'filecoin-pin') {
    return fallbackMatch;
  }

  const registrationUri = await buildRegistrationUri(agent, owner.address);
  const registerTx = await registry.register(registrationUri);
  const registerReceipt = await registerTx.wait();
  const registeredEvent = registerReceipt.events?.find((event: any) => event.event === 'Registered');
  const agentId = Number(registeredEvent?.args?.agentId?.toString() ?? 0);

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const signature = await owner._signTypedData(
    {
      name: 'AgentMesh Agent Identity',
      version: '1',
      chainId: CHAIN_ID,
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
      'function register(string agentURI) external returns (uint256 agentId)',
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
