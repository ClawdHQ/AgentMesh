import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { AgentServiceClient } from '@agentmesh/agent-sdk';
import { ethers } from 'ethers';
import {
  AGENTMESH_VERSION,
  type AgentLogEntry,
  type AgentManifest,
  type ArtifactReference,
  type InternalServiceMetadata,
  type MissionPlan,
  type RiskAssessment,
  type SettlementRiskFeatures,
  type StorageProvider,
  type VendorQuote,
} from '@agentmesh/shared';
import { FilecoinVault } from './filecoin';
import { LitAccessController } from './lit';
import { MeshContractsClient, type MeshContractConfig } from './contracts';
import type {
  AuditEntry,
  IntentEntry,
  MemorySnapshot,
  MeshAgent,
  MeshTask,
  PaymentEvent,
  ReadinessStatus,
  RunMissionInput,
  RuntimeMetrics,
  RuntimeSnapshot,
  ServiceStatus,
  VendorBid,
} from './types';

interface VendorScoringResponse {
  winnerVendorKey: string;
  reasoning: string;
  recommendedCounterPriceWei: string;
  scorecard: Array<{
    vendorKey: string;
    score: number;
    rationale: string;
  }>;
}

export interface MeshRuntimeConfig {
  apiLabel: string;
  chainId: number;
  rpcUrl?: string;
  privateKey?: string;
  registryAddress?: string;
  taskEscrowAddress?: string;
  auditLoggerAddress?: string;
  reputationOracleAddress?: string;
  autonomyLevel: number;
  openRouterApiKey?: string;
  openRouterModel?: string;
  lighthouseApiKey?: string;
  lighthouseGatewayUrl?: string;
  litNetwork?: string;
  filecoinStorageProvider?: StorageProvider;
  orchestratorServiceUrl?: string;
  specialistServiceUrl?: string;
  vendorServiceUrls?: string[];
  internalServiceApiKey?: string;
  impulseApiKey?: string;
  impulseDeploymentId?: string;
  publicApiUrl?: string;
  publicDashboardUrl?: string;
}

export class StructuredAutonomousSystem extends EventEmitter {
  private readonly agents: MeshAgent[];
  private readonly intents: IntentEntry[] = [];
  private readonly tasks: MeshTask[] = [];
  private readonly audit: AuditEntry[] = [];
  private readonly payments: PaymentEvent[] = [];
  private readonly memory: MemorySnapshot[] = [];
  private readonly blockers: string[] = [];
  private readonly agentLog: AgentLogEntry[] = [];
  private readonly artifacts = new Map<string, ArtifactReference & { taskId?: string; kind?: string }>();
  private readonly filecoin: FilecoinVault;
  private readonly lit: LitAccessController;
  private readonly provider?: ethers.providers.JsonRpcProvider;
  private readonly operatorWallet?: ethers.Wallet;
  private readonly agentWallets = new Map<string, ethers.Wallet>();
  private readonly serviceClients: {
    orchestrator?: AgentServiceClient;
    specialist?: AgentServiceClient;
    vendors: AgentServiceClient[];
  };

  private autonomyLevel: number;
  private halted = false;
  private contracts?: MeshContractsClient;
  private readiness: ReadinessStatus = {
    state: 'idle',
    inFlight: false,
    services: [],
  };
  private hydrationPromise?: Promise<void>;
  private poller?: NodeJS.Timeout;
  private lastSyncedBlock = 0;

  constructor(private readonly config: MeshRuntimeConfig) {
    super();

    this.autonomyLevel = config.autonomyLevel;
    this.filecoin = new FilecoinVault(
      config.filecoinStorageProvider,
      config.lighthouseApiKey,
      config.lighthouseGatewayUrl
    );
    this.lit = new LitAccessController(config.litNetwork ?? 'datil-dev', 'ethereum');

    if (config.rpcUrl && config.privateKey) {
      this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
      this.operatorWallet = new ethers.Wallet(config.privateKey, this.provider);
    }

    this.serviceClients = {
      orchestrator: config.orchestratorServiceUrl
        ? new AgentServiceClient(config.orchestratorServiceUrl, config.internalServiceApiKey)
        : undefined,
      specialist: config.specialistServiceUrl
        ? new AgentServiceClient(config.specialistServiceUrl, config.internalServiceApiKey)
        : undefined,
      vendors: (config.vendorServiceUrls ?? [])
        .filter(Boolean)
        .map((url) => new AgentServiceClient(url, config.internalServiceApiKey)),
    };

    this.agents = createDefaultAgents(this.operatorWallet?.address ?? ethers.constants.AddressZero);
    for (const agent of this.agents) {
      if (this.operatorWallet) {
        this.agentWallets.set(agent.key, this.operatorWallet);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.hydrationPromise) {
      return;
    }

    this.readiness = {
      state: 'hydrating',
      inFlight: true,
      services: buildInitialServiceStatuses(this.config),
    };
    this.emitSnapshot();

    this.hydrationPromise = this.hydrate()
      .catch((error) => {
        this.recordAgentLog({
          type: 'error',
          title: 'Runtime hydration failed',
          status: 'failed',
          summary: String(error),
        });
      })
      .finally(() => {
        this.readiness.inFlight = false;
        this.emitSnapshot();
      });
  }

  async awaitReady(timeoutMs: number = 60000): Promise<void> {
    await this.initialize();
    if (!this.hydrationPromise) {
      return;
    }

    await Promise.race([
      this.hydrationPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out waiting for runtime readiness after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    if (!this.getSnapshot().ready) {
      throw new Error(this.blockers.join('; ') || 'Runtime is not ready');
    }
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      ready: this.blockers.length === 0 && this.readiness.state === 'ready',
      halted: this.halted,
      blockers: [...this.blockers],
      readiness: {
        ...this.readiness,
        services: this.readiness.services.map((service) => ({
          ...service,
          agents: service.agents.map((agent) => ({ ...agent })),
        })),
      },
      network: {
        chainId: this.config.chainId,
        label: this.config.apiLabel,
        registryAddress: this.config.registryAddress,
        taskEscrowAddress: this.config.taskEscrowAddress,
        auditLoggerAddress: this.config.auditLoggerAddress,
        storageProvider: this.filecoin.getProvider(),
      },
      autonomyLevel: this.autonomyLevel,
      metrics: this.getMetrics(),
      manifest: this.buildManifest(),
      agents: this.agents,
      intents: this.intents,
      tasks: this.tasks,
      audit: this.audit,
      payments: this.payments,
      memory: this.memory,
      agentLog: this.agentLog,
    };
  }

  getReadiness(): ReadinessStatus {
    return this.getSnapshot().readiness;
  }

  getManifest(): AgentManifest {
    return this.buildManifest();
  }

  getAgentLog(): AgentLogEntry[] {
    return [...this.agentLog];
  }

  getArtifact(cid: string) {
    return this.artifacts.get(cid);
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

    const orchestratorClient = this.requireServiceClient('orchestrator');
    const specialistClient = this.requireServiceClient('specialist');
    const vendorClients = this.serviceClients.vendors;

    this.updateAgent(orchestrator, 'thinking', 'Creating execution plan with the orchestrator service');
    const missionPlan = await orchestratorClient.createMissionPlan({
      objective: input.objective,
      budgetWei,
      autonomyLevel: this.autonomyLevel,
    });
    task.missionPlan = missionPlan;
    this.pushIntent(orchestrator, 'MISSION_PLANNED', missionPlan.summary, 'completed');

    this.updateAgent(dataAgent, 'thinking', 'Collecting live vendor quotes from private mesh services');
    const marketContextResult = await specialistClient.callTask({
      taskId: `${task.id}-market-context`,
      type: 'fetch_market_context',
      payload: {
        objective: input.objective,
        budgetWei,
        autonomyLevel: this.autonomyLevel,
      },
    });
    const marketContext = unwrapTaskResult<Record<string, unknown>>(marketContextResult);

    const quoteLists = await Promise.all(
      vendorClients.map((client) =>
        client.requestQuote({
          objective: input.objective,
          budgetWei,
          taskId: task.id,
        })
      )
    );
    const vendorQuotes = quoteLists.flat();
    if (vendorQuotes.length === 0) {
      throw new Error('No vendor quotes were returned by the internal vendor services');
    }

    task.vendorBids = vendorQuotes.map((quote) => ({
      agentKey: quote.vendorKey,
      agentName: quote.vendorName,
      agentId: this.findAgent(quote.vendorKey)?.onchain?.agentId,
      initialPriceWei: quote.initialPriceWei,
      counterPriceWei: quote.initialPriceWei,
      floorPriceWei: quote.floorPriceWei,
      reputationScore: quote.reputationScore,
    }));
    task.updatedAt = Date.now();
    this.pushIntent(
      dataAgent,
      'COLLECTED_BIDS',
      `Collected ${vendorQuotes.length} live quotes from the private vendor mesh`,
      'completed'
    );

    this.updateAgent(computeAgent, 'thinking', 'Scoring vendors with compute + risk services');
    const scoringResult = await specialistClient.callTask({
      taskId: `${task.id}-score-vendors`,
      type: 'score_vendors',
      payload: {
        objective: input.objective,
        budgetWei,
        marketContext,
        vendors: vendorQuotes,
      },
    });
    const scoring = unwrapTaskResult<VendorScoringResponse>(scoringResult);
    for (const bid of task.vendorBids) {
      const score = scoring.scorecard.find((entry) => entry.vendorKey === bid.agentKey);
      bid.score = score?.score;
      bid.reasoning = score?.rationale;
    }

    const winner = this.requireAgent(scoring.winnerVendorKey);
    const winnerQuote = vendorQuotes.find((quote) => quote.vendorKey === winner.key);
    const winnerBid = task.vendorBids.find((bid) => bid.agentKey === winner.key);
    if (!winnerQuote || !winnerBid) {
      throw new Error(`Winning quote ${scoring.winnerVendorKey} was not found in the collected vendor bids`);
    }

    const negotiatedPriceWei = clampWei(
      scoring.recommendedCounterPriceWei,
      winnerBid.floorPriceWei,
      winnerBid.initialPriceWei
    );

    task.winnerAgentKey = winner.key;
    task.winnerAgentId = winner.onchain?.agentId;
    task.finalPriceWei = negotiatedPriceWei;
    task.savingsWei = subtractWei(task.baselinePriceWei, negotiatedPriceWei);
    task.aiReasoning = scoring.reasoning;
    task.updatedAt = Date.now();

    const riskFeatures: SettlementRiskFeatures = {
      taskId: task.id,
      budgetWei: task.budgetWei,
      baselinePriceWei: task.baselinePriceWei,
      candidatePriceWei: negotiatedPriceWei,
      savingsWei: task.savingsWei ?? '0',
      vendorCount: vendorQuotes.length,
      vendorReputationScore: winnerQuote.reputationScore,
      vendorSuccessRate: winnerQuote.successRate,
      vendorTaskCount: winnerQuote.taskCount,
      autonomyLevel: this.autonomyLevel,
      chainId: this.config.chainId,
      encryptedArtifacts: true,
      storageProvider: this.filecoin.getProvider(),
      historicalTasksCompleted: this.tasks.filter((candidate) => candidate.status === 'completed').length,
      historicalDisputes: this.tasks.filter((candidate) => candidate.errors.length > 0).length,
    };
    task.riskFeatures = riskFeatures;

    const riskPayload = await specialistClient.assessRisk(riskFeatures);
    task.riskAssessment = normalizeRiskAssessment(riskPayload, riskFeatures);

    this.pushIntent(
      computeAgent,
      'SCORED_BIDS',
      `Selected ${winner.name} with a ${task.riskAssessment.label} risk score of ${task.riskAssessment.score.toFixed(2)}`,
      'completed'
    );

    const requirementsRecord = {
      taskId: task.id,
      title: task.title,
      objective: task.objective,
      missionPlan,
      marketContext,
      budgetWei: task.budgetWei,
      vendorQuotes,
      vendorBids: task.vendorBids,
      selectedWinner: {
        key: winner.key,
        name: winner.name,
        agentId: winner.onchain?.agentId,
        negotiatedPriceWei,
      },
      scoring,
      riskAssessment: task.riskAssessment,
    };

    const allowedWallets = [this.operatorWallet!.address, winner.address].filter(Boolean);
    const encryptedRequirements = await this.lit.encryptJson(requirementsRecord, allowedWallets);
    const requirementsArtifact = await this.filecoin.storeText(
      `${task.id}-requirements.lit.json`,
      encryptedRequirements.payload
    );
    this.rememberArtifact(requirementsArtifact, task.id, 'requirements');
    task.requirementsCID = requirementsArtifact.cid;
    task.requirementsArtifact = requirementsArtifact;

    const decisionTxHash = await this.contracts!.logDecision(
      orchestrator.onchain!.agentId,
      requirementsArtifact.uri,
      requirementsRecord
    );
    this.audit.unshift(
      createAuditEntry(
        orchestrator,
        'mission_requirements',
        requirementsRecord,
        encryptedRequirements.payload,
        requirementsArtifact.cid,
        decisionTxHash
      )
    );
    this.recordAgentLog({
      type: 'mission',
      title: `Mission prepared: ${task.title}`,
      status: 'completed',
      taskId: task.id,
      cid: requirementsArtifact.cid,
      txHash: decisionTxHash,
      summary: `Prepared mission requirements and logged the decision receipt onchain.`,
      details: {
        winnerAgentKey: winner.key,
        riskScore: task.riskAssessment.score,
      },
    });

    const approvalThresholdWei = thresholdForAutonomy(this.autonomyLevel);
    if (shouldRequestApproval(this.autonomyLevel, negotiatedPriceWei, approvalThresholdWei, task.riskAssessment)) {
      task.status = 'awaiting_approval';
      task.approval = {
        required: true,
        thresholdWei: approvalThresholdWei,
        reason: approvalReason(approvalThresholdWei, task.riskAssessment),
        requestedAt: Date.now(),
      };
      task.updatedAt = Date.now();

      this.updateAgent(
        executorAgent,
        'awaiting_approval',
        'Waiting for operator approval before onchain settlement'
      );
      this.pushIntent(
        executorAgent,
        'AWAITING_APPROVAL',
        `Waiting for approval to settle ${ethers.utils.formatEther(negotiatedPriceWei)} ETH with ${winner.name}`,
        'pending'
      );
      this.recordAgentLog({
        type: 'approval',
        title: `Approval required for ${task.title}`,
        status: 'pending',
        taskId: task.id,
        summary: task.approval.reason,
      });
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
    this.recordAgentLog({
      type: 'approval',
      title: `Approval granted for ${task.title}`,
      status: 'completed',
      taskId,
    });

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
    this.recordAgentLog({
      type: 'error',
      title: 'Mesh halted',
      status: 'completed',
      summary: reason,
    });
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

  private async hydrate(): Promise<void> {
    this.blockers.length = 0;
    this.recordAgentLog({
      type: 'hydration',
      title: 'Runtime hydration started',
      status: 'pending',
    });

    if (!this.operatorWallet || !this.provider || !this.config.rpcUrl) {
      this.blockers.push('Ethereum RPC and operator wallet are required to bootstrap the mesh');
      this.markReadiness('error');
      return;
    }

    if (!MeshContractsClient.isConfigured({
      chainId: this.config.chainId,
      rpcUrl: this.config.rpcUrl,
      registryAddress: this.config.registryAddress,
      taskEscrowAddress: this.config.taskEscrowAddress,
      auditLoggerAddress: this.config.auditLoggerAddress,
      reputationOracleAddress: this.config.reputationOracleAddress,
    })) {
      this.blockers.push(
        'Contract addresses must be configured for AgentRegistry, TaskEscrow, AuditLogger, and ReputationOracle'
      );
      this.markReadiness('error');
      return;
    }

    try {
      await this.filecoin.connect();
    } catch (error) {
      this.blockers.push(`Filecoin storage is not ready: ${String(error)}`);
    }

    const contractConfig: MeshContractConfig = {
      chainId: this.config.chainId,
      rpcUrl: this.config.rpcUrl!,
      registryAddress: this.config.registryAddress!,
      taskEscrowAddress: this.config.taskEscrowAddress!,
      auditLoggerAddress: this.config.auditLoggerAddress!,
      reputationOracleAddress: this.config.reputationOracleAddress!,
    };
    this.contracts = new MeshContractsClient(contractConfig, this.operatorWallet);

    await this.refreshServiceMetadata();

    if (!this.serviceClients.orchestrator) {
      this.blockers.push('ORCHESTRATOR_SERVICE_URL must be configured');
    }
    if (!this.serviceClients.specialist) {
      this.blockers.push('SPECIALIST_SERVICE_URL must be configured');
    }
    if (this.serviceClients.vendors.length === 0) {
      this.blockers.push('At least one VENDOR_SERVICE_URLS entry must be configured');
    }

    if (this.blockers.length > 0) {
      this.markReadiness('error');
      return;
    }

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
      this.replaceHistory(history);
      this.lastSyncedBlock = history.latestBlock;
      this.startPolling();
      this.markReadiness('ready');
      this.recordAgentLog({
        type: 'hydration',
        title: 'Runtime hydration complete',
        status: 'completed',
        summary: `Hydrated ${this.agents.length} agents and synced ${history.tasks.length} tasks from Sepolia.`,
      });
    } catch (error) {
      this.blockers.push(`Failed to bootstrap the mesh: ${String(error)}`);
      this.markReadiness('error');
    }
  }

  private async refreshServiceMetadata(): Promise<void> {
    const nextStatuses: ServiceStatus[] = [];

    const entries: Array<{ key: string; client?: AgentServiceClient }> = [
      { key: 'orchestrator-service', client: this.serviceClients.orchestrator },
      { key: 'specialist-service', client: this.serviceClients.specialist },
      ...this.serviceClients.vendors.map((client, index) => ({
        key: `vendor-service-${index + 1}`,
        client,
      })),
    ];

    for (const entry of entries) {
      if (!entry.client) {
        continue;
      }

      try {
        const [health, metadata] = await Promise.all([entry.client.health(), entry.client.metadata()]);
        nextStatuses.push({
          key: entry.key,
          url: entry.client.url,
          ready: String(health.status ?? 'ok') === 'ok' && metadata.ready !== false,
          lastCheckedAt: new Date().toISOString(),
          agents: metadata.agents,
        });
        this.applyServiceMetadata(metadata);
      } catch (error) {
        nextStatuses.push({
          key: entry.key,
          url: entry.client.url,
          ready: false,
          lastCheckedAt: new Date().toISOString(),
          error: String(error),
          agents: [],
        });
        if (!this.blockers.includes(`${entry.key} is unavailable`)) {
          this.blockers.push(`${entry.key} is unavailable`);
        }
      }
    }

    for (const status of nextStatuses) {
      removeBlocker(this.blockers, `${status.key} is unavailable`);
      if (!status.ready) {
        this.blockers.push(`${status.key} is unavailable`);
      }
    }

    this.readiness.services = nextStatuses;
    this.emitSnapshot();
  }

  private applyServiceMetadata(metadata: InternalServiceMetadata): void {
    for (const descriptor of metadata.agents) {
      const agent = this.findAgent(descriptor.key);
      if (!agent) {
        continue;
      }

      agent.name = descriptor.name;
      agent.description = descriptor.description;
      agent.capabilities = descriptor.capabilities;
      if (descriptor.address) {
        agent.address = descriptor.address;
      }
      if (descriptor.pricing) {
        agent.pricing = {
          currency: 'ETH',
          amountWei: descriptor.pricing.amount,
          displayAmount: ethers.utils.formatEther(descriptor.pricing.amount),
        };
      }
      if (metadata.ready && agent.status === 'offline') {
        agent.status = 'running';
      }
    }
  }

  private async executeSettlement(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    const winner = this.requireAgent(task.winnerAgentKey ?? 'vendor-alpha');
    const executor = this.requireAgent('executor');
    const specialistClient = this.requireServiceClient('specialist');
    const resultPayload = {
      taskId: task.id,
      winnerAgentKey: task.winnerAgentKey,
      winnerAgentId: task.winnerAgentId,
      finalPriceWei: task.finalPriceWei,
      savingsWei: task.savingsWei,
      approvedAt: Date.now(),
      riskAssessment: task.riskAssessment,
    };

    task.status = 'settling';
    task.updatedAt = Date.now();
    this.updateAgent(executor, 'waiting_payment', 'Settling task via TaskEscrow onchain');
    this.emitSnapshot();

    const attestation = await specialistClient.callTask({
      taskId: `${task.id}-attestation`,
      type: 'sign_transaction',
      payload: resultPayload,
    });
    const executorAttestation = unwrapTaskResult<Record<string, unknown>>(attestation);

    const encryptedResult = await this.lit.encryptJson(resultPayload, [
      this.operatorWallet!.address,
      winner.address,
    ]);
    const resultArtifact = await this.filecoin.storeText(
      `${task.id}-result.lit.json`,
      encryptedResult.payload
    );
    this.rememberArtifact(resultArtifact, task.id, 'result');
    task.resultCID = resultArtifact.cid;
    task.resultArtifact = resultArtifact;

    const settlement = await this.contracts!.settleTask({
      executorAgentId: winner.onchain!.agentId,
      executorWallet: this.agentWallets.get(winner.key) ?? this.operatorWallet!,
      amountWei: task.finalPriceWei ?? task.budgetWei,
      requirementsCID: task.requirementsArtifact?.uri ?? `ipfs://${task.requirementsCID}`,
      resultCID: resultArtifact.uri,
    });
    task.settlement = settlement;
    task.status = 'completed';
    task.updatedAt = Date.now();

    const settlementTxHash = await this.contracts!.logDecision(
      executor.onchain!.agentId,
      resultArtifact.uri,
      {
        ...resultPayload,
        executorAttestation,
        settlement,
      }
    );

    this.audit.unshift(
      createAuditEntry(
        executor,
        'task_settlement',
        resultPayload,
        encryptedResult.payload,
        resultArtifact.cid,
        settlementTxHash
      )
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

    await this.syncReputationViaExecutor(winner.onchain!.agentId, true, task.finalPriceWei ?? task.budgetWei, specialistClient);
    await this.syncReputationViaExecutor(executor.onchain!.agentId, true, task.finalPriceWei ?? task.budgetWei, specialistClient);

    winner.taskCount += 1;
    winner.reputationScore = Math.min(100, winner.reputationScore + 2);
    winner.successRate = ratio(
      Math.round(winner.successRate * Math.max(winner.taskCount - 1, 0) + 1),
      winner.taskCount
    );

    executor.taskCount += 1;
    executor.reputationScore = Math.min(100, executor.reputationScore + 2);
    executor.successRate = ratio(
      Math.round(executor.successRate * Math.max(executor.taskCount - 1, 0) + 1),
      executor.taskCount
    );

    this.updateAgent(winner, 'running', `Settlement completed for ${task.title}`);
    this.updateAgent(
      executor,
      'running',
      `Escrow released ${ethers.utils.formatEther(task.finalPriceWei ?? task.budgetWei)} ETH`
    );
    this.pushIntent(
      winner,
      'SETTLEMENT_CONFIRMED',
      `Accepted and completed onchain settlement for ${task.title}`,
      'completed'
    );

    const memoryArtifact = await this.filecoin.storeJson(`${task.id}-memory.json`, {
      taskId: task.id,
      objective: task.objective,
      missionPlan: task.missionPlan,
      riskAssessment: task.riskAssessment,
      finalPriceWei: task.finalPriceWei,
      savingsWei: task.savingsWei,
      settlement,
      updatedAt: Date.now(),
    });
    this.rememberArtifact(memoryArtifact, task.id, 'memory');
    task.memoryArtifact = memoryArtifact;
    this.memory.unshift({
      version: this.memory.length + 1,
      cid: memoryArtifact.cid,
      timestamp: Date.now(),
      summary: `${task.title} settled with ${winner.name}`,
    });

    this.recordAgentLog({
      type: 'settlement',
      title: `Settlement complete: ${task.title}`,
      status: 'completed',
      taskId: task.id,
      txHash: settlement.completeTxHash,
      cid: resultArtifact.cid,
      summary: `Settled ${ethers.utils.formatEther(task.finalPriceWei ?? task.budgetWei)} ETH with ${winner.name}.`,
    });

    this.lastSyncedBlock = await this.contracts!.getLatestBlockNumber();
    this.emitSnapshot();
  }

  private async syncReputationViaExecutor(
    agentId: number,
    success: boolean,
    paymentAmountWei: string,
    specialistClient: AgentServiceClient
  ) {
    try {
      await specialistClient.callTask({
        taskId: `reputation-${agentId}-${Date.now()}`,
        type: 'update_registry',
        payload: {
          agentId,
          success,
          paymentAmountWei,
        },
      });
    } catch {
      await this.contracts!.updateReputation(agentId, success, paymentAmountWei);
    }
  }

  private replaceHistory(history: {
    tasks: MeshTask[];
    audit: AuditEntry[];
    payments: PaymentEvent[];
    memory: MemorySnapshot[];
  }) {
    this.tasks.splice(0, this.tasks.length, ...history.tasks);
    this.audit.splice(0, this.audit.length, ...history.audit);
    this.payments.splice(0, this.payments.length, ...history.payments);
    this.memory.splice(0, this.memory.length, ...history.memory);
  }

  private startPolling() {
    if (this.poller) {
      clearInterval(this.poller);
    }

    this.poller = setInterval(() => {
      void this.refreshServiceMetadata();
      void this.syncOnchainHistory();
    }, 30000);
  }

  private async syncOnchainHistory() {
    if (!this.contracts || this.lastSyncedBlock <= 0) {
      return;
    }

    const latestBlock = await this.contracts.getLatestBlockNumber();
    if (latestBlock <= this.lastSyncedBlock) {
      return;
    }

    const history = await this.contracts.syncHistory(this.agents, this.lastSyncedBlock + 1, latestBlock);
    this.mergeTasks(history.tasks);
    this.mergeAudit(history.audit);
    this.mergePayments(history.payments);
    this.mergeMemory(history.memory);
    this.lastSyncedBlock = history.latestBlock;
    this.emitSnapshot();
  }

  private mergeTasks(tasks: MeshTask[]) {
    for (const task of tasks) {
      if (!this.tasks.some((candidate) => candidate.id === task.id)) {
        this.tasks.unshift(task);
      }
    }
  }

  private mergeAudit(entries: AuditEntry[]) {
    for (const entry of entries) {
      if (!this.audit.some((candidate) => candidate.id === entry.id)) {
        this.audit.unshift(entry);
      }
    }
  }

  private mergePayments(entries: PaymentEvent[]) {
    for (const entry of entries) {
      if (!this.payments.some((candidate) => candidate.id === entry.id)) {
        this.payments.unshift(entry);
      }
    }
  }

  private mergeMemory(entries: MemorySnapshot[]) {
    for (const entry of entries) {
      if (!this.memory.some((candidate) => candidate.cid === entry.cid)) {
        this.memory.unshift(entry);
      }
    }
  }

  private rememberArtifact(artifact: ArtifactReference, taskId: string, kind: string) {
    this.artifacts.set(artifact.cid, {
      ...artifact,
      taskId,
      kind,
    });
  }

  private buildManifest(): AgentManifest {
    const apiUrl = this.config.publicApiUrl ?? `http://localhost:3001`;
    const dashboardUrl = this.config.publicDashboardUrl ?? 'http://localhost:5173';
    return {
      agentId: 'agentmesh-control-plane',
      agentName: 'AgentMesh',
      version: AGENTMESH_VERSION,
      description:
        'Production-grade autonomous agent control plane with ERC-8004 identity, onchain settlement, Filecoin-backed receipts, and human oversight.',
      homepage: dashboardUrl,
      controlPlaneUrl: apiUrl,
      dashboardUrl,
      agentLogUrl: `${apiUrl.replace(/\/$/, '')}/agent_log.json`,
      capabilities: [
        'trust-gated-agent-routing',
        'onchain-settlement',
        'filecoin-backed-receipts',
        'impulse-risk-scoring',
        'human-oversight',
      ],
      tracks: [
        'AI & Robotics',
        'Impulse AI: Autonomous ML for Every App',
        'Agents With Receipts — 8004',
        'Filecoin',
      ],
      receipts: {
        onchainIdentityRegistry: this.config.registryAddress,
        settlementEscrow: this.config.taskEscrowAddress,
        auditLogger: this.config.auditLoggerAddress,
        filecoinArtifacts: this.filecoin.getProvider(),
      },
      networks: {
        sepoliaChainId: this.config.chainId,
        filecoinCalibrationEnabled: this.filecoin.getProvider() === 'filecoin-pin',
      },
      operatorModel: {
        humanOversight: true,
        haltSupported: true,
        approvalRequiredAbove: ethers.utils.formatEther(thresholdForAutonomy(this.autonomyLevel)),
      },
    };
  }

  private markReadiness(state: ReadinessStatus['state']) {
    this.readiness.state = state;
    this.readiness.lastHydratedAt = new Date().toISOString();
    this.emitSnapshot();
  }

  private getMetrics(): RuntimeMetrics {
    return {
      registeredAgents: this.agents.filter((agent) => agent.onchain).length,
      tasksCompleted: this.tasks.filter((task) => task.status === 'completed').length,
      tasksAwaitingApproval: this.tasks.filter((task) => task.status === 'awaiting_approval').length,
      decisionsLogged: this.audit.length,
      totalSettledWei: this.payments.reduce(
        (total, payment) =>
          ethers.BigNumber.from(total).add(ethers.utils.parseEther(payment.amount)).toString(),
        '0'
      ),
      totalSavingsWei: this.tasks.reduce(
        (total, task) => ethers.BigNumber.from(total).add(task.savingsWei ?? '0').toString(),
        '0'
      ),
      highRiskMissions: this.tasks.filter((task) => task.riskAssessment?.label === 'high').length,
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

  private recordAgentLog(entry: Omit<AgentLogEntry, 'id' | 'createdAt'>) {
    this.agentLog.unshift({
      id: `log-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...entry,
    });
    this.agentLog.splice(100);
  }

  private findAgent(key: string): MeshAgent | undefined {
    return this.agents.find((candidate) => candidate.key === key);
  }

  private requireAgent(key: string): MeshAgent {
    const agent = this.findAgent(key);
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

  private requireServiceClient(kind: 'orchestrator' | 'specialist') {
    const client = this.serviceClients[kind];
    if (!client) {
      throw new Error(`${kind} service is not configured`);
    }
    return client;
  }

  private assertMissionReady(): void {
    if (this.halted) {
      throw new Error('Mesh is halted');
    }
    if (this.blockers.length > 0) {
      throw new Error(this.blockers.join('; '));
    }
    if (!this.contracts || !this.operatorWallet) {
      throw new Error('Ethereum contracts are not ready');
    }
    if (this.readiness.state !== 'ready') {
      throw new Error('Runtime is still hydrating');
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
      description: 'Scores vendor bids, predicts settlement risk, and explains the tradeoffs.',
      capabilities: ['score_bids', 'reason_over_trust', 'assess_settlement_risk'],
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

function buildInitialServiceStatuses(config: MeshRuntimeConfig): ServiceStatus[] {
  const urls: Array<[string, string | undefined]> = [
    ['orchestrator-service', config.orchestratorServiceUrl],
    ['specialist-service', config.specialistServiceUrl],
    ...(config.vendorServiceUrls ?? []).map(
      (url, index): [string, string] => [`vendor-service-${index + 1}`, url]
    ),
  ];

  return urls
    .filter(([, url]) => Boolean(url))
    .map(([key, url]) => ({
      key,
      url: String(url),
      ready: false,
      agents: [],
    }));
}

function pricing(displayAmount: string) {
  return {
    currency: 'ETH' as const,
    amountWei: ethers.utils.parseEther(displayAmount).toString(),
    displayAmount,
  };
}

function shouldRequestApproval(
  autonomyLevel: number,
  amountWei: string,
  thresholdWei: string,
  riskAssessment?: RiskAssessment
) {
  if (autonomyLevel === 0 || autonomyLevel === 1) {
    return true;
  }
  if (riskAssessment?.requiresApproval) {
    return true;
  }
  if (autonomyLevel >= 4) {
    return false;
  }

  return ethers.BigNumber.from(amountWei).gt(thresholdWei);
}

function approvalReason(thresholdWei: string, riskAssessment?: RiskAssessment) {
  if (riskAssessment?.requiresApproval) {
    return `Risk policy requires approval because the mission is rated ${riskAssessment.label} risk (${riskAssessment.score.toFixed(2)}).`;
  }
  return `Autonomy policy requires approval above ${ethers.utils.formatEther(thresholdWei)} ETH`;
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

function unwrapTaskResult<T>(result: { success?: boolean; data?: Record<string, unknown>; error?: string }): T {
  if (result.success === false) {
    throw new Error(result.error ?? 'Task execution failed');
  }

  return (result.data?.result ?? result.data ?? {}) as T;
}

function normalizeRiskAssessment(
  payload: Record<string, unknown>,
  fallbackInput: SettlementRiskFeatures
): RiskAssessment {
  const candidate = (payload.assessment ?? payload) as Partial<RiskAssessment>;
  return {
    provider: candidate.provider === 'impulse' ? 'impulse' : 'heuristic',
    score: typeof candidate.score === 'number' ? candidate.score : 0.5,
    label:
      candidate.label === 'low' || candidate.label === 'medium' || candidate.label === 'high'
        ? candidate.label
        : 'medium',
    requiresApproval: Boolean(candidate.requiresApproval),
    rationale:
      typeof candidate.rationale === 'string'
        ? candidate.rationale
        : 'Risk assessment completed by the compute service.',
    evaluatedAt:
      typeof candidate.evaluatedAt === 'string' ? candidate.evaluatedAt : new Date().toISOString(),
    deploymentId: typeof candidate.deploymentId === 'string' ? candidate.deploymentId : undefined,
    modelVersion: typeof candidate.modelVersion === 'string' ? candidate.modelVersion : undefined,
    raw: candidate.raw,
    input: candidate.input ?? fallbackInput,
  };
}

function removeBlocker(blockers: string[], message: string) {
  let index = blockers.indexOf(message);
  while (index !== -1) {
    blockers.splice(index, 1);
    index = blockers.indexOf(message);
  }
}
