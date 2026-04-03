import { riskLabelForScore } from '@agentmesh/shared';
import type { RiskAssessment, SettlementRiskFeatures } from '@agentmesh/shared';

interface ImpulseInferResponse {
  prediction?: number;
  score?: number;
  probability?: number;
  risk_score?: number;
  label?: string;
  explanation?: string;
  model_version?: string;
  [key: string]: unknown;
}

export class ImpulseClient {
  constructor(
    private readonly apiKey?: string,
    private readonly deploymentId?: string,
    private readonly baseUrl: string = 'https://inference.impulselabs.ai'
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.deploymentId);
  }

  async assessSettlementRisk(input: SettlementRiskFeatures): Promise<RiskAssessment> {
    if (!this.isConfigured()) {
      return heuristicRiskAssessment(input);
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/infer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'x-api-key': this.apiKey!,
      },
      body: JSON.stringify({
        deployment_id: this.deploymentId,
        input,
        features: input,
      }),
    });

    if (!response.ok) {
      throw new Error(`Impulse inference failed with ${response.status}`);
    }

    const payload = (await response.json()) as ImpulseInferResponse;
    const rawScore = normalizeScore(
      payload.risk_score ??
        payload.probability ??
        payload.score ??
        payload.prediction ??
        0.5
    );

    return {
      provider: 'impulse',
      score: rawScore,
      label: toRiskLabel(payload.label, rawScore),
      requiresApproval: rawScore >= 0.55,
      rationale:
        typeof payload.explanation === 'string'
          ? payload.explanation
          : `Impulse rated this settlement ${toRiskLabel(payload.label, rawScore)} risk.`,
      evaluatedAt: new Date().toISOString(),
      deploymentId: this.deploymentId,
      modelVersion:
        typeof payload.model_version === 'string' ? payload.model_version : undefined,
      raw: payload,
      input,
    };
  }
}

function heuristicRiskAssessment(input: SettlementRiskFeatures): RiskAssessment {
  const budgetRatio =
    Number(input.candidatePriceWei) > 0 && Number(input.budgetWei) > 0
      ? Number(input.candidatePriceWei) / Number(input.budgetWei)
      : 1;
  const vendorPenalty = input.vendorReputationScore < 70 ? 0.18 : 0.05;
  const successPenalty = Math.max(0, 0.95 - input.vendorSuccessRate) * 0.7;
  const disputePenalty =
    input.historicalTasksCompleted > 0
      ? (input.historicalDisputes / input.historicalTasksCompleted) * 0.8
      : 0;
  const autonomyPenalty = input.autonomyLevel >= 4 ? 0.1 : 0;
  const budgetPenalty = Math.max(0, budgetRatio - 0.85) * 0.4;

  const score = normalizeScore(
    vendorPenalty + successPenalty + disputePenalty + autonomyPenalty + budgetPenalty
  );

  return {
    provider: 'heuristic',
    score,
    label: riskLabelForScore(score),
    requiresApproval: score >= 0.6,
    rationale:
      'Heuristic fallback used because Impulse credentials are not configured; score blends reputation, success rate, dispute history, and budget pressure.',
    evaluatedAt: new Date().toISOString(),
    input,
  };
}

function normalizeScore(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5;
  }
  if (value > 1) {
    return Math.max(0, Math.min(1, value / 100));
  }
  return Math.max(0, Math.min(1, value));
}

function toRiskLabel(label: unknown, score: number) {
  if (label === 'low' || label === 'medium' || label === 'high') {
    return label;
  }
  return riskLabelForScore(score);
}
