import { Router } from 'express';

export function agentsRouter(
  agentStates: Map<
    string,
    { agentId: string; agentName: string; status: string; intent?: string; timestamp: number }
  >
): Router {
  const router = Router();

  // Seed some mock agents for demo
  const mockAgents = [
    {
      agentId: 'orchestrator-1',
      agentName: 'OrchestratorAgent',
      status: 'running',
      intent: 'Monitoring subscriptions',
      reputationScore: 85,
      taskCount: 12,
      successRate: 0.92,
      capabilities: ['orchestrate', 'negotiate', 'delegate'],
      address: '0x' + '1'.repeat(40),
      timestamp: Date.now(),
    },
    {
      agentId: 'data-agent-1',
      agentName: 'DataAgent',
      status: 'idle',
      intent: 'Waiting for tasks',
      reputationScore: 72,
      taskCount: 45,
      successRate: 0.96,
      capabilities: ['fetch_subscription_data', 'fetch_api_pricing'],
      address: '0x' + '2'.repeat(40),
      timestamp: Date.now(),
    },
    {
      agentId: 'compute-agent-1',
      agentName: 'ComputeAgent',
      status: 'idle',
      intent: 'Ready for analysis',
      reputationScore: 78,
      taskCount: 38,
      successRate: 0.94,
      capabilities: ['analyze_pricing', 'score_vendors', 'calculate_savings'],
      address: '0x' + '3'.repeat(40),
      timestamp: Date.now(),
    },
    {
      agentId: 'executor-agent-1',
      agentName: 'ExecutorAgent',
      status: 'idle',
      intent: 'Standing by',
      reputationScore: 90,
      taskCount: 22,
      successRate: 0.99,
      capabilities: ['sign_transaction', 'submit_payment', 'update_registry'],
      address: '0x' + '4'.repeat(40),
      timestamp: Date.now(),
    },
    {
      agentId: 'vendor-agent-1',
      agentName: 'VendorAgent',
      status: 'running',
      intent: 'Awaiting negotiation requests',
      reputationScore: 65,
      taskCount: 18,
      successRate: 0.88,
      capabilities: ['subscription_pricing'],
      address: '0x' + '5'.repeat(40),
      timestamp: Date.now(),
    },
  ];

  router.get('/', (_req, res) => {
    const liveStates = Array.from(agentStates.values());
    const merged = mockAgents.map((mock) => {
      const live = liveStates.find((s) => s.agentId === mock.agentId);
      return live ? { ...mock, ...live } : mock;
    });
    res.json(merged);
  });

  router.get('/:id', (req, res) => {
    const agent = mockAgents.find((a) => a.agentId === req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const live = agentStates.get(req.params.id);
    return res.json(live ? { ...agent, ...live } : agent);
  });

  return router;
}
