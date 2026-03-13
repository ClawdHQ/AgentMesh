import type { MCPClient } from '@agentmesh/agent-sdk';
import type { LibP2PClient, IPFSStorage, x402Client } from '@agentmesh/agent-sdk';
import type { NegotiationEngine } from '../negotiation/NegotiationEngine';
import { TOPIC_INTENTS } from '@agentmesh/shared';
import type { MCPTool } from '@agentmesh/agent-sdk';

export class MCPToolRegistry {
  constructor(
    private readonly mcp: MCPClient,
    private readonly libp2p: LibP2PClient,
    private readonly ipfs: IPFSStorage,
    private readonly x402: x402Client,
    private readonly negotiationEngine: NegotiationEngine,
    private readonly knownAgents: Map<string, unknown>,
    private readonly agentId: string
  ) {}

  registerAll(): void {
    this.registerDiscoverAgents();
    this.registerGetAgentReputation();
    this.registerDelegateTask();
    this.registerInitiatePayment();
    this.registerGetSubscriptionData();
    this.registerNegotiatePrice();
    this.registerLogDecision();
    this.registerRequestHumanApproval();
  }

  private registerDiscoverAgents(): void {
    const tool: MCPTool = {
      name: 'discover_agents',
      description: 'Discover registered agents with a specific capability from the ERC-8004 registry',
      inputSchema: {
        type: 'object',
        properties: {
          capability: { type: 'string', description: 'The capability to search for' },
        },
        required: ['capability'],
      },
      execute: async (params) => {
        const capability = params.capability as string;
        const agents = Array.from(this.knownAgents.values()).filter(
          (a): a is { capabilities: string[] } =>
            typeof a === 'object' &&
            a !== null &&
            'capabilities' in a &&
            Array.isArray((a as { capabilities: string[] }).capabilities) &&
            (a as { capabilities: string[] }).capabilities.includes(capability)
        );
        return { agents, count: agents.length };
      },
    };
    this.mcp.registerTool(tool);
  }

  private registerGetAgentReputation(): void {
    const tool: MCPTool = {
      name: 'get_agent_reputation',
      description: 'Get the on-chain reputation score for an agent',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'The agent ID to look up' },
        },
        required: ['agentId'],
      },
      execute: async (params) => {
        const agent = this.knownAgents.get(params.agentId as string);
        if (!agent) return { error: 'Agent not found' };
        return agent;
      },
    };
    this.mcp.registerTool(tool);
  }

  private registerDelegateTask(): void {
    const tool: MCPTool = {
      name: 'delegate_task',
      description: 'Delegate a task to a specialist agent',
      inputSchema: {
        type: 'object',
        properties: {
          taskType: { type: 'string', description: 'Type of task to delegate' },
          targetAgentId: { type: 'string', description: 'Agent to delegate to' },
          payload: { type: 'string', description: 'Task payload as JSON string' },
        },
        required: ['taskType', 'targetAgentId'],
      },
      execute: async (params) => {
        await this.libp2p.publish(TOPIC_INTENTS, {
          type: 'intent',
          from: this.agentId,
          payload: {
            action: 'DELEGATING',
            taskType: params.taskType,
            targetAgentId: params.targetAgentId,
          },
          timestamp: Date.now(),
        });
        return { success: true, delegated: true };
      },
    };
    this.mcp.registerTool(tool);
  }

  private registerInitiatePayment(): void {
    const tool: MCPTool = {
      name: 'initiate_payment',
      description: 'Initiate an x402 USDC payment to an agent',
      inputSchema: {
        type: 'object',
        properties: {
          recipientAddress: { type: 'string', description: 'Recipient Ethereum address' },
          amountUSDC: { type: 'string', description: 'Amount in USDC (e.g., "0.01")' },
          taskId: { type: 'string', description: 'Associated task ID' },
        },
        required: ['recipientAddress', 'amountUSDC', 'taskId'],
      },
      execute: async (params) => {
        const amountStr = params.amountUSDC as string;
        const amount = BigInt(Math.round(Number(amountStr) * 1_000_000));
        const proofResult = await this.x402.createPaymentProof(
          amount,
          'USDC',
          params.recipientAddress as string
        );
        if (proofResult.isErr()) return { error: proofResult.error.message };
        return { success: true, proof: proofResult.value };
      },
    };
    this.mcp.registerTool(tool);
  }

  private registerGetSubscriptionData(): void {
    const tool: MCPTool = {
      name: 'get_subscription_data',
      description: 'Fetch current subscription pricing data from DataAgent',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Service name (e.g., "Slack", "GitHub")' },
        },
        required: ['service'],
      },
      execute: async (params) => {
        const mockPrices: Record<string, { price: number; plan: string; features: string[] }> = {
          Slack: { price: 12.5, plan: 'Pro', features: ['unlimited messages', 'screen sharing'] },
          GitHub: { price: 21, plan: 'Team', features: ['unlimited repos', 'CI/CD minutes'] },
          Notion: { price: 16, plan: 'Plus', features: ['unlimited pages', 'collaboration'] },
        };
        const service = params.service as string;
        return mockPrices[service] ?? { price: 10, plan: 'Standard', features: ['basic'] };
      },
    };
    this.mcp.registerTool(tool);
  }

  private registerNegotiatePrice(): void {
    const tool: MCPTool = {
      name: 'negotiate_price',
      description: 'Run the negotiation engine to find the best vendor price',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Task ID for this negotiation' },
          budget: { type: 'string', description: 'Budget in USDC (6 decimal units)' },
        },
        required: ['taskId', 'budget'],
      },
      execute: async (params) => {
        const vendors = Array.from(this.knownAgents.values()).filter(
          (a): a is { capabilities: string[]; id: string; name: string; description: string; url: string; address: string } =>
            typeof a === 'object' &&
            a !== null &&
            'capabilities' in a &&
            Array.isArray((a as { capabilities: string[] }).capabilities) &&
            (a as { capabilities: string[] }).capabilities.includes('subscription_pricing')
        );
        const result = await this.negotiationEngine.negotiate(
          params.taskId as string,
          vendors as Parameters<typeof this.negotiationEngine.negotiate>[1],
          BigInt(params.budget as string)
        );
        return result ?? { error: 'Negotiation failed' };
      },
    };
    this.mcp.registerTool(tool);
  }

  private registerLogDecision(): void {
    const tool: MCPTool = {
      name: 'log_decision',
      description: 'Log a decision to IPFS for audit trail',
      inputSchema: {
        type: 'object',
        properties: {
          decision: { type: 'string', description: 'Decision data as JSON string' },
        },
        required: ['decision'],
      },
      execute: async (params) => {
        const data = JSON.parse(params.decision as string) as unknown;
        const result = await this.ipfs.store(data);
        if (result.isErr()) return { error: result.error.message };
        return { success: true, cid: result.value };
      },
    };
    this.mcp.registerTool(tool);
  }

  private registerRequestHumanApproval(): void {
    const tool: MCPTool = {
      name: 'request_human_approval',
      description: 'Request human approval for a high-value decision',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action requiring approval' },
          amount: { type: 'string', description: 'Amount in USD' },
          description: { type: 'string', description: 'Human-readable description' },
        },
        required: ['action', 'description'],
      },
      execute: async (params) => {
        await this.libp2p.publish(TOPIC_INTENTS, {
          type: 'intent',
          from: this.agentId,
          payload: {
            action: 'AWAITING_APPROVAL',
            description: params.description,
            amount: params.amount,
            requiresHumanApproval: true,
          },
          timestamp: Date.now(),
        });
        // In production, this would wait for human input via WebSocket
        return { pending: true, message: 'Awaiting human approval' };
      },
    };
    this.mcp.registerTool(tool);
  }
}
