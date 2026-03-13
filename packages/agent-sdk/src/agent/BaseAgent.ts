import { ok, err, Result } from 'neverthrow';
import pino from 'pino';
import { AgentMeshError } from '@agentmesh/shared';
import { AgentIdentityManager } from './AgentIdentity';
import type {
  AgentConfig,
  AgentTask,
  TaskResult,
  AgentCapability,
} from '../types';

// Decision type used by logDecision
export type Decision = {
  taskId: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  reasoning: string[];
  timestamp: number;
};

export abstract class BaseAgent {
  protected identity: AgentIdentityManager;
  protected logger: pino.Logger;
  protected isHalted = false;
  protected isRunning = false;

  constructor(protected readonly config: AgentConfig) {
    this.identity = new AgentIdentityManager(config);
    this.logger = pino({
      level: config.logLevel ?? 'info',
      name: config.name,
    });
  }

  abstract handleTask(task: AgentTask): Promise<TaskResult>;
  abstract getCapabilities(): AgentCapability[];

  async register(): Promise<Result<string, AgentMeshError>> {
    try {
      this.logger.info({ name: this.config.name }, 'Registering agent');
      const agentId = this.identity.agentId;
      this.logger.info({ agentId }, 'Agent registered (local)');
      return ok(agentId);
    } catch (error) {
      return err(new AgentMeshError(`Failed to register agent: ${String(error)}`, 'REGISTRATION_ERROR'));
    }
  }

  async advertise(): Promise<Result<void, AgentMeshError>> {
    try {
      this.logger.info({ name: this.config.name }, 'Advertising agent card');
      return ok(undefined);
    } catch (error) {
      return err(new AgentMeshError(`Failed to advertise agent: ${String(error)}`, 'ADVERTISE_ERROR'));
    }
  }

  async listen(): Promise<Result<void, AgentMeshError>> {
    try {
      this.isRunning = true;
      this.logger.info({ name: this.config.name }, 'Agent listening for tasks');
      return ok(undefined);
    } catch (error) {
      return err(new AgentMeshError(`Failed to start listener: ${String(error)}`, 'LISTEN_ERROR'));
    }
  }

  async logDecision(decision: Decision): Promise<Result<string, AgentMeshError>> {
    try {
      const { hashObject } = await import('@agentmesh/shared');
      const decisionHash = hashObject(decision);
      this.logger.info({ decisionHash, taskId: decision.taskId }, 'Decision logged');
      return ok(decisionHash);
    } catch (error) {
      return err(new AgentMeshError(`Failed to log decision: ${String(error)}`, 'LOG_ERROR'));
    }
  }

  async reportResult(taskId: string, result: TaskResult): Promise<Result<void, AgentMeshError>> {
    try {
      this.logger.info({ taskId, success: result.success }, 'Task result reported');
      return ok(undefined);
    } catch (error) {
      return err(new AgentMeshError(`Failed to report result: ${String(error)}`, 'REPORT_ERROR'));
    }
  }

  async halt(): Promise<void> {
    this.isHalted = true;
    this.isRunning = false;
    this.logger.warn({ name: this.config.name }, 'Agent halted');
  }

  async resume(): Promise<void> {
    this.isHalted = false;
    this.isRunning = true;
    this.logger.info({ name: this.config.name }, 'Agent resumed');
  }

  getStatus(): 'running' | 'halted' | 'idle' {
    if (this.isHalted) return 'halted';
    if (this.isRunning) return 'running';
    return 'idle';
  }

  getAgentId(): string {
    return this.identity.agentId;
  }

  getAddress(): string {
    return this.identity.address;
  }

  setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info({ signal }, 'Received shutdown signal');
      await this.halt();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}
