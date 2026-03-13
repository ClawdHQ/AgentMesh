import pino from 'pino';
import { TOPIC_INTENTS } from '@agentmesh/shared';
import { BaseAgent, LibP2PClient, IPFSStorage } from '@agentmesh/agent-sdk';
import type { AgentTask, TaskResult, AgentCapability } from '@agentmesh/agent-sdk';

interface SubscriptionInfo {
  vendor: string;
  plan: string;
  price: number;
  currency: string;
  billingCycle: string;
  features: string[];
  usersIncluded: number;
}

export class DataAgent extends BaseAgent {
  private dataLogger = pino({ level: 'info', name: 'DataAgent' });
  private libp2p: LibP2PClient;
  private ipfs: IPFSStorage;

  constructor(config: ConstructorParameters<typeof BaseAgent>[0]) {
    super(config);
    this.libp2p = new LibP2PClient(
      config.libp2pPort,
      config.bootstrapPeers,
      this.identity.agentId
    );
    this.ipfs = new IPFSStorage();
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'fetch_subscription_data',
        description: 'Fetch current subscription pricing for a given service',
        inputSchema: {
          service: { type: 'string', description: 'Service name' },
        },
      },
      {
        name: 'fetch_api_pricing',
        description: 'Fetch API pricing tiers for a given provider',
        inputSchema: {
          provider: { type: 'string', description: 'API provider name' },
        },
      },
      {
        name: 'fetch_usage_metrics',
        description: 'Fetch current usage metrics for a given service',
        inputSchema: {
          service: { type: 'string', description: 'Service name' },
          metric: { type: 'string', description: 'Metric type' },
        },
      },
    ];
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.dataLogger.info({ taskId: task.taskId, type: task.type }, 'DataAgent handling task');

    await this.libp2p.broadcastIntent(
      this.identity.agentId,
      'FETCHING',
      `Fetching data for task: ${task.type}`,
      task.payload.service as string | undefined
    );

    try {
      let data: unknown;
      switch (task.type) {
        case 'fetch_subscription_data':
          data = await this.fetchSubscriptionData(task.payload.service as string);
          break;
        case 'fetch_api_pricing':
          data = await this.fetchApiPricing(task.payload.provider as string);
          break;
        case 'fetch_usage_metrics':
          data = await this.fetchUsageMetrics(
            task.payload.service as string,
            task.payload.metric as string
          );
          break;
        default:
          return {
            taskId: task.taskId,
            success: false,
            error: `Unknown task type: ${task.type}`,
            completedAt: Date.now(),
          };
      }

      return {
        taskId: task.taskId,
        success: true,
        data: { result: data },
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        taskId: task.taskId,
        success: false,
        error: String(error),
        completedAt: Date.now(),
      };
    }
  }

  private async fetchSubscriptionData(service: string): Promise<SubscriptionInfo> {
    const mockData: Record<string, SubscriptionInfo> = {
      Slack: {
        vendor: 'Slack',
        plan: 'Pro',
        price: 12.5,
        currency: 'USD',
        billingCycle: 'monthly',
        features: ['unlimited messages', 'screen sharing', 'unlimited apps', '90-day history'],
        usersIncluded: 10,
      },
      GitHub: {
        vendor: 'GitHub',
        plan: 'Team',
        price: 21,
        currency: 'USD',
        billingCycle: 'monthly',
        features: ['unlimited repos', '3000 CI minutes', 'code owners', 'protected branches'],
        usersIncluded: 5,
      },
      Notion: {
        vendor: 'Notion',
        plan: 'Plus',
        price: 16,
        currency: 'USD',
        billingCycle: 'monthly',
        features: ['unlimited pages', 'collaboration', 'version history', 'API access'],
        usersIncluded: 10,
      },
    };

    return (
      mockData[service] ?? {
        vendor: service,
        plan: 'Standard',
        price: 10,
        currency: 'USD',
        billingCycle: 'monthly',
        features: ['basic'],
        usersIncluded: 5,
      }
    );
  }

  private async fetchApiPricing(provider: string): Promise<Record<string, unknown>> {
    const mockPricing: Record<string, Record<string, unknown>> = {
      OpenAI: {
        gpt4: { pricePerToken: 0.00003, inputTokens: 0.00001, currency: 'USD' },
        gpt35: { pricePerToken: 0.000002, currency: 'USD' },
      },
      Anthropic: {
        claude3: { pricePerToken: 0.000015, currency: 'USD' },
        claudeHaiku: { pricePerToken: 0.0000025, currency: 'USD' },
      },
    };

    return (
      mockPricing[provider] ?? {
        standard: { pricePerCall: 0.001, currency: 'USD' },
      }
    );
  }

  private async fetchUsageMetrics(
    service: string,
    metric: string
  ): Promise<Record<string, unknown>> {
    return {
      service,
      metric,
      value: Math.floor(Math.random() * 1000),
      unit: metric === 'storage' ? 'GB' : 'calls',
      period: '2024-01',
      timestamp: new Date().toISOString(),
    };
  }
}
