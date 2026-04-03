import type { AgentTask, TaskResult } from '../types';
import type {
  InternalServiceMetadata,
  MissionPlan,
  SettlementRiskFeatures,
  VendorQuote,
} from '@agentmesh/shared';

type JsonRecord = Record<string, unknown>;

export class AgentServiceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly timeoutMs: number = 15000
  ) {}

  get url(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  async health(): Promise<JsonRecord> {
    return this.request<JsonRecord>('GET', '/health');
  }

  async metadata(): Promise<InternalServiceMetadata> {
    return this.request<InternalServiceMetadata>('GET', '/metadata');
  }

  async callTask(task: AgentTask): Promise<TaskResult> {
    return this.request<TaskResult>('POST', '/a2a/tasks', { task });
  }

  async createMissionPlan(input: {
    objective: string;
    budgetWei: string;
    autonomyLevel: number;
  }): Promise<MissionPlan> {
    return this.request<MissionPlan>('POST', '/plan', input);
  }

  async requestQuote(input: {
    objective: string;
    budgetWei: string;
    taskId: string;
  }): Promise<VendorQuote[]> {
    const response = await this.request<VendorQuote | VendorQuote[]>('POST', '/quotes', input);
    return Array.isArray(response) ? response : [response];
  }

  async assessRisk(input: SettlementRiskFeatures): Promise<JsonRecord> {
    return this.request<JsonRecord>('POST', '/risk-assessment', input);
  }

  private async request<T>(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.url}${pathname}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.apiKey ? { 'x-agentmesh-internal-key': this.apiKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`${method} ${pathname} failed with ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
