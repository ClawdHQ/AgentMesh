import pino from 'pino';
import { IPFSStorage } from '@agentmesh/agent-sdk';
import type { AgentMemory } from '@agentmesh/agent-sdk';
import { LRU_CACHE_SIZE } from '@agentmesh/shared';

export class MemoryManager {
  private memory: AgentMemory | null = null;
  private memoryCID: string | null = null;
  private localCache: Map<string, unknown> = new Map();
  private logger = pino({ level: 'info', name: 'MemoryManager' });

  constructor(
    private readonly ipfs: IPFSStorage,
    private readonly agentId: string
  ) {}

  async loadMemory(cid?: string): Promise<void> {
    const targetCID = cid ?? this.memoryCID;

    if (targetCID) {
      const result = await this.ipfs.retrieveMemory(targetCID);
      if (result.isOk()) {
        this.memory = result.value;
        this.logger.info({ cid: targetCID }, 'Memory loaded from IPFS');
        return;
      }
      this.logger.warn({ cid: targetCID }, 'Failed to load memory from IPFS, starting fresh');
    }

    // Initialize fresh memory
    this.memory = {
      agentId: this.agentId,
      timestamp: Date.now(),
      tasks: [],
      context: {
        userPreferences: {},
        knownVendors: {},
        negotiationHistory: [],
      },
      lastUpdated: Date.now(),
      autonomyLevel: 2,
      spendingHistory: [],
    };
  }

  async saveMemory(): Promise<string | null> {
    if (!this.memory) return null;

    this.memory.lastUpdated = Date.now();
    const result = await this.ipfs.storeMemory(this.agentId, this.memory);
    if (result.isOk()) {
      this.memoryCID = result.value;
      this.logger.info({ cid: this.memoryCID }, 'Memory saved to IPFS');
      return this.memoryCID;
    }

    this.logger.error({ error: result.error.message }, 'Failed to save memory to IPFS');
    return null;
  }

  async recordTask(taskId: string, type: string, success: boolean): Promise<void> {
    if (!this.memory) await this.loadMemory();

    this.memory!.tasks.push({
      taskId,
      type,
      completedAt: Date.now(),
      success,
    });

    // Keep only last MAX_MEMORY_ENTRIES tasks
    const MAX = 1000;
    if (this.memory!.tasks.length > MAX) {
      this.memory!.tasks = this.memory!.tasks.slice(-MAX);
    }
  }

  async recordSpending(
    amount: string,
    currency: string,
    recipient: string,
    taskId: string
  ): Promise<void> {
    if (!this.memory) await this.loadMemory();

    this.memory!.spendingHistory.push({
      timestamp: Date.now(),
      amount,
      currency,
      recipient,
      taskId,
    });
  }

  setAutonomyLevel(level: number): void {
    if (!this.memory) return;
    this.memory.autonomyLevel = Math.max(0, Math.min(4, level));
  }

  getAutonomyLevel(): number {
    return this.memory?.autonomyLevel ?? 2;
  }

  getMemory(): AgentMemory | null {
    return this.memory;
  }

  getMemoryCID(): string | null {
    return this.memoryCID;
  }

  setContextValue(key: string, value: unknown): void {
    if (!this.memory) return;
    this.memory.context[key] = value;
  }

  getContextValue(key: string): unknown {
    return this.memory?.context[key];
  }
}
