import type { VendorBid } from './types';

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export interface VendorScoringResult {
  winnerAgentKey: string;
  reasoning: string;
  scorecard: Array<{
    agentKey: string;
    score: number;
    rationale: string;
  }>;
  recommendedCounterPriceWei: string;
}

export class OpenRouterClient {
  constructor(
    private readonly apiKey?: string,
    private readonly model: string = 'openai/gpt-4.1-mini'
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async scoreVendors(input: {
    objective: string;
    budgetWei: string;
    bids: VendorBid[];
  }): Promise<VendorScoringResult> {
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is required for AI inference');
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'You are the ComputeAgent inside a structured autonomous system. Rank vendors using price, reputation, and execution risk. Respond with JSON only matching the requested schema.',
          },
          {
            role: 'user',
            content: JSON.stringify(
              {
                objective: input.objective,
                budgetWei: input.budgetWei,
                bids: input.bids.map((bid) => ({
                  agentKey: bid.agentKey,
                  agentName: bid.agentName,
                  initialPriceWei: bid.initialPriceWei,
                  counterPriceWei: bid.counterPriceWei,
                  floorPriceWei: bid.floorPriceWei,
                  reputationScore: bid.reputationScore,
                })),
                requiredSchema: {
                  winnerAgentKey: 'string',
                  reasoning: 'string',
                  recommendedCounterPriceWei: 'string',
                  scorecard: [
                    {
                      agentKey: 'string',
                      score: 'number between 0 and 1',
                      rationale: 'string',
                    },
                  ],
                },
              },
              null,
              2
            ),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter request failed with ${response.status}`);
    }

    const payload = (await response.json()) as OpenRouterResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter returned no completion content');
    }

    const parsed = JSON.parse(extractJson(content)) as VendorScoringResult;

    if (!parsed.winnerAgentKey || !Array.isArray(parsed.scorecard) || !parsed.recommendedCounterPriceWei) {
      throw new Error('OpenRouter returned invalid vendor scoring payload');
    }

    return parsed;
  }
}

function extractJson(content: string): string {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Completion did not contain a JSON object');
  }

  return content.slice(start, end + 1);
}
