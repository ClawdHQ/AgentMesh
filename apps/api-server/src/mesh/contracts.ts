import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { ethers } from 'ethers';
import type {
  AuditEntry,
  MemorySnapshot,
  MeshAgent,
  MeshTask,
  OnchainAgentIdentity,
  PaymentEvent,
} from './types';

const execFileAsync = promisify(execFile);
const FILECOIN_STORAGE_PROVIDER = process.env.FILECOIN_STORAGE_PROVIDER ?? 'lighthouse';
const FILECOIN_PIN_COMMAND =
  process.env.FILECOIN_PIN_COMMAND ?? resolveFilecoinPinCommand();
const PUBLIC_DASHBOARD_URL = (process.env.PUBLIC_DASHBOARD_URL ?? 'https://agent-mesh-os.vercel.app').replace(
  /\/$/,
  ''
);

const agentRegistryAbi = [
  'function registerAgent(string agentURI) external returns (uint256 agentId)',
  'function getAgentsByOwner(address ownerAddr) external view returns (uint256[])',
  'function tokenURI(uint256 agentId) external view returns (string)',
  'function ownerOf(uint256 agentId) external view returns (address)',
  'function getAgentWallet(uint256 agentId) external view returns (address)',
  'function getAgent(uint256 agentId) external view returns (tuple(address owner,address operatorWallet,string agentURI,uint256 reputationScore,uint256 taskCount,uint256 successCount,bool active,uint256 registeredAt))',
  'function setAgentWallet(uint256 agentId,address newWallet,uint256 deadline,bytes signature) external',
  'function updateReputation(uint256 agentId,bool success,uint256 paymentAmount) external',
  'event Registered(uint256 indexed agentId,string agentURI,address indexed owner)',
];

const taskEscrowAbi = [
  'function createTask(uint256 executorAgentId,uint256 amount,address token,string requirementsCID,uint256 deadline) external returns (uint256 taskId)',
  'function fundTask(uint256 taskId) external payable',
  'function acceptTask(uint256 taskId) external',
  'function completeTask(uint256 taskId,string resultCID) external',
  'function getTask(uint256 taskId) external view returns (tuple(uint256 taskId,address requester,address executor,uint256 executorAgentId,uint256 amount,address token,uint8 status,string requirementsCID,string resultCID,uint256 createdAt,uint256 deadline))',
  'function totalTasks() external view returns (uint256)',
  'event TaskCreated(uint256 indexed taskId,address indexed requester,uint256 executorAgentId,string requirementsCID)',
  'event TaskFunded(uint256 indexed taskId,uint256 amount,address token)',
  'event TaskAccepted(uint256 indexed taskId,uint256 executorAgentId)',
  'event TaskCompleted(uint256 indexed taskId,string resultCID,uint256 paymentAmount)',
];

const auditLoggerAbi = [
  'function logDecision(uint256 agentId,bytes32 decisionHash,string ipfsCID) external',
  'function totalDecisions() external view returns (uint256)',
  'function getDecisionCount(uint256 agentId) external view returns (uint256)',
  'function getDecision(uint256 agentId,uint256 index) external view returns (tuple(uint256 agentId,bytes32 decisionHash,string ipfsCID,uint256 timestamp,address logger))',
  'event DecisionLogged(uint256 indexed agentId,bytes32 indexed decisionHash,string ipfsCID,uint256 timestamp,address logger)',
];

const reputationOracleAbi = [
  'function recordReputation(uint256 agentId,uint256 score,uint256 taskCount,uint256 successCount) external',
  'function getReputation(uint256 agentId) external view returns (tuple(uint256 agentId,uint256 score,uint256 taskCount,uint256 successCount,uint256 lastUpdated))',
];

export interface MeshContractConfig {
  chainId: number;
  rpcUrl: string;
  registryAddress: string;
  taskEscrowAddress: string;
  auditLoggerAddress: string;
  reputationOracleAddress: string;
}

export interface SettlementResult {
  taskId: number;
  createTxHash: string;
  fundTxHash: string;
  acceptTxHash: string;
  completeTxHash: string;
}

export interface HydratedDashboardState {
  tasks: MeshTask[];
  audit: AuditEntry[];
  payments: PaymentEvent[];
  memory: MemorySnapshot[];
  latestBlock: number;
}

export class MeshContractsClient {
  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly registry: ethers.Contract;
  private readonly taskEscrow: ethers.Contract;
  private readonly auditLogger: ethers.Contract;
  private readonly reputationOracle: ethers.Contract;

  constructor(
    private readonly config: MeshContractConfig,
    private readonly operatorWallet: ethers.Wallet
  ) {
    this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    const signer = operatorWallet.connect(this.provider);

    this.registry = new ethers.Contract(config.registryAddress, agentRegistryAbi, signer);
    this.taskEscrow = new ethers.Contract(config.taskEscrowAddress, taskEscrowAbi, signer);
    this.auditLogger = new ethers.Contract(config.auditLoggerAddress, auditLoggerAbi, signer);
    this.reputationOracle = new ethers.Contract(
      config.reputationOracleAddress,
      reputationOracleAbi,
      signer
    );
  }

  static isConfigured(config: Partial<MeshContractConfig>): config is MeshContractConfig {
    return Boolean(
      config.rpcUrl &&
        config.chainId &&
        isAddress(config.registryAddress) &&
        isAddress(config.taskEscrowAddress) &&
        isAddress(config.auditLoggerAddress) &&
        isAddress(config.reputationOracleAddress)
    );
  }

  getChainId(): number {
    return this.config.chainId;
  }

  getRegistryAddress(): string {
    return this.config.registryAddress;
  }

  getTaskEscrowAddress(): string {
    return this.config.taskEscrowAddress;
  }

  getAuditLoggerAddress(): string {
    return this.config.auditLoggerAddress;
  }

  getReputationOracleAddress(): string {
    return this.config.reputationOracleAddress;
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async ensureRegistered(agent: MeshAgent): Promise<OnchainAgentIdentity> {
    const ownedAgentIds = (await this.registry.getAgentsByOwner(this.operatorWallet.address)) as ethers.BigNumber[];
    let fallbackMatch:
      | {
          agentId: number;
          tokenUri: string;
          operatorWallet: string;
        }
      | undefined;

    for (const ownedAgentId of ownedAgentIds) {
      const tokenUri = String(await this.registry.tokenURI(ownedAgentId));
      const parsed = await inspectRegistrationUri(tokenUri);
      if (parsed?.name !== agent.name) {
        continue;
      }

      const agentId = ownedAgentId.toNumber();
      const operatorWallet = String(await this.registry.getAgentWallet(agentId));

      if (hasPersistentRegistration(tokenUri)) {
        return {
          agentId,
          owner: this.operatorWallet.address,
          operatorWallet,
          registryAddress: this.config.registryAddress,
          registrationURI: tokenUri,
          registrationTxHash: '',
          walletLinkTxHash: '',
        };
      }

      fallbackMatch = {
        agentId,
        tokenUri,
        operatorWallet,
      };
    }

    if (fallbackMatch) {
      return {
        agentId: fallbackMatch.agentId,
        owner: this.operatorWallet.address,
        operatorWallet: fallbackMatch.operatorWallet,
        registryAddress: this.config.registryAddress,
        registrationURI: fallbackMatch.tokenUri,
        registrationTxHash: '',
        walletLinkTxHash: '',
      };
    }

    const registrationUri = await buildRegistrationUri(agent, this.operatorWallet.address);
    const registerTx = await this.registry.registerAgent(registrationUri);
    const registerReceipt = await registerTx.wait();
    const registeredEvent = registerReceipt.events?.find(
      (event: ethers.Event) => event.event === 'Registered'
    );
    const agentId = Number(registeredEvent?.args?.agentId?.toString() ?? 0);

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const walletLinkSignature = await this.operatorWallet._signTypedData(
      {
        name: 'AgentMesh Agent Identity',
        version: '1',
        chainId: this.config.chainId,
        verifyingContract: this.config.registryAddress,
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
        newWallet: this.operatorWallet.address,
        deadline,
      }
    );

    const walletTx = await this.registry.setAgentWallet(
      agentId,
      this.operatorWallet.address,
      deadline,
      walletLinkSignature
    );
    await walletTx.wait();

    return {
      agentId,
      owner: this.operatorWallet.address,
      operatorWallet: this.operatorWallet.address,
      registryAddress: this.config.registryAddress,
      registrationURI: registrationUri,
      registrationTxHash: registerReceipt.transactionHash,
      walletLinkTxHash: walletTx.hash,
    };
  }

  async getOnchainAgent(agentId: number) {
    return this.registry.getAgent(agentId);
  }

  async logDecision(agentId: number, cid: string, body: unknown): Promise<string> {
    const tx = await this.auditLogger.logDecision(agentId, asBytes32(body), cid);
    const receipt = await tx.wait();
    return receipt.transactionHash;
  }

  async updateReputation(agentId: number, success: boolean, paymentAmountWei: string): Promise<string> {
    const tx = await this.registry.updateReputation(agentId, success, paymentAmountWei);
    const receipt = await tx.wait();
    const agent = await this.registry.getAgent(agentId);
    await this.reputationOracle.recordReputation(
      agentId,
      agent.reputationScore,
      agent.taskCount,
      agent.successCount
    );
    return receipt.transactionHash;
  }

  async settleTask(params: {
    executorAgentId: number;
    executorWallet: ethers.Wallet;
    amountWei: string;
    requirementsCID: string;
    resultCID: string;
  }): Promise<SettlementResult> {
    const deadline = Math.floor(Date.now() / 1000) + 72 * 60 * 60;

    const createTx = await this.taskEscrow.createTask(
      params.executorAgentId,
      params.amountWei,
      ethers.constants.AddressZero,
      params.requirementsCID,
      deadline
    );
    const createReceipt = await createTx.wait();
    const createdEvent = createReceipt.events?.find(
      (event: ethers.Event) => event.event === 'TaskCreated'
    );
    const taskId = Number(createdEvent?.args?.taskId?.toString() ?? 0);

    const fundTx = await this.taskEscrow.fundTask(taskId, { value: params.amountWei });
    await fundTx.wait();

    const executorEscrow = this.taskEscrow.connect(params.executorWallet.connect(this.provider));
    const acceptTx = await executorEscrow.acceptTask(taskId);
    await acceptTx.wait();

    const completeTx = await executorEscrow.completeTask(taskId, params.resultCID);
    await completeTx.wait();

    return {
      taskId,
      createTxHash: createReceipt.transactionHash,
      fundTxHash: fundTx.hash,
      acceptTxHash: acceptTx.hash,
      completeTxHash: completeTx.hash,
    };
  }

  async loadDashboardHistory(agents: MeshAgent[]): Promise<HydratedDashboardState> {
    const latestBlock = await this.provider.getBlockNumber();
    const agentById = new Map<number, MeshAgent>();
    for (const agent of agents) {
      if (agent.onchain?.agentId) {
        agentById.set(agent.onchain.agentId, agent);
      }
    }

    const totalTasks = Number((await this.taskEscrow.totalTasks()).toString());
    const historicalTasks = await Promise.all(
      Array.from({ length: totalTasks }, async (_, index) => {
        const taskId = index + 1;
        try {
          return await this.taskEscrow.getTask(taskId);
        } catch {
          return undefined;
        }
      })
    );

    const tasks = historicalTasks
      .filter((task): task is Awaited<ReturnType<typeof this.taskEscrow.getTask>> => Boolean(task))
      .filter((task) => Number(task.status) === 3)
      .map((task) => {
        const taskId = Number(task.taskId.toString());
        const executorAgentId = Number(task.executorAgentId.toString());
        const paymentAmount = String(task.amount.toString());
        const winner = agentById.get(executorAgentId);
        const createdAt = Number(task.createdAt.toString()) * 1000;

        return {
          id: `historical-task-${taskId}`,
          title: winner ? `Historical settlement with ${winner.name}` : `Historical Task #${taskId}`,
          objective: 'Recovered from Ethereum TaskEscrow state',
          status: 'completed' as const,
          createdAt,
          updatedAt: createdAt,
          autonomyLevel: 4,
          budgetWei: paymentAmount,
          baselinePriceWei: paymentAmount,
          finalPriceWei: paymentAmount,
          savingsWei: '0',
          winnerAgentKey: winner?.key,
          winnerAgentId: executorAgentId,
          vendorBids: [],
          requirementsCID: normalizeIpfsValue(String(task.requirementsCID)),
          resultCID: normalizeIpfsValue(String(task.resultCID)),
          settlement: {
            taskId,
            createTxHash: '',
            fundTxHash: '',
            acceptTxHash: '',
            completeTxHash: '',
          },
          errors: [],
        } satisfies MeshTask;
      });

    const payments = historicalTasks
      .filter((task): task is Awaited<ReturnType<typeof this.taskEscrow.getTask>> => Boolean(task))
      .filter((task) => Number(task.status) === 3)
      .map((task) => ({
        id: `historical-payment-${task.taskId.toString()}`,
        from: String(task.requester),
        to: String(task.executor),
        amount: ethers.utils.formatEther(task.amount),
        currency: 'ETH' as const,
        status: 'confirmed' as const,
        timestamp: Number(task.createdAt.toString()) * 1000,
        taskId: `historical-task-${task.taskId.toString()}`,
      }));

    const audit: AuditEntry[] = [];
    for (const [agentId, agent] of agentById.entries()) {
      const decisionCount = Number((await this.auditLogger.getDecisionCount(agentId)).toString());
      if (decisionCount === 0) {
        continue;
      }

      const decisions = await Promise.all(
        Array.from({ length: decisionCount }, (_, index) => this.auditLogger.getDecision(agentId, index))
      );

      for (let index = 0; index < decisions.length; index += 1) {
        const decision = decisions[index];
        const decisionHash = String(decision.decisionHash ?? '').replace(/^0x/, '');
        audit.push({
          id: `historical-audit-${agentId}-${index}`,
          agentId: agent.key,
          agentName: agent.name,
          action: 'onchain_decision',
          inputHash: decisionHash,
          outputHash: decisionHash,
          ipfsCID: normalizeIpfsValue(String(decision.ipfsCID ?? '')),
          timestamp: new Date(Number(decision.timestamp.toString()) * 1000).toISOString(),
        });
      }
    }

    const memory = tasks
      .filter((task) => task.resultCID)
      .map((task, index) => ({
        version: index + 1,
        cid: String(task.resultCID),
        timestamp: task.updatedAt,
        summary: `${task.title} recovered from Sepolia settlement history`,
      }))
      .sort((left, right) => right.timestamp - left.timestamp);

    return {
      tasks: tasks.sort((left, right) => right.updatedAt - left.updatedAt),
      audit: audit.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)),
      payments: payments.sort((left, right) => right.timestamp - left.timestamp),
      memory,
      latestBlock,
    };
  }

  async syncHistory(
    agents: MeshAgent[],
    fromBlock: number,
    toBlock?: number
  ): Promise<HydratedDashboardState> {
    const agentById = new Map<number, MeshAgent>();
    for (const agent of agents) {
      if (agent.onchain?.agentId) {
        agentById.set(agent.onchain.agentId, agent);
      }
    }

    const latestBlock = toBlock ?? (await this.provider.getBlockNumber());
    const effectiveFromBlock =
      fromBlock > 0
        ? fromBlock
        : Math.max(
            0,
            Math.min(
              await this.findDeploymentBlock(this.config.taskEscrowAddress),
              await this.findDeploymentBlock(this.config.auditLoggerAddress)
            )
          );

    const [createdEvents, fundedEvents, acceptedEvents, completedEvents, decisionEvents] = await Promise.all([
      this.taskEscrow.queryFilter(this.taskEscrow.filters.TaskCreated(), effectiveFromBlock, latestBlock),
      this.taskEscrow.queryFilter(this.taskEscrow.filters.TaskFunded(), effectiveFromBlock, latestBlock),
      this.taskEscrow.queryFilter(this.taskEscrow.filters.TaskAccepted(), effectiveFromBlock, latestBlock),
      this.taskEscrow.queryFilter(this.taskEscrow.filters.TaskCompleted(), effectiveFromBlock, latestBlock),
      this.auditLogger.queryFilter(
        this.auditLogger.filters.DecisionLogged(),
        effectiveFromBlock,
        latestBlock
      ),
    ]);

    const createdByTaskId = new Map<number, ethers.Event>();
    const fundedByTaskId = new Map<number, ethers.Event>();
    const acceptedByTaskId = new Map<number, ethers.Event>();
    for (const event of createdEvents) {
      createdByTaskId.set(Number(event.args?.taskId?.toString() ?? 0), event);
    }
    for (const event of fundedEvents) {
      fundedByTaskId.set(Number(event.args?.taskId?.toString() ?? 0), event);
    }
    for (const event of acceptedEvents) {
      acceptedByTaskId.set(Number(event.args?.taskId?.toString() ?? 0), event);
    }

    const blockCache = new Map<number, ethers.providers.Block>();
    const getBlock = async (blockNumber: number) => {
      const cached = blockCache.get(blockNumber);
      if (cached) {
        return cached;
      }

      const block = await this.provider.getBlock(blockNumber);
      blockCache.set(blockNumber, block);
      return block;
    };

    const tasks = await Promise.all(
      completedEvents.map(async (event) => {
        const taskId = Number(event.args?.taskId?.toString() ?? 0);
        const paymentAmount = String(event.args?.paymentAmount?.toString() ?? '0');
        const task = await this.taskEscrow.getTask(taskId);
        const createdEvent = createdByTaskId.get(taskId);
        const fundedEvent = fundedByTaskId.get(taskId);
        const acceptedEvent = acceptedByTaskId.get(taskId);
        const createdBlock = await getBlock(createdEvent?.blockNumber ?? event.blockNumber);
        const completedBlock = await getBlock(event.blockNumber);

        const executorAgentId = Number(task.executorAgentId.toString());
        const winner = agentById.get(executorAgentId);

        return {
          id: `historical-task-${taskId}`,
          title: winner ? `Historical settlement with ${winner.name}` : `Historical Task #${taskId}`,
          objective: 'Recovered from Ethereum TaskEscrow history',
          status: 'completed' as const,
          createdAt: createdBlock.timestamp * 1000,
          updatedAt: completedBlock.timestamp * 1000,
          autonomyLevel: 4,
          budgetWei: paymentAmount,
          baselinePriceWei: paymentAmount,
          finalPriceWei: paymentAmount,
          savingsWei: '0',
          winnerAgentKey: winner?.key,
          winnerAgentId: executorAgentId,
          vendorBids: [],
          requirementsCID: normalizeIpfsValue(String(task.requirementsCID)),
          resultCID: normalizeIpfsValue(String(task.resultCID)),
          settlement: {
            taskId,
            createTxHash: createdEvent?.transactionHash ?? '',
            fundTxHash: fundedEvent?.transactionHash ?? '',
            acceptTxHash: acceptedEvent?.transactionHash ?? '',
            completeTxHash: event.transactionHash,
          },
          errors: [],
        } satisfies MeshTask;
      })
    );

    const payments = await Promise.all(
      completedEvents.map(async (event) => {
        const taskId = Number(event.args?.taskId?.toString() ?? 0);
        const paymentAmount = String(event.args?.paymentAmount?.toString() ?? '0');
        const task = await this.taskEscrow.getTask(taskId);
        const completedBlock = await getBlock(event.blockNumber);

        return {
          id: `historical-payment-${taskId}`,
          from: String(task.requester),
          to: String(task.executor),
          amount: ethers.utils.formatEther(paymentAmount),
          currency: 'ETH' as const,
          txHash: event.transactionHash,
          status: 'confirmed' as const,
          timestamp: completedBlock.timestamp * 1000,
          taskId: `historical-task-${taskId}`,
        } satisfies PaymentEvent;
      })
    );

    const audit = await Promise.all(
      decisionEvents.map(async (event) => {
        const agentId = Number(event.args?.agentId?.toString() ?? 0);
        const agent = agentById.get(agentId);
        const block = await getBlock(event.blockNumber);
        const decisionHash = String(event.args?.decisionHash ?? '').replace(/^0x/, '');

        return {
          id: `historical-audit-${event.transactionHash}-${event.logIndex}`,
          agentId: agent?.key ?? `agent-${agentId}`,
          agentName: agent?.name ?? `Agent #${agentId}`,
          action: 'onchain_decision',
          inputHash: decisionHash,
          outputHash: decisionHash,
          ipfsCID: normalizeIpfsValue(String(event.args?.ipfsCID ?? '')),
          timestamp: new Date(block.timestamp * 1000).toISOString(),
          txHash: event.transactionHash,
        } satisfies AuditEntry;
      })
    );

    const memory = tasks
      .filter((task) => task.resultCID)
      .map((task, index) => ({
        version: index + 1,
        cid: String(task.resultCID),
        timestamp: task.updatedAt,
        summary: `${task.title} recovered from Sepolia settlement history`,
      }))
      .sort((left, right) => right.timestamp - left.timestamp);

    return {
      tasks: tasks.sort((left, right) => right.updatedAt - left.updatedAt),
      audit: audit.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)),
      payments: payments.sort((left, right) => right.timestamp - left.timestamp),
      memory,
      latestBlock,
    };
  }

  private async findDeploymentBlock(address: string): Promise<number> {
    let low = 0;
    let high = await this.provider.getBlockNumber();

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const code = await this.provider.getCode(address, mid);

      if (code === '0x') {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }
}

export function buildRegistrationDataUri(agent: MeshAgent): string {
  const registration = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: agent.name,
    description: agent.description,
    image: `data:text/plain;base64,${Buffer.from(agent.icon).toString('base64')}`,
    services: [
      {
        name: agent.role,
        type: 'agentmesh',
        description: agent.description,
        capabilities: agent.capabilities,
      },
    ],
    supportedTrust: ['onchain-reputation', 'audit-log', 'lit-access-control', 'filecoin-storage'],
    metadata: {
      role: agent.role,
      pricing: agent.pricing ?? null,
    },
  };

  return `data:application/json;base64,${Buffer.from(JSON.stringify(registration)).toString('base64')}`;
}

export function parseRegistrationUri(registrationUri: string): { name?: string } | null {
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

function hasPersistentRegistration(registrationUri: string): boolean {
  return registrationUri.startsWith('ipfs://') || registrationUri.startsWith('https://');
}

function resolveRegistrationUriUrl(registrationUri: string): string | undefined {
  if (registrationUri.startsWith('ipfs://')) {
    return `${registrationGatewayBase()}${registrationUri.replace(/^ipfs:\/\//, '')}`;
  }

  if (registrationUri.startsWith('https://') || registrationUri.startsWith('http://')) {
    return registrationUri;
  }

  return undefined;
}

function registrationGatewayBase(): string {
  const base =
    process.env.FILECOIN_PIN_GATEWAY_URL ??
    process.env.LIGHTHOUSE_GATEWAY_URL ??
    'https://ipfs.io/ipfs/';

  return base.endsWith('/') ? base : `${base}/`;
}

async function buildRegistrationUri(agent: MeshAgent, operatorWallet: string): Promise<string> {
  if (FILECOIN_STORAGE_PROVIDER !== 'filecoin-pin') {
    return buildRegistrationDataUri(agent);
  }

  return uploadAgentCardToFilecoin(agent, operatorWallet);
}

async function uploadAgentCardToFilecoin(agent: MeshAgent, operatorWallet: string): Promise<string> {
  const fileName = `${slugify(agent.name)}-agent-card.json`;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentmesh-registration-'));
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

    return `ipfs://${rootCid}/${fileName}`;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function buildAgentCard(agent: MeshAgent, operatorWallet: string) {
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
        endpoint: `eip155:${process.env.CHAIN_ID ?? '11155111'}:${operatorWallet}`,
      },
    ],
    registrations: [],
    supportedTrust: ['onchain-reputation', 'audit-log', 'lit-access-control', 'filecoin-storage'],
    metadata: {
      role: agent.role,
      pricing: agent.pricing ?? null,
    },
  };
}

function resolveAgentEndpoint(agent: MeshAgent): string | undefined {
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

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function matchCliValue(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match?.[1];
}

function resolveFilecoinPinCommand(): string {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules/.bin/filecoin-pin'),
    path.resolve(__dirname, '../../../../node_modules/.bin/filecoin-pin'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'filecoin-pin';
}

function asBytes32(value: unknown): string {
  return `0x${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function isAddress(value: string | undefined): value is string {
  return Boolean(value && ethers.utils.isAddress(value));
}

function normalizeIpfsValue(value: string): string {
  return value.replace(/^ipfs:\/\//, '');
}
