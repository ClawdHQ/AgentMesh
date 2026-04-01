import pino from 'pino';
import { BaseAgent, LibP2PClient, IPFSStorage, x402Client } from '@agentmesh/agent-sdk';
import type { AgentTask, TaskResult, AgentCapability, Bid } from '@agentmesh/agent-sdk';
import { TOPIC_NEGOTIATION, TOPIC_INTENTS, MAX_VENDOR_DISCOUNT_PERCENT, isoNow } from '@agentmesh/shared';

import type { AgentConfig } from '@agentmesh/agent-sdk';

export interface VendorAgentConfig extends AgentConfig {
  listPrice: number;
  vendorName: string;
  usdcAddress: string;
}

export class VendorAgent extends BaseAgent {
  private vendorLogger = pino({ level: 'info', name: 'VendorAgent' });
  private libp2p: LibP2PClient;
  private ipfs: IPFSStorage;
  private readonly listPrice: number;
  private readonly vendorName: string;
  private activeNegotiations: Map<string, { round: number; lastOffer: number }> = new Map();

  constructor(config: VendorAgentConfig) {
    super(config);
    this.listPrice = config.listPrice;
    this.vendorName = config.vendorName;
    this.libp2p = new LibP2PClient(
      config.libp2pPort,
      config.bootstrapPeers,
      this.identity.agentId
    );
    this.ipfs = new IPFSStorage();
  }

  async start(): Promise<void> {
    await this.libp2p.start();

    // Listen for negotiation requests
    this.libp2p.subscribe(TOPIC_NEGOTIATION, async (message) => {
      const { taskId, round, bid } = message.payload as {
        taskId: string;
        round: number;
        bid?: Bid;
      };

      this.vendorLogger.info({ taskId, round }, 'Received negotiation message');
      const responseBid = this.generateBid(taskId, round, Number(bid?.price ?? this.listPrice));

      await this.libp2p.publish(TOPIC_NEGOTIATION, {
        type: 'negotiation',
        from: this.identity.agentId,
        payload: { taskId, round, bid: responseBid, vendorName: this.vendorName },
        timestamp: Date.now(),
      });
    });

    this.isRunning = true;
    this.vendorLogger.info(
      { agentId: this.identity.agentId, listPrice: this.listPrice },
      'VendorAgent started'
    );
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'subscription_pricing',
        description: 'Provide competitive subscription pricing for team communication',
        inputSchema: { teamSize: { type: 'number' }, duration: { type: 'string' } },
        outputSchema: { price: { type: 'number' }, currency: { type: 'string' } },
      },
    ];
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.vendorLogger.info({ taskId: task.taskId, type: task.type }, 'VendorAgent handling task');

    await this.libp2p.broadcastIntent(
      this.identity.agentId,
      'RESPONDING',
      `Responding to task: ${task.type}`
    );

    switch (task.type) {
      case 'subscription_pricing': {
        const teamSize = (task.payload.teamSize as number) ?? 10;
        const pricePerUser = this.listPrice / 10;
        const totalPrice = pricePerUser * teamSize;

        return {
          taskId: task.taskId,
          success: true,
          data: {
            vendor: this.vendorName,
            planName: 'Business Pro',
            listPrice: this.listPrice,
            pricePerUser,
            totalPrice,
            currency: 'USD',
            billingCycle: 'monthly',
            features: [
              'unlimited messaging',
              'HD video calls',
              'file sharing (20GB)',
              'integrations with 50+ apps',
              'priority support',
            ],
            discountAvailable: true,
            maxDiscount: MAX_VENDOR_DISCOUNT_PERCENT,
            offerValidUntil: new Date(Date.now() + 86400000).toISOString(),
          },
          completedAt: Date.now(),
        };
      }

      case 'accept_offer': {
        const offeredPrice = task.payload.price as number;
        const taskId = task.taskId;

        // Accept if within discount range
        const minAcceptablePrice = this.listPrice * (1 - MAX_VENDOR_DISCOUNT_PERCENT / 100);
        const accepted = offeredPrice >= minAcceptablePrice;

        if (accepted) {
          await this.libp2p.broadcastIntent(
            this.identity.agentId,
            'ACCEPTED',
            `Accepted offer of $${offeredPrice}/month for task ${taskId}`
          );
        }

        return {
          taskId: task.taskId,
          success: accepted,
          data: {
            accepted,
            finalPrice: accepted ? offeredPrice : this.listPrice,
            currency: 'USD',
            vendor: this.vendorName,
            message: accepted
              ? `Offer accepted at $${offeredPrice}/month`
              : `Minimum price is $${minAcceptablePrice.toFixed(2)}/month`,
          },
          completedAt: Date.now(),
        };
      }

      default:
        return {
          taskId: task.taskId,
          success: false,
          error: `VendorAgent does not handle task type: ${task.type}`,
          completedAt: Date.now(),
        };
    }
  }

  // Generate a bid for a negotiation round
  generateBid(taskId: string, round: number, buyerBudget: number): Bid {
    const negotiation = this.activeNegotiations.get(taskId) ?? { round: 0, lastOffer: this.listPrice };
    const maxDiscount = MAX_VENDOR_DISCOUNT_PERCENT / 100;

    // Progressive discounting strategy
    let discountRate: number;
    if (round === 1) {
      discountRate = 0.05; // 5% discount in round 1
    } else if (round === 2) {
      discountRate = 0.10; // 10% discount in round 2
    } else {
      discountRate = maxDiscount; // Max discount in round 3+
    }

    const price = this.listPrice * (1 - discountRate);

    this.activeNegotiations.set(taskId, { round, lastOffer: price });

    this.vendorLogger.info(
      { taskId, round, price: price.toFixed(2), buyerBudget },
      'Generated bid'
    );

    return {
      taskId,
      price: (price * 1_000_000).toFixed(0), // Convert to USDC micro units
      currency: 'USDC',
      deadline: Date.now() + 3600000,
      capabilities: ['subscription_pricing'],
      agentId: this.identity.agentId,
      round,
      timestamp: Date.now(),
    };
  }
}
