import pino from 'pino';
import { BaseAgent, LibP2PClient, IPFSStorage, DecisionProver } from '@agentmesh/agent-sdk';
import type { AgentTask, TaskResult, AgentCapability } from '@agentmesh/agent-sdk';
import { scoreVendor } from '@agentmesh/shared';

interface VendorScore {
  vendorId: string;
  name: string;
  price: number;
  reputationScore: number;
  successRate: number;
  score: number;
  recommendation: string;
}

export class ComputeAgent extends BaseAgent {
  private computeLogger = pino({ level: 'info', name: 'ComputeAgent' });
  private libp2p: LibP2PClient;
  private ipfs: IPFSStorage;
  private decisionProver: DecisionProver;

  constructor(
    config: ConstructorParameters<typeof BaseAgent>[0],
    private readonly anthropicApiKey: string
  ) {
    super(config);
    this.libp2p = new LibP2PClient(
      config.libp2pPort,
      config.bootstrapPeers,
      this.identity.agentId
    );
    this.ipfs = new IPFSStorage();
    this.decisionProver = new DecisionProver(config.privateKey);
  }

  getCapabilities(): AgentCapability[] {
    return [
      { name: 'analyze_pricing', description: 'Analyze subscription pricing options' },
      { name: 'score_vendors', description: 'Score and rank vendor agents' },
      { name: 'calculate_savings', description: 'Calculate potential savings from switching' },
    ];
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.computeLogger.info({ taskId: task.taskId, type: task.type }, 'ComputeAgent handling task');

    await this.libp2p.broadcastIntent(
      this.identity.agentId,
      'COMPUTING',
      `Analyzing task: ${task.type}`
    );

    try {
      let result: unknown;
      const inputHash = { taskId: task.taskId, type: task.type, payload: task.payload };

      switch (task.type) {
        case 'analyze_pricing':
          result = await this.analyzePricing(task.payload);
          break;
        case 'score_vendors':
          result = await this.scoreVendors(task.payload);
          break;
        case 'calculate_savings':
          result = await this.calculateSavings(task.payload);
          break;
        default:
          return {
            taskId: task.taskId,
            success: false,
            error: `Unknown task type: ${task.type}`,
            completedAt: Date.now(),
          };
      }

      // Create decision proof
      const reasoningArr = [`Computed ${task.type}`, `Result: ${JSON.stringify(result).slice(0, 100)}`];
      const proofResult = await this.decisionProver.proveDecision(
        { taskId: task.taskId, inputs: inputHash, timestamp: Date.now() },
        { taskId: task.taskId, outputs: { result }, reasoning: reasoningArr, timestamp: Date.now() },
        reasoningArr
      );

      return {
        taskId: task.taskId,
        success: true,
        data: { result },
        decisionProof: proofResult.isOk() ? proofResult.value : undefined,
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

  private async analyzePricing(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rawVendors = Array.isArray(payload.vendors) ? payload.vendors : [];
    const vendors = rawVendors.filter(
      (v): v is { name: string; price: number } =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as Record<string, unknown>).name === 'string' &&
        typeof (v as Record<string, unknown>).price === 'number'
    );
    const currentPrice = typeof payload.currentPrice === 'number' ? payload.currentPrice : 0;

    const analysis = vendors.map((v) => ({
      vendor: v.name,
      price: v.price,
      vsCurrentPrice: v.price - currentPrice,
      percentChange: currentPrice > 0 ? ((v.price - currentPrice) / currentPrice) * 100 : 0,
      recommendation: v.price < currentPrice ? 'switch' : 'stay',
    }));

    const bestOption = analysis.reduce(
      (best, curr) => (curr.price < best.price ? curr : best),
      analysis[0] ?? { price: currentPrice, vendor: 'current' }
    );

    return {
      analysis,
      bestOption,
      currentPrice,
      potentialSavings: currentPrice - (bestOption.price ?? currentPrice),
      recommendation:
        bestOption.price < currentPrice
          ? `Switch to ${bestOption.vendor} to save $${(currentPrice - bestOption.price).toFixed(2)}/month`
          : 'Current plan is competitively priced',
    };
  }

  private async scoreVendors(payload: Record<string, unknown>): Promise<VendorScore[]> {
    const vendors = (payload.vendors as Array<{
      id: string;
      name: string;
      price: number;
      reputationScore?: number;
      successRate?: number;
    }>) ?? [];

    const maxPrice = Math.max(...vendors.map((v) => v.price), 1);

    return vendors
      .map((v) => {
        const reputation = (v.reputationScore ?? 50) / 100;
        const priceScore = 1 - v.price / maxPrice;
        const successRate = v.successRate ?? 0.9;
        const score = scoreVendor(reputation, priceScore, successRate);

        return {
          vendorId: v.id,
          name: v.name,
          price: v.price,
          reputationScore: v.reputationScore ?? 50,
          successRate,
          score,
          recommendation: score > 0.7 ? 'highly recommended' : score > 0.5 ? 'recommended' : 'not recommended',
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private async calculateSavings(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const currentPrice = typeof payload.currentPrice === 'number' ? payload.currentPrice : 0;
    const newPrice = typeof payload.newPrice === 'number' ? payload.newPrice : 0;
    const monthlySavings = currentPrice - newPrice;

    return {
      currentPrice,
      newPrice,
      monthlySavings,
      annualSavings: monthlySavings * 12,
      percentSaved: currentPrice > 0 ? (monthlySavings / currentPrice) * 100 : 0,
      breakEvenMonths: 0,
      recommendation:
        monthlySavings > 0
          ? `Switch to save $${(monthlySavings * 12).toFixed(2)}/year`
          : 'Stay with current provider',
    };
  }
}
