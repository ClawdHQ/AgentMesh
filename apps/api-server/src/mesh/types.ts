import type {
  AgentLogEntry,
  AgentManifest,
  ArtifactReference,
  InternalAgentDescriptor,
  MissionPlan,
  RiskAssessment,
  SettlementRiskFeatures,
  StorageProvider,
} from '@agentmesh/shared';

export type AgentRole =
  | 'orchestrator'
  | 'data'
  | 'compute'
  | 'executor'
  | 'vendor';

export type AgentStatus =
  | 'booting'
  | 'running'
  | 'thinking'
  | 'waiting_payment'
  | 'awaiting_approval'
  | 'halted'
  | 'offline';

export interface PricingModel {
  currency: 'ETH';
  amountWei: string;
  displayAmount: string;
}

export interface OnchainAgentIdentity {
  agentId: number;
  owner: string;
  operatorWallet: string;
  registryAddress: string;
  registrationURI: string;
  registrationTxHash: string;
  walletLinkTxHash: string;
}

export interface MeshAgent {
  key: string;
  name: string;
  role: AgentRole;
  icon: string;
  description: string;
  capabilities: string[];
  status: AgentStatus;
  intent: string;
  address: string;
  reputationScore: number;
  taskCount: number;
  successRate: number;
  pricing?: PricingModel;
  onchain?: OnchainAgentIdentity;
  memoryCID?: string;
  lastActiveAt: number;
}

export interface VendorBid {
  agentKey: string;
  agentName: string;
  agentId?: number;
  initialPriceWei: string;
  counterPriceWei: string;
  floorPriceWei: string;
  reputationScore: number;
  score?: number;
  reasoning?: string;
}

export type TaskStatus =
  | 'draft'
  | 'running'
  | 'awaiting_approval'
  | 'settling'
  | 'completed'
  | 'failed'
  | 'halted';

export interface ApprovalRequest {
  required: boolean;
  thresholdWei: string;
  reason: string;
  requestedAt: number;
}

export interface MeshTask {
  id: string;
  title: string;
  objective: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  autonomyLevel: number;
  budgetWei: string;
  baselinePriceWei: string;
  finalPriceWei?: string;
  savingsWei?: string;
  winnerAgentKey?: string;
  winnerAgentId?: number;
  approval?: ApprovalRequest;
  vendorBids: VendorBid[];
  requirementsCID?: string;
  decisionCID?: string;
  resultCID?: string;
  aiReasoning?: string;
  missionPlan?: MissionPlan;
  riskFeatures?: SettlementRiskFeatures;
  riskAssessment?: RiskAssessment;
  requirementsArtifact?: ArtifactReference;
  resultArtifact?: ArtifactReference;
  memoryArtifact?: ArtifactReference;
  settlement?: {
    taskId: number;
    createTxHash: string;
    fundTxHash: string;
    acceptTxHash: string;
    completeTxHash: string;
  };
  errors: string[];
}

export interface AuditEntry {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  inputHash: string;
  outputHash: string;
  ipfsCID: string;
  timestamp: string;
  txHash?: string;
}

export interface IntentEntry {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  description: string;
  timestamp: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
}

export interface PaymentEvent {
  id: string;
  from: string;
  to: string;
  amount: string;
  currency: 'ETH';
  txHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  taskId?: string;
}

export interface MemorySnapshot {
  version: number;
  cid: string;
  timestamp: number;
  summary: string;
}

export interface RuntimeMetrics {
  registeredAgents: number;
  tasksCompleted: number;
  tasksAwaitingApproval: number;
  decisionsLogged: number;
  totalSettledWei: string;
  totalSavingsWei: string;
  highRiskMissions: number;
}

export interface ServiceStatus {
  key: string;
  url: string;
  ready: boolean;
  lastCheckedAt?: string;
  error?: string;
  agents: InternalAgentDescriptor[];
}

export interface ReadinessStatus {
  state: 'idle' | 'hydrating' | 'ready' | 'error';
  lastHydratedAt?: string;
  inFlight: boolean;
  services: ServiceStatus[];
}

export interface RuntimeSnapshot {
  ready: boolean;
  halted: boolean;
  blockers: string[];
  readiness: ReadinessStatus;
  network: {
    chainId: number;
    label: string;
    registryAddress?: string;
    taskEscrowAddress?: string;
    auditLoggerAddress?: string;
    storageProvider: StorageProvider;
  };
  autonomyLevel: number;
  metrics: RuntimeMetrics;
  manifest: AgentManifest;
  agents: MeshAgent[];
  intents: IntentEntry[];
  tasks: MeshTask[];
  audit: AuditEntry[];
  payments: PaymentEvent[];
  memory: MemorySnapshot[];
  agentLog: AgentLogEntry[];
}

export interface RunMissionInput {
  title?: string;
  objective: string;
  budgetEth: string;
}
