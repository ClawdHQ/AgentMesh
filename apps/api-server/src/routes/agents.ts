import { Router } from 'express';

export function agentsRouter(
  agentStates: Map<
    string,
    { agentId: string; agentName: string; status: string; intent?: string; timestamp: number }
  >
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(Array.from(agentStates.values()));
  });

  router.get('/:id', (req, res) => {
    const agent = agentStates.get(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    return res.json(agent);
  });

  return router;
}
