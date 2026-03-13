import { ok, err, Result } from 'neverthrow';
import { NetworkError } from '@agentmesh/shared';
import type { AgentCard, AgentTask, TaskResult, TaskHandler } from '../types';

// A2A (Agent-to-Agent) protocol client
// Implements Google's A2A protocol for agent discovery and task delegation
export class A2AClient {
  private readonly agentCards: Map<string, AgentCard> = new Map();
  private taskHandlers: Map<string, TaskHandler> = new Map();

  constructor(
    private readonly baseUrl: string,
    private readonly agentId: string
  ) {}

  // Publish agent card to the A2A discovery endpoint
  async publishCard(card: AgentCard): Promise<Result<void, NetworkError>> {
    try {
      this.agentCards.set(card.id, card);
      // In production, this would POST to a discovery endpoint
      // For demo, we store locally and simulate
      return ok(undefined);
    } catch (error) {
      return err(new NetworkError(`Failed to publish agent card: ${String(error)}`));
    }
  }

  // Discover agents by capability
  async discoverAgents(capability: string): Promise<Result<AgentCard[], NetworkError>> {
    try {
      // In production, query the ERC-8004 registry
      // For demo, return locally known agents with the capability
      const matching = Array.from(this.agentCards.values()).filter((card) =>
        card.capabilities.includes(capability)
      );
      return ok(matching);
    } catch (error) {
      return err(new NetworkError(`Failed to discover agents: ${String(error)}`));
    }
  }

  // Register known agent card
  registerKnownAgent(card: AgentCard): void {
    this.agentCards.set(card.id, card);
  }

  // Send a task to another agent via A2A protocol
  async sendTask(
    agentUrl: string,
    task: AgentTask,
    paymentProof?: unknown
  ): Promise<Result<TaskResult, NetworkError>> {
    try {
      const payload = {
        task,
        paymentProof,
        from: this.agentId,
        timestamp: Date.now(),
      };

      const response = await fetch(`${agentUrl}/a2a/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return err(new NetworkError(`A2A task failed: HTTP ${response.status}`));
      }

      const result = (await response.json()) as TaskResult;
      return ok(result);
    } catch (error) {
      return err(new NetworkError(`Failed to send A2A task: ${String(error)}`));
    }
  }

  // Register a handler for incoming tasks
  receiveTask(taskType: string, handler: TaskHandler): void {
    this.taskHandlers.set(taskType, handler);
  }

  // Get all registered task handlers
  getHandlers(): Map<string, TaskHandler> {
    return this.taskHandlers;
  }

  // Get all known agent cards
  getKnownAgents(): AgentCard[] {
    return Array.from(this.agentCards.values());
  }

  // Handle an incoming task (dispatches to registered handler)
  async handleIncomingTask(task: AgentTask): Promise<Result<TaskResult, NetworkError>> {
    const handler = this.taskHandlers.get(task.type);
    if (!handler) {
      return err(new NetworkError(`No handler registered for task type: ${task.type}`));
    }
    try {
      const result = await handler(task);
      return ok(result);
    } catch (error) {
      return err(new NetworkError(`Task handler error: ${String(error)}`));
    }
  }
}
