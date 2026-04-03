import pino from 'pino';
import { BaseAgent, ImpulseClient } from '@agentmesh/agent-sdk';
import type { AgentCapability, AgentTask, TaskResult } from '@agentmesh/agent-sdk';
import { scoreVendor } from '@agentmesh/shared';
import type { RiskAssessment, SettlementRiskFeatures, VendorQuote } from '@agentmesh/shared';

interface VendorScorecardEntry {
  vendorKey: string;
  score: number;
  rationale: string;
}

interface VendorScoringResult {
  winnerVendorKey: string;
  reasoning: string;
  recommendedCounterPriceWei: string;
  scorecard: VendorScorecardEntry[];
}

export class ComputeAgent extends BaseAgent {
  private computeLogger = pino({ level: 'info', name: 'ComputeAgent' });
  private impulse: ImpulseClient;

  constructor(
    config: ConstructorParameters<typeof BaseAgent>[0],
    private readonly impulseApiKey?: string,
    private readonly impulseDeploymentId?: string
  ) {
    super(config);
    this.impulse = new ImpulseClient(this.impulseApiKey, this.impulseDeploymentId);
  }

  getCapabilities(): AgentCapability[] {
    return [
      { name: 'analyze_pricing', description: 'Analyze pricing and savings tradeoffs' },
      { name: 'score_vendors', description: 'Score and rank vendor agents using live quotes' },
      { name: 'calculate_savings', description: 'Calculate net savings from a candidate settlement' },
      { name: 'assess_settlement_risk', description: 'Predict settlement failure risk for a mission' },
    ];
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.computeLogger.info({ taskId: task.taskId, type: task.type }, 'ComputeAgent handling task');

    try {
      let result: unknown;
      switch (task.type) {
        case 'analyze_pricing':
          result = this.analyzePricing(task.payload);
          break;
        case 'score_vendors':
          result = this.scoreVendors(task.payload);
          break;
        case 'calculate_savings':
          result = this.calculateSavings(task.payload);
          break;
        case 'assess_settlement_risk':
          result = await this.assessSettlementRisk(task.payload as unknown as SettlementRiskFeatures);
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

  async assessSettlementRisk(input: SettlementRiskFeatures): Promise<RiskAssessment> {
    return this.impulse.assessSettlementRisk(input);
  }

  private analyzePricing(payload: Record<string, unknown>) {
    const currentPriceWei = String(payload.currentPriceWei ?? '0');
    const candidatePriceWei = String(payload.candidatePriceWei ?? '0');
    const currentPrice = Number(currentPriceWei);
    const candidatePrice = Number(candidatePriceWei);

    return {
      currentPriceWei,
      candidatePriceWei,
      candidateBeatsCurrent: candidatePrice < currentPrice || currentPrice === 0,
      absoluteDifferenceWei: Math.max(0, currentPrice - candidatePrice).toString(),
    };
  }

  private scoreVendors(payload: Record<string, unknown>): VendorScoringResult {
    const vendors = Array.isArray(payload.vendors) ? (payload.vendors as VendorQuote[]) : [];
    if (vendors.length === 0) {
      throw new Error('At least one vendor quote is required for scoring');
    }

    const highestInitial = vendors.reduce((max, vendor) => {
      const next = Number(vendor.initialPriceWei);
      return Number.isFinite(next) && next > max ? next : max;
    }, 1);

    const scorecard = vendors
      .map((vendor) => {
        const reputationScore = vendor.reputationScore / 100;
        const priceScore = Math.max(0, 1 - Number(vendor.initialPriceWei) / highestInitial);
        const reliability = vendor.successRate;
        const score = scoreVendor(reputationScore, priceScore, reliability);
        return {
          vendorKey: vendor.vendorKey,
          score,
          rationale: buildVendorRationale(vendor, score),
        };
      })
      .sort((left, right) => right.score - left.score);

    const winner = scorecard[0];
    const winnerQuote = vendors.find((vendor) => vendor.vendorKey === winner.vendorKey);
    if (!winnerQuote) {
      throw new Error(`Winning vendor ${winner.vendorKey} is missing from the quote set`);
    }

    const recommendedCounterPriceWei = recommendCounterPrice(winnerQuote);

    return {
      winnerVendorKey: winner.vendorKey,
      reasoning: `Selected ${winnerQuote.vendorName} because it offers the best balance of price discipline, onchain reliability, and historical execution quality.`,
      recommendedCounterPriceWei,
      scorecard,
    };
  }

  private calculateSavings(payload: Record<string, unknown>) {
    const baselinePriceWei = BigInt(String(payload.baselinePriceWei ?? '0'));
    const finalPriceWei = BigInt(String(payload.finalPriceWei ?? '0'));
    const savingsWei = baselinePriceWei > finalPriceWei ? baselinePriceWei - finalPriceWei : 0n;

    return {
      baselinePriceWei: baselinePriceWei.toString(),
      finalPriceWei: finalPriceWei.toString(),
      savingsWei: savingsWei.toString(),
    };
  }
}

function recommendCounterPrice(vendor: VendorQuote) {
  const initial = BigInt(vendor.initialPriceWei);
  const floor = BigInt(vendor.floorPriceWei);
  const discountBps = vendor.reputationScore >= 90 ? 850n : vendor.reputationScore >= 80 ? 900n : 935n;
  const discounted = (initial * discountBps) / 1000n;
  return (discounted < floor ? floor : discounted).toString();
}

function buildVendorRationale(vendor: VendorQuote, score: number) {
  const priceEth = Number(vendor.initialPriceWei) / 1e18;
  return `${vendor.vendorName} scored ${score.toFixed(2)} with ${vendor.reputationScore} reputation, ${(vendor.successRate * 100).toFixed(1)}% success, and a ${priceEth.toFixed(4)} ETH initial quote.`;
}
