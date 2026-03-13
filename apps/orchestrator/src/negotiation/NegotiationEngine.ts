import pino from 'pino';
import {
  MAX_NEGOTIATION_ROUNDS,
  MAX_VENDOR_DISCOUNT_PERCENT,
  scoreVendor,
  isoNow,
} from '@agentmesh/shared';
import { LibP2PClient, IPFSStorage } from '@agentmesh/agent-sdk';
import type { AgentCard, Bid, NegotiationResult } from '@agentmesh/agent-sdk';
import { TOPIC_NEGOTIATION } from '@agentmesh/shared';

export class NegotiationEngine {
  private logger = pino({ level: 'info', name: 'NegotiationEngine' });

  constructor(
    private readonly agentId: string,
    private readonly libp2p: LibP2PClient,
    private readonly ipfs: IPFSStorage
  ) {}

  // Run a multi-round negotiation with a set of vendor agents
  // Protocol: offer → counter-offer → accept/reject (max 3 rounds)
  async negotiate(
    taskId: string,
    vendors: AgentCard[],
    initialBudget: bigint,
    currency: string = 'USDC'
  ): Promise<NegotiationResult | null> {
    this.logger.info(
      { taskId, vendorCount: vendors.length, budget: initialBudget.toString() },
      'Starting negotiation'
    );

    const allBids: Bid[] = [];

    // Run negotiation rounds
    for (let round = 1; round <= MAX_NEGOTIATION_ROUNDS; round++) {
      this.logger.info({ round, taskId }, 'Negotiation round');

      for (const vendor of vendors) {
        const bid = this.simulateVendorBid(vendor, taskId, round, initialBudget, currency);
        allBids.push(bid);

        // Broadcast bid to libp2p
        await this.libp2p.publish(TOPIC_NEGOTIATION, {
          type: 'negotiation',
          from: this.agentId,
          payload: { taskId, round, bid },
          timestamp: Date.now(),
        });
      }
    }

    if (allBids.length === 0) {
      this.logger.warn({ taskId }, 'No bids received');
      return null;
    }

    // Select winner based on scoring formula
    const winner = this.selectWinner(allBids, vendors);
    if (!winner) return null;

    const winnerCard = vendors.find((v) => v.id === winner.agentId);
    if (!winnerCard) return null;

    // Log all bids to IPFS for audit
    const bidsResult = await this.ipfs.store({
      taskId,
      bids: allBids,
      completedAt: isoNow(),
    });
    const bidsCID = bidsResult.isOk() ? bidsResult.value : undefined;

    const result: NegotiationResult = {
      taskId,
      winner: winnerCard,
      finalPrice: winner.price,
      currency,
      rounds: MAX_NEGOTIATION_ROUNDS,
      bids: allBids,
      score: this.calculateScore(winner, allBids, vendors),
      completedAt: Date.now(),
      bidsCID,
    };

    this.logger.info(
      { taskId, winner: winnerCard.name, finalPrice: winner.price },
      'Negotiation complete'
    );

    return result;
  }

  private simulateVendorBid(
    vendor: AgentCard,
    taskId: string,
    round: number,
    initialBudget: bigint,
    currency: string
  ): Bid {
    // Start at list price, discount up to MAX_VENDOR_DISCOUNT_PERCENT after 2 rounds
    const listPrice = Number(initialBudget);
    let price = listPrice;

    if (round === 2) {
      price = listPrice * (1 - (MAX_VENDOR_DISCOUNT_PERCENT / 2) / 100);
    } else if (round >= 3) {
      price = listPrice * (1 - MAX_VENDOR_DISCOUNT_PERCENT / 100);
    }

    // Add small variance per vendor
    const variance = (vendor.reputationScore ?? 50) / 1000;
    price = price * (1 - variance);

    return {
      taskId,
      price: price.toFixed(6),
      currency,
      deadline: Date.now() + 86400000,
      capabilities: vendor.capabilities,
      reputationProof: vendor.id,
      agentId: vendor.id,
      round,
      timestamp: Date.now(),
    };
  }

  private selectWinner(bids: Bid[], vendors: AgentCard[]): Bid | null {
    // Group by agent, take best bid per agent (lowest price in last round)
    const lastRoundBids = bids.filter(
      (b) => b.round === Math.max(...bids.map((bb) => bb.round))
    );

    let bestBid: Bid | null = null;
    let bestScore = -1;

    for (const bid of lastRoundBids) {
      const vendor = vendors.find((v) => v.id === bid.agentId);
      if (!vendor) continue;

      const maxPrice = Math.max(...lastRoundBids.map((b) => Number(b.price)));
      const priceScore = maxPrice > 0 ? 1 - Number(bid.price) / maxPrice : 1;
      const reputationScore = (vendor.reputationScore ?? 50) / 100;
      const successRate = vendor.successRate ?? 0.9;

      const score = scoreVendor(reputationScore, priceScore, successRate);

      if (score > bestScore) {
        bestScore = score;
        bestBid = bid;
      }
    }

    return bestBid;
  }

  private calculateScore(winner: Bid, _allBids: Bid[], vendors: AgentCard[]): number {
    const vendor = vendors.find((v) => v.id === winner.agentId);
    if (!vendor) return 0;

    const priceScore = 0.8; // Simplified for demo
    const reputationScore = (vendor.reputationScore ?? 50) / 100;
    const successRate = vendor.successRate ?? 0.9;

    return scoreVendor(reputationScore, priceScore, successRate);
  }
}
