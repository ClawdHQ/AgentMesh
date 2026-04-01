import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { FilecoinVault } from './filecoin';
import { LitAccessController } from './lit';
import { MeshContractsClient, type MeshContractConfig } from './contracts';
import { OpenRouterClient } from './openrouter';
import type {
  AuditEntry,
  IntentEntry,
  MemorySnapshot,
  MeshAgent,
  MeshTask,
  PaymentEvent,
  RunMissionInput,
  RuntimeMetrics,
  RuntimeSnapshot,
  VendorBid,
} from './types';

export interface MeshRuntimeConfig {
  apiLabel: string;
  chainId: number;
  rpcUrl?: string;
  privateKey?: string;
  registryAddress?: string;
  taskEscrowAddress?: string;
  auditLoggerAddress?: string;
  autonomyLevel: number;
  openRouterApiKey?: string;
  openRouterModel?: string;
  lighthouseApiKey?: string;
  lighthouseGatewayUrl?: string;
  litNetwork?: string;
}

export class StructuredAutonomousSystem extends EventEmitter {
  private readonly agents: MeshAgent[];
  private readonly intents: IntentEntry[] = [];
  private readonly tasks: MeshTask[] = [];
  private readonly audit: AuditEntry[] = [];
  private readonly payments: PaymentEvent[] = [];
  private readonly memory: MemorySnapshot[] = [];
  private readonly blockers: string[] = [];
  private readonly ai: OpenRouterClient;
  private readonly filecoin: FilecoinVault;
  private readonly lit: LitAccessController;
  private readonly provider?: ethers.providers.JsonRpcProvider;
  private readonly operatorWallet?: ethers.Wallet;
  private readonly agentWallets = new Map<string, ethers.Wallet>();

  private autonomyLevel: number;
  private halted = false;
  private contracts?: MeshContractsClient;

  constructor(private readonly config: MeshRuntimeConfig) {
    super();

    this.autonomyLevel = config.autonomyLevel;
    this.ai = new OpenRouterClient(config.openRouterApiKey, config.openRouterModel);
    this.filecoin = new FilecoinVault(config.lighthouseApiKey, config.lighthouseGatewayUrl);
    this.lit = new LitAccessController(config.litNetwork ?? 'datil-dev', 'ethereum');

    if (config.rpcUrl && config.privateKey) {
      this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
      this.operatorWallet = new ethers.Wallet(config.privateKey, this.provider);
    }

    this.agents = createDefaultAgents(this.operatorWallet?.address ?? ethers.constants.AddressZero);
    for (const agent of this.agents) {
      if (this.operatorWallet) {
        this.agentWallets.set(agent.key, this.operatorWallet);
      }
    }
  }

  async initialize(): Promise<void> {
    this.blockers.length = 0;

    if (!this.operatorWallet || !this.provider || !this.config.rpcUrl) {
      this.blockers.push('Ethereum RPC and operator wallet are required to bootstrap the mesh');
      this.emitSnapshot();
      return;
    }

    if (!MeshContractsClient.isConfigured({
      chainId: this.config.chainId,
      rpcUrl: this.config.rpcUrl,
      registryAddress: this.config.registryAddress,
      taskEscrowAddress: this.config.taskEscrowAddress,
      auditLoggerAddress: this.config.auditLoggerAddress,
    })) {
      this.blockers.push('Contract addresses must be configured for AgentRegistry, TaskEscrow, and AuditLogger');
      this.emitSnapshot();
      return;
    }

    const contractConfig: MeshContractConfig = {
      chainId: this.config.chainId,
      rpcUrl: this.config.rpcUrl!,
      registryAddress: this.config.registryAddress!,
      taskEscrowAddress: this.config.taskEscrowAddress!,
      auditLoggerAddress: this.config.auditLoggerAddress!,
    };

    this.contracts = new MeshContractsClient(contractConfig, this.operatorWallet);

    try {
      for (const agent of this.agents) {
        agent.status = 'booting';
        agent.intent = 'Registering ERC-8004 identity';
        this.emitSnapshot();

        const onchain = await this.contracts.ensureRegistered(agent);
        const agentState = await this.contracts.getOnchainAgent(onchain.agentId);

        agent.onchain = onchain;
        agent.address = onchain.operatorWallet;
        agent.reputationScore = Number(agentState.reputationScore.toString());
        agent.taskCount = Number(agentState.taskCount.toString());
        agent.successRate = ratio(
          Number(agentState.successCount.toString()),
          Number(agentState.taskCount.toString())
        );
        agent.status = 'running';
        agent.intent = 'Registered onchain and awaiting work';
        agent.lastActiveAt = Date.now();
      }

      const history = await this.contracts.loadDashboardHistory(this.agents);
      this.tasks.splice(0, this.tasks.length, ...history.tasks);
      this.audit.splice(0, this.audit.length, ...history.audit);
      this.payments.splice(0, this.payments.length, ...history.payments);
      this.memory.splice(0, this.memory.length, ...history.memory);
    } catch (error) {
      this.blockers.push(`Failed to register mesh agents onchain: ${String(error)}`);
    }

    this.emitSnapshot();
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      ready: this.blockers.length === 0,
      halted: this.halted,
      blockers: [...this.blockers],
      network: {
        chainId: this.config.chainId,
        label: this.config.apiLabel,
        registryAddress: this.config.registryAddress,
        taskEscrowAddress: this.config.taskEscrowAddress,
        auditLoggerAddress: this.config.auditLoggerAddress,
      },
      autonomyLevel: this.autonomyLevel,
      metrics: this.getMetrics(),
      agents: this.agents,
      intents: this.intents,
      tasks: this.tasks,
      audit: this.audit,
      payments: this.payments,
      memory: this.memory,
    };
  }

  async runMission(input: RunMissionInput): Promise<MeshTask> {
    this.assertMissionReady();

    const budgetWei = ethers.utils.parseEther(input.budgetEth).toString();
    const task: MeshTask = {
      id: `task-${Date.now()}`,
      title: input.title ?? 'Autonomous Procurement Mission',
      objective: input.objective,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      autonomyLevel: this.autonomyLevel,
      budgetWei,
      baselinePriceWei: budgetWei,
      vendorBids: [],
      errors: [],
    };
    this.tasks.unshift(task);

    const orchestrator = this.requireAgent('orchestrator');
    const dataAgent = this.requireAgent('data');
    const computeAgent = this.requireAgent('compute');
    const executorAgent = this.requireAgent('executor');
    const vendors = this.agents.filter((agent) => agent.role === 'vendor');

    this.updateAgent(orchestrator, 'thinking', 'Breaking the mission into vendor discovery and settlement');
    this.pushIntent(orchestrator, 'MISSION_STARTED', input.objective, 'executing');

    this.updateAgent(dataAgent, 'thinking', 'Collecting vendor bids from registered agents');
    const bids = vendors.map((vendor) => createBidForVendor(vendor));
    task.vendorBids = bids;
    task.updatedAt = Date.now();
    this.pushIntent(
      dataAgent,
      'COLLECTED_BIDS',
      `Collected ${bids.length} vendor bids from registered ERC-8004 identities`,
      'completed'
    );

    this.updateAgent(computeAgent, 'thinking', 'Ranking bids with OpenRouter inference');
    const scoring = await this.ai.scoreVendors({
      objective: input.objective,
      budgetWei,
      bids,
    });

    for (const bid of task.vendorBids) {
      const score = scoring.scorecard.find((entry) => entry.agentKey === bid.agentKey);
      bid.score = score?.score;
      bid.reasoning = score?.rationale;
    }

    const winner = vendors.find((vendor) => vendor.key === scoring.winnerAgentKey) ?? vendors[0];
    const winnerBid = task.vendorBids.find((bid) => bid.agentKey === winner.key);
    const negotiatedPriceWei = clampWei(
      scoring.recommendedCounterPriceWei,
      winnerBid?.floorPriceWei ?? budgetWei,
      winnerBid?.initialPriceWei ?? budgetWei
    );

    task.winnerAgentKey = winner.key;
    task.winnerAgentId = winner.onchain?.agentId;
    task.finalPriceWei = negotiatedPriceWei;
    task.savingsWei = subtractWei(task.baselinePriceWei, negotiatedPriceWei);
    task.aiReasoning = scoring.reasoning;
    task.updatedAt = Date.now();

    this.pushIntent(
      computeAgent,
      'SCORED_BIDS',
      `Selected ${winner.name} as winner with negotiated settlement of ${ethers.utils.formatEther(negotiatedPriceWei)} ETH`,
      'completed'
    );

    const requirementsRecord = {
      taskId: task.id,
      title: task.title,
      objective: task.objective,
      budgetWei: task.budgetWei,
      vendorBids: task.vendorBids,
      selectedWinner: {
        key: winner.key,
        name: winner.name,
        agentId: winner.onchain?.agentId,
        negotiatedPriceWei,
      },
      reasoning: scoring.reasoning,
    };

    const allowedWallets = [this.operatorWallet!.address, winner.address].filter(Boolean);
    const encryptedRequirements = await this.lit.encryptJson(requirementsRecord, allowedWallets);
    const requirementsArtifact = await this.filecoin.storeText(
      `${task.id}-requirements.lit.json`,
      encryptedRequirements.payload
    );
    task.requirementsCID = requirementsArtifact.cid;

    const decisionTxHash = await this.contracts!.logDecision(
      orchestrator.onchain!.agentId,
      `ipfs://${requirementsArtifact.cid}`,
      requirementsRecord
    );
    this.audit.unshift(
      createAuditEntry(orchestrator, 'mission_requirements', requirementsRecord, encryptedRequirements.payload, requirementsArtifact.cid, decisionTxHash)
    );

    const approvalThresholdWei = thresholdForAutonomy(this.autonomyLevel);
    if (requiresApproval(this.autonomyLevel, negotiatedPriceWei, approvalThresholdWei)) {
      task.status = 'awaiting_approval';
      task.approval = {
        required: true,
        thresholdWei: approvalThresholdWei,
        reason: `Autonomy policy requires approval above ${ethers.utils.formatEther(approvalThresholdWei)} ETH`,
        requestedAt: Date.now(),
      };
      task.updatedAt = Date.now();

      this.updateAgent(executorAgent, 'awaiting_approval', 'Waiting for operator approval before onchain settlement');
      this.pushIntent(
        executorAgent,
        'AWAITING_APPROVAL',
        `Waiting for approval to settle ${ethers.utils.formatEther(negotiatedPriceWei)} ETH with ${winner.name}`,
        'pending'
      );
      this.emitSnapshot();
      return task;
    }

    await this.executeSettlement(task.id);
    return this.requireTask(task.id);
  }

  async approveTask(taskId: string): Promise<MeshTask> {
    const task = this.requireTask(taskId);
    if (task.status !== 'awaiting_approval') {
      throw new Error('Task is not awaiting approval');
    }

    this.pushIntent(
      this.requireAgent('executor'),
      'APPROVED',
      `Operator approved settlement for ${task.title}`,
      'completed'
    );

    await this.executeSettlement(taskId);
    return this.requireTask(taskId);
  }

  async setAutonomyLevel(level: number): Promise<void> {
    this.autonomyLevel = level;
    this.emitSnapshot();
  }

  async halt(reason: string): Promise<void> {
    this.halted = true;
    for (const agent of this.agents) {
      agent.status = 'halted';
      agent.intent = `Halted: ${reason}`;
    }
    this.emitSnapshot();
  }

  async resume(): Promise<void> {
    this.halted = false;
    for (const agent of this.agents) {
      agent.status = 'running';
      agent.intent = 'Mesh resumed';
    }
    this.emitSnapshot();
  }

  private async executeSettlement(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    const winner = this.requireAgent(task.winnerAgentKey ?? 'vendor-alpha');
    const executor = this.requireAgent('executor');
    const resultPayload = {
      taskId: task.id,
      winnerAgentKey: task.winnerAgentKey,
      winnerAgentId: task.winnerAgentId,
      finalPriceWei: task.finalPriceWei,
      savingsWei: task.savingsWei,
      approvedAt: Date.now(),
    };

    task.status = 'settling';
    task.updatedAt = Date.now();
    this.updateAgent(executor, 'waiting_payment', 'Settling task via TaskEscrow onchain');
    this.emitSnapshot();

    const encryptedResult = await this.lit.encryptJson(resultPayload, [
      this.operatorWallet!.address,
      winner.address,
    ]);
    const resultArtifact = await this.filecoin.storeText(
      `${task.id}-result.lit.json`,
      encryptedResult.payload
    );
    task.resultCID = resultArtifact.cid;

    const settlement = await this.contracts!.settleTask({
      executorAgentId: winner.onchain!.agentId,
      executorWallet: this.agentWallets.get(winner.key) ?? this.operatorWallet!,
      amountWei: task.finalPriceWei ?? task.budgetWei,
      requirementsCID: `ipfs://${task.requirementsCID}`,
      resultCID: `ipfs://${resultArtifact.cid}`,
    });
    task.settlement = settlement;
    task.status = 'completed';
    task.updatedAt = Date.now();

    const settlementTxHash = await this.contracts!.logDecision(
      executor.onchain!.agentId,
      `ipfs://${resultArtifact.cid}`,
      resultPayload
    );

    this.audit.unshift(
      createAuditEntry(executor, 'task_settlement', resultPayload, encryptedResult.payload, resultArtifact.cid, settlementTxHash)
    );
    this.payments.unshift({
      id: `payment-${Date.now()}`,
      from: this.operatorWallet!.address,
      to: winner.address,
      amount: ethers.utils.formatEther(task.finalPriceWei ?? task.budgetWei),
      currency: 'ETH',
      txHash: settlement.completeTxHash,
      status: 'confirmed',
      timestamp: Date.now(),
      taskId: task.id,
    });

    await this.contracts!.updateReputation(winner.onchain!.agentId, true, task.finalPriceWei ?? task.budgetWei);
    await this.contracts!.updateReputation(executor.onchain!.agentId, true, task.finalPriceWei ?? task.budgetWei);

    winner.taskCount += 1;
    winner.reputationScore = Math.min(100, winner.reputationScore + 2);
    winner.successRate = ratio(Math.round(winner.successRate * Math.max(winner.taskCount - 1, 0) + 1), winner.taskCount);

    executor.taskCount += 1;
    executor.reputationScore = Math.min(100, executor.reputationScore + 2);
    executor.successRate = ratio(Math.round(executor.successRate * Math.max(executor.taskCount - 1, 0) + 1), executor.taskCount);

    this.updateAgent(winner, 'running', `Settlement completed for ${task.title}`);
    this.updateAgent(executor, 'running', `Escrow released ${ethers.utils.formatEther(task.finalPriceWei ?? task.budgetWei)} ETH`);
    this.pushIntent(
      winner,
      'SETTLEMENT_CONFIRMED',
      `Accepted and completed onchain settlement for ${task.title}`,
      'completed'
    );

    const memoryArtifact = await this.filecoin.storeJson(`${task.id}-memory.json`, {
      taskId: task.id,
      objective: task.objective,
      finalPriceWei: task.finalPriceWei,
      savingsWei: task.savingsWei,
      settlement,
      updatedAt: Date.now(),
    });
    this.memory.unshift({
      version: this.memory.length + 1,
      cid: memoryArtifact.cid,
      timestamp: Date.now(),
      summary: `${task.title} settled with ${winner.name}`,
    });

    this.emitSnapshot();
  }

  private getMetrics(): RuntimeMetrics {
    return {
      registeredAgents: this.agents.filter((agent) => agent.onchain).length,
      tasksCompleted: this.tasks.filter((task) => task.status === 'completed').length,
      tasksAwaitingApproval: this.tasks.filter((task) => task.status === 'awaiting_approval').length,
      decisionsLogged: this.audit.length,
      totalSettledWei: this.payments.reduce(
        (total, payment) => ethers.BigNumber.from(total).add(ethers.utils.parseEther(payment.amount)).toString(),
        '0'
      ),
      totalSavingsWei: this.tasks.reduce(
        (total, task) => ethers.BigNumber.from(total).add(task.savingsWei ?? '0').toString(),
        '0'
      ),
    };
  }

  private emitSnapshot(): void {
    this.emit('snapshot', this.getSnapshot());
  }

  private updateAgent(agent: MeshAgent, status: MeshAgent['status'], intent: string): void {
    agent.status = status;
    agent.intent = intent;
    agent.lastActiveAt = Date.now();
    this.emitSnapshot();
  }

  private pushIntent(
    agent: MeshAgent,
    action: string,
    description: string,
    status: IntentEntry['status']
  ): void {
    this.intents.unshift({
      id: `intent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      agentId: agent.key,
      agentName: agent.name,
      action,
      description,
      timestamp: Date.now(),
      status,
    });
    this.emitSnapshot();
  }

  private requireAgent(key: string): MeshAgent {
    const agent = this.agents.find((candidate) => candidate.key === key);
    if (!agent) {
      throw new Error(`Unknown agent ${key}`);
    }
    return agent;
  }

  private requireTask(taskId: string): MeshTask {
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error(`Unknown task ${taskId}`);
    }
    return task;
  }

  private assertMissionReady(): void {
    if (this.halted) {
      throw new Error('Mesh is halted');
    }
    if (this.blockers.length > 0) {
      throw new Error(this.blockers.join('; '));
    }
    if (!this.ai.isConfigured()) {
      throw new Error('OPENROUTER_API_KEY is required to run the compute agent');
    }
    if (!this.filecoin.isConfigured()) {
      throw new Error('LIGHTHOUSE_API_KEY is required for Filecoin-backed storage');
    }
    if (!this.contracts || !this.operatorWallet) {
      throw new Error('Ethereum contracts are not ready');
    }
  }
}

function createDefaultAgents(operatorAddress: string): MeshAgent[] {
  const now = Date.now();
  return [
    {
      key: 'orchestrator',
      name: 'Orchestrator Agent',
      role: 'orchestrator',
      icon: '◈',
      description: 'Plans work, coordinates registered agents, and manages approval boundaries.',
      capabilities: ['route_tasks', 'negotiate', 'compose_decisions'],
      status: 'offline',
      intent: 'Awaiting bootstrap',
      address: operatorAddress,
      reputationScore: 50,
      taskCount: 0,
      successRate: 1,
      lastActiveAt: now,
    },
    {
      key: 'data',
      name: 'Data Agent',
      role: 'data',
      icon: '◎',
      description: 'Collects vendor and market signals from registered services.',
      capabilities: ['discover_vendors', 'collect_quotes', 'normalize_market_data'],
      status: 'offline',
      intent: 'Awaiting bootstrap',
      address: operatorAddress,
      reputationScore: 50,
      taskCount: 0,
      successRate: 1,
      pricing: pricing('0.0003'),
      lastActiveAt: now,
    },
    {
      key: 'compute',
      name: 'Compute Agent',
      role: 'compute',
      icon: '∆',
      description: 'Uses OpenRouter inference to score vendor bids and reason about risk.',
      capabilities: ['score_bids', 'reason_over_trust', 'recommend_counter_offer'],
      status: 'offline',
      intent: 'Awaiting bootstrap',
      address: operatorAddress,
      reputationScore: 50,
      taskCount: 0,
      successRate: 1,
      pricing: pricing('0.0007'),
      lastActiveAt: now,
    },
    {
      key: 'executor',
      name: 'Executor Agent',
      role: 'executor',
      icon: '✦',
      description: 'Submits Ethereum transactions, updates the audit trail, and finalizes settlement.',
      capabilities: ['create_escrow', 'fund_settlement', 'complete_task'],
      status: 'offline',
      intent: 'Awaiting bootstrap',
      address: operatorAddress,
      reputationScore: 50,
      taskCount: 0,
      successRate: 1,
      pricing: pricing('0.0012'),
      lastActiveAt: now,
    },
    {
      key: 'vendor-alpha',
      name: 'Vertex Inference Market',
      role: 'vendor',
      icon: '▣',
      description: 'Offers performant inference capacity with moderate price flexibility.',
      capabilities: ['gpu_inference', 'batch_scoring'],
      status: 'offline',
      intent: 'Awaiting bootstrap',
      address: operatorAddress,
      reputationScore: 78,
      taskCount: 12,
      successRate: 0.92,
      lastActiveAt: now,
    },
    {
      key: 'vendor-beta',
      name: 'Nimbus Compute Mesh',
      role: 'vendor',
      icon: '▤',
      description: 'Offers lower-cost execution with reliable delivery and tight settlement discipline.',
      capabilities: ['execution', 'transaction_settlement'],
      status: 'offline',
      intent: 'Awaiting bootstrap',
      address: operatorAddress,
      reputationScore: 84,
      taskCount: 19,
      successRate: 0.95,
      lastActiveAt: now,
    },
    {
      key: 'vendor-gamma',
      name: 'Atlas Autonomous Services',
      role: 'vendor',
      icon: '▥',
      description: 'High-reputation premium operator for long-running autonomous tasks.',
      capabilities: ['autonomous_workflows', 'proof_attestation'],
      status: 'offline',
      intent: 'Awaiting bootstrap',
      address: operatorAddress,
      reputationScore: 91,
      taskCount: 26,
      successRate: 0.98,
      lastActiveAt: now,
    },
  ];
}

function createBidForVendor(vendor: MeshAgent): VendorBid {
  const priceMap: Record<string, { initial: string; floor: string }> = {
    'vendor-alpha': { initial: '0.0105', floor: '0.0088' },
    'vendor-beta': { initial: '0.0098', floor: '0.0079' },
    'vendor-gamma': { initial: '0.0119', floor: '0.0091' },
  };
  const configured = priceMap[vendor.key] ?? { initial: '0.01', floor: '0.009' };

  return {
    agentKey: vendor.key,
    agentName: vendor.name,
    agentId: vendor.onchain?.agentId,
    initialPriceWei: ethers.utils.parseEther(configured.initial).toString(),
    counterPriceWei: ethers.utils.parseEther(configured.initial).toString(),
    floorPriceWei: ethers.utils.parseEther(configured.floor).toString(),
    reputationScore: vendor.reputationScore,
  };
}

function pricing(displayAmount: string) {
  return {
    currency: 'ETH' as const,
    amountWei: ethers.utils.parseEther(displayAmount).toString(),
    displayAmount,
  };
}

function requiresApproval(autonomyLevel: number, amountWei: string, thresholdWei: string) {
  if (autonomyLevel === 0 || autonomyLevel === 1) {
    return true;
  }
  if (autonomyLevel >= 4) {
    return false;
  }

  return ethers.BigNumber.from(amountWei).gt(thresholdWei);
}

function thresholdForAutonomy(level: number) {
  switch (level) {
    case 0:
    case 1:
      return '0';
    case 2:
      return ethers.utils.parseEther('0.004').toString();
    case 3:
      return ethers.utils.parseEther('0.02').toString();
    default:
      return ethers.constants.MaxUint256.toString();
  }
}

function createAuditEntry(
  agent: MeshAgent,
  action: string,
  input: unknown,
  output: unknown,
  cid: string,
  txHash?: string
): AuditEntry {
  return {
    id: `${agent.key}-${Date.now()}`,
    agentId: agent.key,
    agentName: agent.name,
    action,
    inputHash: sha256(input),
    outputHash: sha256(output),
    ipfsCID: cid,
    timestamp: new Date().toISOString(),
    txHash,
  };
}

function sha256(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function clampWei(candidateWei: string, floorWei: string, ceilingWei: string) {
  const candidate = ethers.BigNumber.from(candidateWei);
  const floor = ethers.BigNumber.from(floorWei);
  const ceiling = ethers.BigNumber.from(ceilingWei);

  if (candidate.lt(floor)) return floor.toString();
  if (candidate.gt(ceiling)) return ceiling.toString();
  return candidate.toString();
}

function subtractWei(baseWei: string, subtractedWei: string) {
  const base = ethers.BigNumber.from(baseWei);
  const subtracted = ethers.BigNumber.from(subtractedWei);
  if (subtracted.gte(base)) return '0';
  return base.sub(subtracted).toString();
}

function ratio(successCount: number, taskCount: number) {
  if (taskCount === 0) return 1;
  return Number((successCount / taskCount).toFixed(2));
}
