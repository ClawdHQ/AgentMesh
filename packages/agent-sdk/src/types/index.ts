import { z } from 'zod';

// Agent configuration schema
export const AgentConfigSchema = z.object({
  agentId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
  privateKey: z.string(),
  rpcUrl: z.string().default('https://rpc.sepolia.org'),
  agentRegistryAddress: z.string().optional(),
  taskEscrowAddress: z.string().optional(),
  auditLoggerAddress: z.string().optional(),
  ipfsStorageEmail: z.string().optional(),
  ipfsStorageSpaceDid: z.string().optional(),
  libp2pPort: z.number().default(9000),
  bootstrapPeers: z.array(z.string()).default([]),
  pricing: z.object({
    model: z.enum(['per-call', 'subscription']),
    amount: z.bigint(),
    currency: z.string().default('USDC'),
    token: z.string().optional(),
  }).optional(),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Agent identity schema
export const AgentIdentitySchema = z.object({
  agentId: z.string(),
  onChainId: z.number().optional(),
  address: z.string(),
  publicKey: z.string(),
  agentCardCID: z.string().optional(),
});
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

// Agent card schema (A2A/ERC-8004 compliant)
export const AgentCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  capabilities: z.array(z.string()),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  pricing: z.object({
    model: z.enum(['per-call', 'subscription']),
    amount: z.string(),
    currency: z.string(),
    x402Endpoint: z.string().optional(),
  }).optional(),
  address: z.string(),
  onChainId: z.number().optional(),
  reputationScore: z.number().optional(),
  taskCount: z.number().optional(),
  successRate: z.number().optional(),
  registeredAt: z.number().optional(),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;

// Agent task schema
export const AgentTaskSchema = z.object({
  taskId: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
  requesterAgentId: z.string().optional(),
  paymentProof: z.unknown().optional(),
  deadline: z.number().optional(),
  requirementsCID: z.string().optional(),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

// Task result schema
export const TaskResultSchema = z.object({
  taskId: z.string(),
  success: z.boolean(),
  data: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  resultCID: z.string().optional(),
  decisionProof: z.unknown().optional(),
  completedAt: z.number(),
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

// Agent capability
export type AgentCapability = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

// Decision types
export const DecisionInputSchema = z.object({
  taskId: z.string(),
  inputs: z.record(z.unknown()),
  context: z.record(z.unknown()).optional(),
  timestamp: z.number(),
});
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

export const DecisionOutputSchema = z.object({
  taskId: z.string(),
  outputs: z.record(z.unknown()),
  reasoning: z.array(z.string()),
  timestamp: z.number(),
});
export type DecisionOutput = z.infer<typeof DecisionOutputSchema>;

export const DecisionProofSchema = z.object({
  inputHash: z.string(),
  outputHash: z.string(),
  reasoningHash: z.string(),
  combinedHash: z.string(),
  timestamp: z.number(),
  agentId: z.string(),
  signature: z.string(),
});
export type DecisionProof = z.infer<typeof DecisionProofSchema>;

// Payment types
export const PaymentProofSchema = z.object({
  token: z.string(),
  amount: z.string(),
  recipient: z.string(),
  signature: z.string(),
  nonce: z.string(),
  chainId: z.number(),
  taskId: z.string().optional(),
  timestamp: z.number(),
});
export type PaymentProof = z.infer<typeof PaymentProofSchema>;

// libp2p message types
export const AgentMessageSchema = z.object({
  type: z.enum(['task', 'intent', 'halt', 'negotiation', 'payment', 'heartbeat']),
  from: z.string(),
  payload: z.record(z.unknown()),
  timestamp: z.number(),
  signature: z.string().optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export type MessageHandler = (message: AgentMessage, from: string) => Promise<void>;
export type TaskHandler = (task: AgentTask) => Promise<TaskResult>;

// Intent types (for dashboard)
export const IntentSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  action: z.string(),
  description: z.string(),
  target: z.string().optional(),
  timestamp: z.number(),
  status: z.enum(['pending', 'executing', 'completed', 'failed']),
});
export type Intent = z.infer<typeof IntentSchema>;

// Agent status
export type AgentStatus = 'running' | 'thinking' | 'halted' | 'waiting_payment' | 'offline';

export const AgentStateUpdateSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  status: z.enum(['running', 'thinking', 'halted', 'waiting_payment', 'offline']),
  intent: z.string().optional(),
  reputationScore: z.number().optional(),
  taskCount: z.number().optional(),
  successRate: z.number().optional(),
  timestamp: z.number(),
});
export type AgentStateUpdate = z.infer<typeof AgentStateUpdateSchema>;

// Memory types
export const AgentMemorySchema = z.object({
  agentId: z.string(),
  timestamp: z.number(),
  tasks: z.array(z.object({
    taskId: z.string(),
    type: z.string(),
    completedAt: z.number(),
    success: z.boolean(),
    paymentAmount: z.string().optional(),
    resultCID: z.string().optional(),
  })),
  context: z.record(z.unknown()),
  lastUpdated: z.number(),
  autonomyLevel: z.number().default(2),
  spendingHistory: z.array(z.object({
    timestamp: z.number(),
    amount: z.string(),
    currency: z.string(),
    recipient: z.string(),
    taskId: z.string(),
  })).default([]),
});
export type AgentMemory = z.infer<typeof AgentMemorySchema>;

// Negotiation types
export const BidSchema = z.object({
  taskId: z.string(),
  price: z.string(),
  currency: z.string(),
  deadline: z.number(),
  capabilities: z.array(z.string()),
  reputationProof: z.string().optional(),
  agentId: z.string(),
  round: z.number(),
  timestamp: z.number(),
  signature: z.string().optional(),
});
export type Bid = z.infer<typeof BidSchema>;

export const NegotiationResultSchema = z.object({
  taskId: z.string(),
  winner: AgentCardSchema,
  finalPrice: z.string(),
  currency: z.string(),
  rounds: z.number(),
  bids: z.array(BidSchema),
  score: z.number(),
  completedAt: z.number(),
  bidsCID: z.string().optional(),
});
export type NegotiationResult = z.infer<typeof NegotiationResultSchema>;
