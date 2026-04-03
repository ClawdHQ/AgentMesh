export type StorageProvider = 'lighthouse' | 'filecoin-pin';

export interface ArtifactReference {
  cid: string;
  uri: string;
  gatewayUrl: string;
  provider: StorageProvider;
  network: 'ipfs' | 'filecoin-calibration';
  createdAt: string;
  contentType: string;
  sizeBytes?: number;
  pieceCid?: string;
  proofTxHash?: string;
  dataSetId?: string;
}

export interface SettlementRiskFeatures {
  taskId: string;
  budgetWei: string;
  baselinePriceWei: string;
  candidatePriceWei: string;
  savingsWei: string;
  vendorCount: number;
  vendorReputationScore: number;
  vendorSuccessRate: number;
  vendorTaskCount: number;
  autonomyLevel: number;
  chainId: number;
  encryptedArtifacts: boolean;
  storageProvider: StorageProvider;
  historicalTasksCompleted: number;
  historicalDisputes: number;
}

export type RiskLabel = 'low' | 'medium' | 'high';

export interface RiskAssessment {
  provider: 'impulse' | 'heuristic';
  score: number;
  label: RiskLabel;
  requiresApproval: boolean;
  rationale: string;
  evaluatedAt: string;
  deploymentId?: string;
  modelVersion?: string;
  raw?: unknown;
  input: SettlementRiskFeatures;
}

export interface InternalAgentDescriptor {
  key: string;
  name: string;
  role: string;
  url: string;
  description: string;
  capabilities: string[];
  address?: string;
  pricing?: {
    model: 'per-call' | 'subscription';
    amount: string;
    currency: string;
  };
}

export interface InternalServiceMetadata {
  service: string;
  version: string;
  generatedAt: string;
  ready: boolean;
  agents: InternalAgentDescriptor[];
}

export interface VendorQuote {
  vendorKey: string;
  vendorName: string;
  vendorUrl: string;
  agentId?: string;
  onchainAgentId?: number;
  currency: 'ETH';
  initialPriceWei: string;
  floorPriceWei: string;
  reputationScore: number;
  successRate: number;
  taskCount: number;
  features: string[];
  quoteValidUntil: string;
}

export interface MissionPlan {
  summary: string;
  checkpoints: string[];
  approvalPolicy: string;
}

export interface AgentManifest {
  agentId: string;
  agentName: string;
  version: string;
  description: string;
  homepage: string;
  controlPlaneUrl: string;
  dashboardUrl: string;
  agentLogUrl: string;
  capabilities: string[];
  tracks: string[];
  receipts: {
    onchainIdentityRegistry?: string;
    settlementEscrow?: string;
    auditLogger?: string;
    filecoinArtifacts?: string;
  };
  networks: {
    sepoliaChainId: number;
    filecoinCalibrationEnabled: boolean;
  };
  operatorModel: {
    humanOversight: boolean;
    haltSupported: boolean;
    approvalRequiredAbove: string;
  };
}

export interface AgentLogEntry {
  id: string;
  type:
    | 'hydration'
    | 'mission'
    | 'approval'
    | 'settlement'
    | 'audit'
    | 'storage'
    | 'error';
  title: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
  taskId?: string;
  txHash?: string;
  cid?: string;
  summary?: string;
  details?: Record<string, unknown>;
}

export function riskLabelForScore(score: number): RiskLabel {
  if (score >= 0.67) return 'high';
  if (score >= 0.34) return 'medium';
  return 'low';
}
