import pino from 'pino';
import { BaseAgent } from '@agentmesh/agent-sdk';
import type { AgentCapability, AgentTask, TaskResult } from '@agentmesh/agent-sdk';
import { ethers } from 'ethers';

export class DataAgent extends BaseAgent {
  private dataLogger = pino({ level: 'info', name: 'DataAgent' });
  private provider: ethers.JsonRpcProvider;

  constructor(config: ConstructorParameters<typeof BaseAgent>[0]) {
    super(config);
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'fetch_market_context',
        description: 'Fetch live execution context such as gas, chain height, and budget pressure',
      },
      {
        name: 'fetch_api_pricing',
        description: 'Fetch API pricing from a provided endpoint',
      },
      {
        name: 'fetch_usage_metrics',
        description: 'Return wallet and network metrics relevant to a mission',
      },
    ];
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.dataLogger.info({ taskId: task.taskId, type: task.type }, 'DataAgent handling task');

    try {
      let result: unknown;
      switch (task.type) {
        case 'fetch_market_context':
          result = await this.fetchMarketContext(task.payload);
          break;
        case 'fetch_api_pricing':
          result = await this.fetchApiPricing(task.payload);
          break;
        case 'fetch_usage_metrics':
          result = await this.fetchUsageMetrics(task.payload);
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
        data: { result },
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

  private async fetchMarketContext(payload: Record<string, unknown>) {
    const [blockNumber, feeData] = await Promise.all([
      this.provider.getBlockNumber(),
      this.provider.getFeeData(),
    ]);

    return {
      objective: payload.objective,
      blockNumber,
      gasPriceWei: feeData.gasPrice?.toString() ?? '0',
      maxFeePerGasWei: feeData.maxFeePerGas?.toString() ?? '0',
      budgetWei: String(payload.budgetWei ?? '0'),
      autonomyLevel: Number(payload.autonomyLevel ?? 2),
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchApiPricing(payload: Record<string, unknown>) {
    const url = typeof payload.url === 'string' ? payload.url : undefined;
    if (!url) {
      throw new Error('fetch_api_pricing requires a url');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Pricing endpoint failed with ${response.status}`);
    }

    return {
      url,
      fetchedAt: new Date().toISOString(),
      payload: await response.json(),
    };
  }

  private async fetchUsageMetrics(payload: Record<string, unknown>) {
    const address = typeof payload.address === 'string' ? payload.address : this.identity.address;
    const balanceWei = await this.provider.getBalance(address);

    return {
      address,
      balanceWei: balanceWei.toString(),
      balanceEth: ethers.formatEther(balanceWei),
      sampledAt: new Date().toISOString(),
    };
  }
}
