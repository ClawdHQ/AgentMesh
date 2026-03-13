import { Router } from 'express';
import type { LibP2PClient } from '@agentmesh/agent-sdk';
import type { IntentBroadcaster } from '../websocket/IntentBroadcaster';

export function haltRouter(
  libp2p: LibP2PClient,
  haltState: { halted: boolean; reason: string },
  broadcaster: IntentBroadcaster
) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { reason } = req.body as { reason?: string };
    haltState.halted = true;
    haltState.reason = reason ?? 'User-initiated halt';

    await libp2p.broadcastHalt(haltState.reason, 'api-server');

    broadcaster.broadcast(
      JSON.stringify({ type: 'halt_state', halted: true, reason: haltState.reason })
    );

    return res.json({ success: true, halted: true, reason: haltState.reason });
  });

  router.post('/resume', async (_req, res) => {
    haltState.halted = false;
    haltState.reason = '';

    await libp2p.publish('agentmesh/intents', {
      type: 'intent',
      from: 'api-server',
      payload: { action: 'RESUMED', description: 'System resumed by operator' },
      timestamp: Date.now(),
    });

    broadcaster.broadcast(JSON.stringify({ type: 'halt_state', halted: false, reason: '' }));

    return res.json({ success: true, halted: false });
  });

  router.get('/', (_req, res) => {
    res.json(haltState);
  });

  return router;
}
