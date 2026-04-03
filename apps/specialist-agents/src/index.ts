import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import pino from 'pino';
import { AGENTMESH_VERSION, type InternalServiceMetadata } from '@agentmesh/shared';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const EnvSchema = z.object({
  PRIVATE_KEY: z.string().min(1),
  SEPOLIA_RPC_URL: z.string().default('https://rpc.sepolia.org'),
  SPECIALIST_AGENTS_PORT: z.string().transform(Number).default('3003'),
  USDC_ADDRESS_SEPOLIA: z.string().default('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATA_AGENT_PRICE_USDC: z.string().transform(Number).default('1000'),
  COMPUTE_AGENT_PRICE_USDC: z.string().transform(Number).default('5000'),
  EXECUTOR_AGENT_PRICE_USDC: z.string().transform(Number).default('2000'),
  AGENT_REGISTRY_ADDRESS: z.string().optional(),
  REPUTATION_ORACLE_ADDRESS: z.string().optional(),
  INTERNAL_SERVICE_API_KEY: z.string().optional(),
  IMPULSE_API_KEY: z.string().optional(),
  IMPULSE_DEPLOYMENT_ID: z.string().optional(),
});

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'specialist-agents' });

async function main() {
  const env = EnvSchema.parse(process.env);
  logger.info({ port: env.SPECIALIST_AGENTS_PORT }, 'Starting specialist agents');

  const { DataAgent } = await import('./DataAgent');
  const { ComputeAgent } = await import('./ComputeAgent');
  const { ExecutorAgent } = await import('./ExecutorAgent');

  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (!env.INTERNAL_SERVICE_API_KEY) {
      return next();
    }
    if (req.path === '/health' || req.path === '/metadata') {
      return next();
    }
    if (req.header('x-agentmesh-internal-key') !== env.INTERNAL_SERVICE_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  });

  const dataAgent = new DataAgent({
    name: 'DataAgent',
    description: 'Fetches live market context and network metrics for missions',
    capabilities: ['fetch_market_context', 'fetch_api_pricing', 'fetch_usage_metrics'],
    privateKey: env.PRIVATE_KEY,
    rpcUrl: env.SEPOLIA_RPC_URL,
    libp2pPort: 0,
    bootstrapPeers: [],
    logLevel: env.LOG_LEVEL,
    pricing: {
      model: 'per-call',
      amount: BigInt(env.DATA_AGENT_PRICE_USDC),
      currency: 'USDC',
      token: env.USDC_ADDRESS_SEPOLIA,
    },
  });

  const computeAgent = new ComputeAgent(
    {
      name: 'ComputeAgent',
      description: 'Scores vendors and predicts settlement risk for every mission',
      capabilities: ['analyze_pricing', 'score_vendors', 'calculate_savings', 'assess_settlement_risk'],
      privateKey: env.PRIVATE_KEY,
      rpcUrl: env.SEPOLIA_RPC_URL,
      libp2pPort: 0,
      bootstrapPeers: [],
      logLevel: env.LOG_LEVEL,
      pricing: {
        model: 'per-call',
        amount: BigInt(env.COMPUTE_AGENT_PRICE_USDC),
        currency: 'USDC',
        token: env.USDC_ADDRESS_SEPOLIA,
      },
    },
    env.IMPULSE_API_KEY,
    env.IMPULSE_DEPLOYMENT_ID
  );

  const executorAgent = new ExecutorAgent({
    name: 'ExecutorAgent',
    description: 'Signs attestations and syncs onchain reputation state',
    capabilities: ['sign_transaction', 'submit_payment', 'update_registry'],
    privateKey: env.PRIVATE_KEY,
    rpcUrl: env.SEPOLIA_RPC_URL,
    libp2pPort: 0,
    bootstrapPeers: [],
    logLevel: env.LOG_LEVEL,
    agentRegistryAddress: env.AGENT_REGISTRY_ADDRESS,
    reputationOracleAddress: env.REPUTATION_ORACLE_ADDRESS,
    pricing: {
      model: 'per-call',
      amount: BigInt(env.EXECUTOR_AGENT_PRICE_USDC),
      currency: 'USDC',
      token: env.USDC_ADDRESS_SEPOLIA,
    },
  });

  const metadata: InternalServiceMetadata = {
    service: 'specialist-agents',
    version: AGENTMESH_VERSION,
    generatedAt: new Date().toISOString(),
    ready: true,
    agents: [
      {
        key: 'data',
        name: 'Data Agent',
        role: 'data',
        url: '/a2a/tasks',
        description: 'Fetches live market context and network metrics for missions',
        capabilities: ['fetch_market_context', 'fetch_api_pricing', 'fetch_usage_metrics'],
        address: dataAgent.getAddress(),
        pricing: {
          model: 'per-call',
          amount: BigInt(env.DATA_AGENT_PRICE_USDC).toString(),
          currency: 'USDC',
        },
      },
      {
        key: 'compute',
        name: 'Compute Agent',
        role: 'compute',
        url: '/a2a/tasks',
        description: 'Scores vendors and predicts settlement risk for every mission',
        capabilities: ['analyze_pricing', 'score_vendors', 'calculate_savings', 'assess_settlement_risk'],
        address: computeAgent.getAddress(),
        pricing: {
          model: 'per-call',
          amount: BigInt(env.COMPUTE_AGENT_PRICE_USDC).toString(),
          currency: 'USDC',
        },
      },
      {
        key: 'executor',
        name: 'Executor Agent',
        role: 'executor',
        url: '/a2a/tasks',
        description: 'Signs attestations and syncs onchain reputation state',
        capabilities: ['sign_transaction', 'submit_payment', 'update_registry'],
        address: executorAgent.getAddress(),
        pricing: {
          model: 'per-call',
          amount: BigInt(env.EXECUTOR_AGENT_PRICE_USDC).toString(),
          currency: 'USDC',
        },
      },
    ],
  };

  app.get('/health', async (_req, res) => {
    res.json({
      status: 'ok',
      service: metadata.service,
      agents: metadata.agents.length,
    });
  });

  app.get('/metadata', async (_req, res) => {
    res.json({
      ...metadata,
      generatedAt: new Date().toISOString(),
    });
  });

  app.post('/a2a/tasks', async (req, res) => {
    const { task } = req.body as { task: { type: string; taskId: string; payload: Record<string, unknown> } };

    try {
      let result;
      if (['fetch_market_context', 'fetch_api_pricing', 'fetch_usage_metrics'].includes(task.type)) {
        result = await dataAgent.handleTask(task);
      } else if (
        ['analyze_pricing', 'score_vendors', 'calculate_savings', 'assess_settlement_risk'].includes(task.type)
      ) {
        result = await computeAgent.handleTask(task);
      } else if (['sign_transaction', 'submit_payment', 'update_registry'].includes(task.type)) {
        result = await executorAgent.handleTask(task);
      } else {
        return res.status(400).json({ error: `Unknown task type: ${task.type}` });
      }
      return res.json(result);
    } catch (err) {
      logger.error({ err }, 'Task execution failed');
      return res.status(500).json({ error: String(err) });
    }
  });

  app.post('/risk-assessment', async (req, res) => {
    try {
      const assessment = await computeAgent.assessSettlementRisk(req.body);
      return res.json({ assessment });
    } catch (error) {
      logger.error({ error }, 'Risk assessment failed');
      return res.status(500).json({ error: String(error) });
    }
  });

  app.listen(env.SPECIALIST_AGENTS_PORT, () => {
    logger.info({ port: env.SPECIALIST_AGENTS_PORT }, 'Specialist agents HTTP server started');
  });
}

main().catch((err) => {
  logger.error(err, 'Fatal error starting specialist agents');
  process.exit(1);
});
