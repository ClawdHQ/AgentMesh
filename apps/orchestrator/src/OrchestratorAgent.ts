import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import pino from 'pino';
import { AgentMeshError, TOPIC_HALT, TOPIC_INTENTS, isoNow } from '@agentmesh/shared';
import {
  BaseAgent,
  LibP2PClient,
  IPFSStorage,
  x402Client,
  MCPClient,
} from '@agentmesh/agent-sdk';
import type { AgentTask, TaskResult, AgentCapability, AgentMessage, Intent } from '@agentmesh/agent-sdk';
import { MemoryManager } from './memory/MemoryManager';
import { MCPToolRegistry } from './mcp/MCPToolRegistry';
import { TaskPlanner } from './tasks/TaskPlanner';
import { NegotiationEngine } from './negotiation/NegotiationEngine';

export interface OrchestratorConfig {
  name: string;
  description: string;
  capabilities: string[];
  privateKey: string;
  rpcUrl: string;
  agentRegistryAddress?: string;
  taskEscrowAddress?: string;
  auditLoggerAddress?: string;
  libp2pPort: number;
  bootstrapPeers: string[];
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  anthropicApiKey: string;
  usdcAddress: string;
  port: number;
}

export class OrchestratorAgent extends BaseAgent {
  private anthropic: Anthropic;
  private libp2p: LibP2PClient;
  private ipfs: IPFSStorage;
  private x402: x402Client;
  private mcp: MCPClient;
  private memoryManager: MemoryManager;
  private taskPlanner: TaskPlanner;
  private negotiationEngine: NegotiationEngine;
  private orchestratorLogger: pino.Logger;
  private app: express.Application;
  private wss: WebSocketServer;
  private wsClients: Set<WebSocket> = new Set();
  private knownAgents: Map<string, unknown> = new Map();
  private orchestratorConfig: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    super({
      name: config.name,
      description: config.description,
      capabilities: config.capabilities,
      privateKey: config.privateKey,
      rpcUrl: config.rpcUrl,
      agentRegistryAddress: config.agentRegistryAddress,
      taskEscrowAddress: config.taskEscrowAddress,
      auditLoggerAddress: config.auditLoggerAddress,
      libp2pPort: config.libp2pPort,
      bootstrapPeers: config.bootstrapPeers,
      logLevel: config.logLevel,
    });

    this.orchestratorConfig = config;
    this.orchestratorLogger = pino({ level: config.logLevel, name: 'OrchestratorAgent' });

    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.libp2p = new LibP2PClient(config.libp2pPort, config.bootstrapPeers, this.identity.agentId);
    this.ipfs = new IPFSStorage();
    this.x402 = new x402Client(config.privateKey, 11155111, config.usdcAddress);
    this.mcp = new MCPClient();
    this.memoryManager = new MemoryManager(this.ipfs, this.identity.agentId);
    this.taskPlanner = new TaskPlanner(this.identity.agentId, this.libp2p);
    this.negotiationEngine = new NegotiationEngine(
      this.identity.agentId,
      this.libp2p,
      this.ipfs
    );

    this.app = express();
    this.app.use(express.json());
    this.wss = new WebSocketServer({ noServer: true });

    this.setupRoutes();
    this.setupWebSocket();
  }

  async start(): Promise<void> {
    this.orchestratorLogger.info('Starting OrchestratorAgent');

    await this.ipfs.connect();
    await this.memoryManager.loadMemory();
    await this.libp2p.start();

    // Subscribe to halt signals
    this.libp2p.subscribe(TOPIC_HALT, async (msg: AgentMessage) => {
      this.orchestratorLogger.warn({ reason: msg.payload.reason }, 'Halt signal received');
      await this.halt();
    });

    // Register MCP tools
    const mcpRegistry = new MCPToolRegistry(
      this.mcp,
      this.libp2p,
      this.ipfs,
      this.x402,
      this.negotiationEngine,
      this.knownAgents,
      this.identity.agentId
    );
    mcpRegistry.registerAll();

    const server = this.app.listen(this.orchestratorConfig.port, () => {
      this.orchestratorLogger.info(
        { port: this.orchestratorConfig.port },
        'Orchestrator HTTP server started'
      );
    });

    server.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.isRunning = true;
    this.orchestratorLogger.info(
      { agentId: this.identity.agentId },
      'OrchestratorAgent ready'
    );
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.orchestratorLogger.info({ taskId: task.taskId, type: task.type }, 'Handling task');
    this.broadcastStatus('thinking', `Processing task: ${task.type}`);

    // Use Claude with ReAct loop for complex tasks
    const result = await this.runReActLoop(task);
    await this.memoryManager.recordTask(task.taskId, task.type, result.success);

    this.broadcastStatus('running', `Completed task: ${task.type}`);
    return result;
  }

  getCapabilities(): AgentCapability[] {
    return [
      { name: 'orchestrate', description: 'Orchestrate multi-agent workflows' },
      { name: 'negotiate', description: 'Negotiate with vendor agents' },
      { name: 'delegate', description: 'Delegate tasks to specialist agents' },
      { name: 'approve', description: 'Request human approval for decisions' },
    ];
  }

  private async runReActLoop(task: AgentTask): Promise<TaskResult> {
    const systemPrompt = `You are a personal AI agent that manages subscriptions and purchases on behalf of your user.
You coordinate specialist agents to gather data, analyze options, and execute decisions.
Always explain your reasoning before taking action.
Never spend more than the user's configured budget without explicit confirmation.

Available MCP tools: ${this.mcp.listTools().join(', ')}

When analyzing a task:
1. Think step by step about what information you need
2. Use the available tools to gather data
3. Make a recommendation with clear reasoning
4. If the task involves spending money over $10, request human approval first`;

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Task: ${task.type}\nPayload: ${JSON.stringify(task.payload, null, 2)}`,
      },
    ];

    let reasoning: string[] = [];
    let finalResult: Record<string, unknown> = {};

    try {
      for (let iteration = 0; iteration < 5; iteration++) {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: systemPrompt,
          tools: this.mcp.getToolDefinitions() as Anthropic.Tool[],
          messages,
        });

        for (const block of response.content) {
          if (block.type === 'text') {
            reasoning.push(block.text);
            this.broadcastIntent({
              agentId: this.identity.agentId,
              agentName: 'OrchestratorAgent',
              action: 'THINKING',
              description: block.text.slice(0, 200),
              timestamp: Date.now(),
              status: 'executing',
            });
          } else if (block.type === 'tool_use') {
            const toolResult = await this.mcp.invokeTool(
              block.name,
              block.input as Record<string, unknown>
            );
            const resultContent = toolResult.isOk()
              ? JSON.stringify(toolResult.value)
              : `Error: ${toolResult.error.message}`;

            messages.push({ role: 'assistant', content: response.content });
            messages.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: resultContent,
                },
              ],
            });
            finalResult[block.name] = toolResult.isOk() ? toolResult.value : null;
          }
        }

        if (response.stop_reason === 'end_turn') break;
      }

      return {
        taskId: task.taskId,
        success: true,
        data: { reasoning, result: finalResult },
        completedAt: Date.now(),
      };
    } catch (error) {
      this.orchestratorLogger.error({ error }, 'ReAct loop failed');
      return {
        taskId: task.taskId,
        success: false,
        error: String(error),
        completedAt: Date.now(),
      };
    }
  }

  private setupRoutes(): void {
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', agentId: this.identity.agentId, halted: this.isHalted });
    });

    this.app.post('/tasks', async (req, res) => {
      if (this.isHalted) {
        return res.status(503).json({ error: 'Agent halted' });
      }
      const task = req.body as AgentTask;
      const result = await this.handleTask(task);
      return res.json(result);
    });

    this.app.post('/demo/run', async (_req, res) => {
      if (this.isHalted) {
        return res.status(503).json({ error: 'Agent halted' });
      }
      const { SubscriptionTask } = await import('./tasks/SubscriptionTask');
      const subscriptionTask = new SubscriptionTask(
        this,
        this.libp2p,
        this.ipfs,
        this.x402,
        this.negotiationEngine,
        this.knownAgents,
        this.identity.agentId
      );
      const result = await subscriptionTask.run();
      return res.json(result);
    });

    this.app.post('/autonomy', (req, res) => {
      const { level } = req.body as { level: number };
      this.memoryManager.setAutonomyLevel(level);
      this.broadcastStatus('running', `Autonomy level updated to ${level}`);
      res.json({ success: true, level });
    });

    this.app.get('/memory', async (_req, res) => {
      const memory = this.memoryManager.getMemory();
      res.json(memory ?? { error: 'No memory loaded' });
    });

    this.app.get('/agents', (_req, res) => {
      const agents = Array.from(this.knownAgents.values());
      res.json(agents);
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.wsClients.add(ws);
      this.orchestratorLogger.debug('WebSocket client connected');

      ws.on('close', () => {
        this.wsClients.delete(ws);
      });

      ws.on('error', (err) => {
        this.orchestratorLogger.error({ err }, 'WebSocket error');
        this.wsClients.delete(ws);
      });

      // Send current status on connect
      ws.send(
        JSON.stringify({
          type: 'state',
          agentId: this.identity.agentId,
          agentName: 'OrchestratorAgent',
          status: this.getStatus(),
          timestamp: Date.now(),
        })
      );
    });
  }

  broadcastStatus(status: string, intent: string): void {
    const message = JSON.stringify({
      type: 'state',
      agentId: this.identity.agentId,
      agentName: 'OrchestratorAgent',
      status,
      intent,
      timestamp: Date.now(),
    });

    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  broadcastIntent(intent: Intent): void {
    this.libp2p
      .broadcastIntent(intent.agentId, intent.action, intent.description, intent.target)
      .catch(() => {});

    const message = JSON.stringify({ type: 'intent', ...intent });
    this.wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  getLibP2P(): LibP2PClient {
    return this.libp2p;
  }

  getIPFS(): IPFSStorage {
    return this.ipfs;
  }

  getX402(): x402Client {
    return this.x402;
  }

  getNegotiationEngine(): NegotiationEngine {
    return this.negotiationEngine;
  }

  getKnownAgents(): Map<string, unknown> {
    return this.knownAgents;
  }

  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  override async halt(): Promise<void> {
    await super.halt();
    await this.libp2p.broadcastHalt('Orchestrator halted', this.identity.agentId);
    await this.memoryManager.saveMemory();
    this.broadcastStatus('halted', 'Agent halted by kill switch');
  }
}
