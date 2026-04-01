import { Router } from 'express';
import type { LibP2PClient } from '@agentmesh/agent-sdk';
import { TOPIC_TASKS } from '@agentmesh/shared';

const taskStore: Map<string, unknown> = new Map();

export function tasksRouter(libp2p: LibP2PClient): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const task = req.body as {
      type: string;
      payload: Record<string, unknown>;
      targetAgentId?: string;
    };

    const taskId = `task-${Date.now()}`;
    const fullTask = { taskId, ...task, createdAt: new Date().toISOString() };
    taskStore.set(taskId, fullTask);

    // Broadcast task to libp2p network
    await libp2p.publish(TOPIC_TASKS, {
      type: 'task',
      from: 'api-server',
      payload: fullTask,
      timestamp: Date.now(),
    });

    return res.status(201).json({ taskId, status: 'queued' });
  });

  router.get('/:id', (req, res) => {
    const task = taskStore.get(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.json(task);
  });

  router.get('/', (_req, res) => {
    res.json(Array.from(taskStore.values()));
  });

  return router;
}
