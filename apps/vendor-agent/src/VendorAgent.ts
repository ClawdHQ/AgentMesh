import pino from 'pino';
import { BaseAgent } from '@agentmesh/agent-sdk';
import type { AgentCapability, AgentTask, TaskResult } from '@agentmesh/agent-sdk';
import type { VendorQuote } from '@agentmesh/shared';
import { ethers } from 'ethers';

import type { AgentConfig } from '@agentmesh/agent-sdk';

export interface VendorProfile {
  key: string;
  vendorName: string;
  description: string;
  capabilities: string[];
  features: string[];
  initialPriceEth: string;
  floorPriceEth: string;
  reputationScore: number;
  successRate: number;
  taskCount: number;
}

export interface VendorAgentConfig extends AgentConfig {
  profile: VendorProfile;
}

export class VendorAgent extends BaseAgent {
  private vendorLogger = pino({ level: 'info', name: 'VendorAgent' });
  private readonly profile: VendorProfile;

  constructor(config: VendorAgentConfig) {
    super(config);
    this.profile = config.profile;
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'quote_vendor',
        description: 'Return a live vendor quote for the current mission',
      },
    ];
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.vendorLogger.info({ taskId: task.taskId, type: task.type }, 'VendorAgent handling task');

    switch (task.type) {
      case 'quote_vendor':
      case 'subscription_pricing':
        return {
          taskId: task.taskId,
          success: true,
          data: {
            result: this.generateQuote({
              objective: String(task.payload.objective ?? 'Mission quote'),
              budgetWei: String(task.payload.budgetWei ?? '0'),
              taskId: task.taskId,
            }),
          },
          completedAt: Date.now(),
        };
      default:
        return {
          taskId: task.taskId,
          success: false,
          error: `VendorAgent does not handle task type: ${task.type}`,
          completedAt: Date.now(),
        };
    }
  }

  generateQuote(input: { objective: string; budgetWei: string; taskId: string }): VendorQuote {
    const budgetWei = BigInt(input.budgetWei || '0');
    const initialPriceWei = BigInt(ethers.parseEther(this.profile.initialPriceEth).toString());
    const floorPriceWei = BigInt(ethers.parseEther(this.profile.floorPriceEth).toString());
    const adjustedInitial = budgetWei > 0n && budgetWei < initialPriceWei ? budgetWei : initialPriceWei;

    return {
      vendorKey: this.profile.key,
      vendorName: this.profile.vendorName,
      vendorUrl: '/quotes',
      agentId: this.getAgentId(),
      currency: 'ETH',
      initialPriceWei: adjustedInitial.toString(),
      floorPriceWei: floorPriceWei.toString(),
      reputationScore: this.profile.reputationScore,
      successRate: this.profile.successRate,
      taskCount: this.profile.taskCount,
      features: this.profile.features,
      quoteValidUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  getProfile(): VendorProfile {
    return this.profile;
  }
}
