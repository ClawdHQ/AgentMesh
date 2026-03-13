import pino from 'pino';
import { sleep, isoNow } from '@agentmesh/shared';
import { LibP2PClient, IPFSStorage, x402Client } from '@agentmesh/agent-sdk';
import type { AgentCard } from '@agentmesh/agent-sdk';
import type { OrchestratorAgent } from '../OrchestratorAgent';
import type { NegotiationEngine } from '../negotiation/NegotiationEngine';

interface SubscriptionData {
  vendor: string;
  plan: string;
  currentPrice: number;
  currency: string;
  billingCycle: string;
  features: string[];
}

interface DemoResult {
  success: boolean;
  scenario: string;
  steps: DemoStep[];
  savings: number;
  auditCID: string | null;
  negotiationResult?: unknown;
  requiresHumanApproval?: boolean;
}

interface DemoStep {
  step: string;
  description: string;
  timestamp: string;
  data?: unknown;
}

export class SubscriptionTask {
  private logger = pino({ level: 'info', name: 'SubscriptionTask' });
  private steps: DemoStep[] = [];

  constructor(
    private readonly orchestrator: OrchestratorAgent,
    private readonly libp2p: LibP2PClient,
    private readonly ipfs: IPFSStorage,
    private readonly x402: x402Client,
    private readonly negotiationEngine: NegotiationEngine,
    private readonly knownAgents: Map<string, unknown>,
    private readonly agentId: string
  ) {}

  async run(): Promise<DemoResult> {
    this.logger.info('Starting Slack Pro subscription optimization demo');
    this.steps = [];

    // Step 1: Fetch current subscription data
    this.orchestrator.broadcastIntent({
      agentId: this.agentId,
      agentName: 'OrchestratorAgent',
      action: 'FETCHING',
      description: 'Checking current Slack Pro subscription price',
      timestamp: Date.now(),
      status: 'executing',
    });

    const currentData = await this.fetchCurrentSubscription();
    this.addStep('fetch_data', `DataAgent fetched current price: $${currentData.currentPrice}/month`, currentData);
    await sleep(500);

    // Step 2: Discover vendor agents
    this.orchestrator.broadcastIntent({
      agentId: this.agentId,
      agentName: 'OrchestratorAgent',
      action: 'DISCOVERING',
      description: 'Discovering vendor agents with subscription_pricing capability',
      timestamp: Date.now(),
      status: 'executing',
    });

    const vendors = this.getMockVendorAgents();
    this.addStep('discover_agents', `Discovered ${vendors.length} vendor agents`, { vendors: vendors.map(v => v.name) });
    await sleep(500);

    // Step 3: Run negotiation
    this.orchestrator.broadcastIntent({
      agentId: this.agentId,
      agentName: 'OrchestratorAgent',
      action: 'NEGOTIATING',
      description: 'Running NegotiationEngine with top 3 vendors',
      timestamp: Date.now(),
      status: 'executing',
    });

    const taskId = `subscription-${Date.now()}`;
    const budgetMicroUSDC = BigInt(Math.round(currentData.currentPrice * 1_000_000));
    const negotiationResult = await this.negotiationEngine.negotiate(
      taskId,
      vendors,
      budgetMicroUSDC,
      'USDC'
    );

    if (!negotiationResult) {
      return {
        success: false,
        scenario: 'Slack Pro subscription optimization',
        steps: this.steps,
        savings: 0,
        auditCID: null,
      };
    }

    const finalPrice = Number(negotiationResult.finalPrice) / 1_000_000;
    const monthlySavings = currentData.currentPrice - finalPrice;
    const annualSavings = monthlySavings * 12;

    this.addStep(
      'negotiation_complete',
      `NegotiationEngine settled at $${finalPrice.toFixed(2)}/month with ${negotiationResult.winner.name}`,
      { finalPrice, winner: negotiationResult.winner.name, rounds: negotiationResult.rounds }
    );
    await sleep(500);

    // Step 4: Check if human approval needed (savings > $10/month)
    let requiresHumanApproval = false;
    if (annualSavings > 10) {
      requiresHumanApproval = true;
      this.orchestrator.broadcastIntent({
        agentId: this.agentId,
        agentName: 'OrchestratorAgent',
        action: 'AWAITING_APPROVAL',
        description: `Human approval needed: Save $${annualSavings.toFixed(2)}/year by switching to ${negotiationResult.winner.name}?`,
        timestamp: Date.now(),
        status: 'pending',
      });
      this.addStep(
        'human_approval_requested',
        `Human approval needed: Save $${annualSavings.toFixed(2)}/year?`,
        { annualSavings, requiresApproval: true }
      );
    }

    // Step 5: Log decision chain to IPFS
    const decisionChain = {
      scenario: 'Slack Pro subscription optimization',
      timestamp: isoNow(),
      agentId: this.agentId,
      inputs: { currentData },
      negotiation: negotiationResult,
      decision: {
        action: 'switch_vendor',
        from: currentData.vendor,
        to: negotiationResult.winner.name,
        oldPrice: currentData.currentPrice,
        newPrice: finalPrice,
        monthlySavings,
        annualSavings,
      },
      steps: this.steps,
    };

    const cidResult = await this.ipfs.store(decisionChain);
    const auditCID = cidResult.isOk() ? cidResult.value : null;

    if (auditCID) {
      this.addStep(
        'audit_logged',
        `Decision chain logged to IPFS: ${auditCID}`,
        { cid: auditCID }
      );
    }

    this.orchestrator.broadcastIntent({
      agentId: this.agentId,
      agentName: 'OrchestratorAgent',
      action: 'COMPLETED',
      description: `Subscription optimization complete. Potential savings: $${annualSavings.toFixed(2)}/year`,
      timestamp: Date.now(),
      status: 'completed',
    });

    return {
      success: true,
      scenario: 'Slack Pro subscription optimization',
      steps: this.steps,
      savings: annualSavings,
      auditCID,
      negotiationResult,
      requiresHumanApproval,
    };
  }

  private async fetchCurrentSubscription(): Promise<SubscriptionData> {
    // Mock data for the demo
    return {
      vendor: 'Slack',
      plan: 'Pro',
      currentPrice: 12.50,
      currency: 'USD',
      billingCycle: 'monthly',
      features: ['unlimited messages', 'screen sharing', 'unlimited apps'],
    };
  }

  private getMockVendorAgents(): AgentCard[] {
    return [
      {
        id: 'vendor-agent-1',
        name: 'DiscordBizAgent',
        description: 'Discord for Business - team communication platform',
        url: 'http://localhost:3004/a2a',
        capabilities: ['subscription_pricing', 'team_communication'],
        address: '0x' + '1'.repeat(40),
        reputationScore: 72,
        taskCount: 45,
        successRate: 0.93,
        pricing: { model: 'per-call', amount: '1000', currency: 'USDC' },
      },
      {
        id: 'vendor-agent-2',
        name: 'TeamsVendorAgent',
        description: 'Microsoft Teams - enterprise communication',
        url: 'http://localhost:3004/a2a',
        capabilities: ['subscription_pricing', 'team_communication', 'enterprise'],
        address: '0x' + '2'.repeat(40),
        reputationScore: 85,
        taskCount: 120,
        successRate: 0.97,
        pricing: { model: 'per-call', amount: '1000', currency: 'USDC' },
      },
      {
        id: 'vendor-agent-3',
        name: 'MattermostAgent',
        description: 'Mattermost - open-source team messaging',
        url: 'http://localhost:3004/a2a',
        capabilities: ['subscription_pricing', 'team_communication', 'open_source'],
        address: '0x' + '3'.repeat(40),
        reputationScore: 68,
        taskCount: 30,
        successRate: 0.90,
        pricing: { model: 'per-call', amount: '1000', currency: 'USDC' },
      },
    ];
  }

  private addStep(step: string, description: string, data?: unknown): void {
    this.steps.push({ step, description, timestamp: isoNow(), data });
    this.logger.info({ step, description }, 'Demo step');
  }
}
