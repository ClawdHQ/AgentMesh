import { isoNow } from '@agentmesh/shared';
import type { AgentCard, AgentCapability, AgentConfig } from '../types';

export class AgentCardBuilder {
  private card: Partial<AgentCard> = {};

  constructor(private readonly config: AgentConfig, private readonly address: string) {
    this.card = {
      id: `agent-${address.slice(2, 18)}`,
      name: config.name,
      description: config.description,
      url: '',
      capabilities: config.capabilities,
      address,
    };
  }

  withUrl(url: string): this {
    this.card.url = url;
    return this;
  }

  withCapabilities(capabilities: AgentCapability[]): this {
    this.card.capabilities = capabilities.map((c) => c.name);
    this.card.inputSchema = Object.fromEntries(
      capabilities.map((c) => [c.name, c.inputSchema ?? {}])
    );
    this.card.outputSchema = Object.fromEntries(
      capabilities.map((c) => [c.name, c.outputSchema ?? {}])
    );
    return this;
  }

  withPricing(pricing: AgentCard['pricing']): this {
    this.card.pricing = pricing;
    return this;
  }

  withOnChainId(id: number): this {
    this.card.onChainId = id;
    return this;
  }

  withReputation(score: number, taskCount: number, successRate: number): this {
    this.card.reputationScore = score;
    this.card.taskCount = taskCount;
    this.card.successRate = successRate;
    return this;
  }

  build(): AgentCard {
    if (!this.card.url) {
      throw new Error('AgentCard: url is required');
    }
    return {
      id: this.card.id ?? `agent-${this.address.slice(2, 18)}`,
      name: this.card.name ?? this.config.name,
      description: this.card.description ?? this.config.description,
      url: this.card.url,
      capabilities: this.card.capabilities ?? this.config.capabilities,
      inputSchema: this.card.inputSchema,
      outputSchema: this.card.outputSchema,
      pricing: this.card.pricing,
      address: this.address,
      onChainId: this.card.onChainId,
      reputationScore: this.card.reputationScore ?? 50,
      taskCount: this.card.taskCount ?? 0,
      successRate: this.card.successRate ?? 1.0,
      registeredAt: Math.floor(Date.now() / 1000),
    };
  }

  toJsonLD(): Record<string, unknown> {
    const card = this.build();
    return {
      '@context': {
        '@vocab': 'https://agentmesh.ai/vocab#',
        'schema': 'https://schema.org/',
        'erc8004': 'https://eips.ethereum.org/EIPS/eip-8004#',
      },
      '@type': 'erc8004:AgentCard',
      '@id': `did:agentmesh:${this.address}`,
      'schema:name': card.name,
      'schema:description': card.description,
      'erc8004:capabilities': card.capabilities,
      'erc8004:url': card.url,
      'erc8004:address': card.address,
      'erc8004:onChainId': card.onChainId,
      'erc8004:reputationScore': card.reputationScore,
      'erc8004:pricing': card.pricing,
      'erc8004:registeredAt': isoNow(),
    };
  }
}
