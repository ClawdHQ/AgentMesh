export type AgentStatus = 'running' | 'thinking' | 'halted' | 'waiting_payment' | 'idle' | 'offline';

export interface AgentState {
  agentId: string;
  agentName: string;
  status: AgentStatus;
  intent?: string;
  reputationScore?: number;
  taskCount?: number;
  successRate?: number;
  capabilities?: string[];
  address?: string;
  timestamp: number;
}

export interface IntentEntry {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  description: string;
  target?: string;
  timestamp: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
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

export interface PaymentEvent {
  id: string;
  from: string;
  to: string;
  amount: string;
  currency: string;
  txHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  taskId?: string;
}

export interface HaltState {
  halted: boolean;
  reason?: string;
}

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export interface DemoResult {
  success: boolean;
  scenario: string;
  steps: Array<{
    step: string;
    description: string;
    timestamp: string;
    data?: unknown;
  }>;
  savings: number;
  auditCID: string | null;
  requiresHumanApproval?: boolean;
  negotiationResult?: unknown;
}
