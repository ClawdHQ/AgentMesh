import pino from 'pino';
import { LibP2PClient } from '@agentmesh/agent-sdk';
import { TOPIC_TASKS } from '@agentmesh/shared';
import type { AgentTask, AgentCard } from '@agentmesh/agent-sdk';

export class TaskPlanner {
  private logger = pino({ level: 'info', name: 'TaskPlanner' });

  constructor(
    private readonly agentId: string,
    private readonly libp2p: LibP2PClient
  ) {}

  // Decompose a high-level goal into sub-tasks
  decompose(goal: string, context: Record<string, unknown>): AgentTask[] {
    const tasks: AgentTask[] = [];
    const taskId = `task-${Date.now()}`;

    if (goal === 'optimize_subscription') {
      tasks.push(
        {
          taskId: `${taskId}-data`,
          type: 'fetch_subscription_data',
          payload: { ...context, source: 'current_vendor' },
        },
        {
          taskId: `${taskId}-discover`,
          type: 'discover_agents',
          payload: { capability: 'subscription_pricing' },
        },
        {
          taskId: `${taskId}-analyze`,
          type: 'analyze_pricing',
          payload: context,
        },
        {
          taskId: `${taskId}-negotiate`,
          type: 'negotiate',
          payload: context,
        },
        {
          taskId: `${taskId}-execute`,
          type: 'execute_payment',
          payload: context,
        }
      );
    }

    return tasks;
  }

  // Delegate a task to a specific agent via libp2p
  async delegate(task: AgentTask, targetAgent: AgentCard): Promise<void> {
    this.logger.info(
      { taskId: task.taskId, target: targetAgent.name },
      'Delegating task'
    );

    await this.libp2p.publish(TOPIC_TASKS, {
      type: 'task',
      from: this.agentId,
      payload: { task, targetAgentId: targetAgent.id },
      timestamp: Date.now(),
    });
  }

  // Prioritize tasks by dependency and importance
  prioritize(tasks: AgentTask[]): AgentTask[] {
    const order = [
      'fetch_subscription_data',
      'discover_agents',
      'analyze_pricing',
      'negotiate',
      'execute_payment',
    ];

    return [...tasks].sort((a, b) => {
      const aIdx = order.indexOf(a.type);
      const bIdx = order.indexOf(b.type);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  }
}
