import dotenv from 'dotenv';
import { z } from 'zod';
import pino from 'pino';

dotenv.config();

const EnvSchema = z.object({
  PRIVATE_KEY: z.string().min(1),
  BASE_SEPOLIA_RPC_URL: z.string().default('https://sepolia.base.org'),
  SPECIALIST_AGENTS_PORT: z.string().transform(Number).default('3003'),
  LIBP2P_PORT: z.string().transform(Number).default('9001'),
  USDC_ADDRESS_BASE_SEPOLIA: z.string().default('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATA_AGENT_PRICE_USDC: z.string().transform(Number).default('1000'),
  COMPUTE_AGENT_PRICE_USDC: z.string().transform(Number).default('5000'),
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

  const dataAgent = new DataAgent({
    name: 'DataAgent',
    description: 'Fetches subscription data, API pricing, and usage metrics',
    capabilities: ['fetch_subscription_data', 'fetch_api_pricing', 'fetch_usage_metrics'],
    privateKey: env.PRIVATE_KEY,
    rpcUrl: env.BASE_SEPOLIA_RPC_URL,
    libp2pPort: env.LIBP2P_PORT,
    bootstrapPeers: [],
    logLevel: env.LOG_LEVEL,
    pricing: {
      model: 'per-call',
      amount: BigInt(env.DATA_AGENT_PRICE_USDC),
      currency: 'USDC',
      token: env.USDC_ADDRESS_BASE_SEPOLIA,
    },
  });

  const computeAgent = new ComputeAgent(
    {
      name: 'ComputeAgent',
      description: 'Analyzes pricing, scores vendors, and calculates savings',
      capabilities: ['analyze_pricing', 'score_vendors', 'calculate_savings'],
      privateKey: env.PRIVATE_KEY,
      rpcUrl: env.BASE_SEPOLIA_RPC_URL,
      libp2pPort: env.LIBP2P_PORT + 1,
      bootstrapPeers: [],
      logLevel: env.LOG_LEVEL,
      pricing: {
        model: 'per-call',
        amount: BigInt(env.COMPUTE_AGENT_PRICE_USDC),
        currency: 'USDC',
        token: env.USDC_ADDRESS_BASE_SEPOLIA,
      },
    },
    env.ANTHROPIC_API_KEY ?? ''
  );

  const executorAgent = new ExecutorAgent({
    name: 'ExecutorAgent',
    description: 'Signs and submits transactions on-chain',
    capabilities: ['sign_transaction', 'submit_payment', 'update_registry'],
    privateKey: env.PRIVATE_KEY,
    rpcUrl: env.BASE_SEPOLIA_RPC_URL,
    libp2pPort: env.LIBP2P_PORT + 2,
    bootstrapPeers: [],
    logLevel: env.LOG_LEVEL,
  });

  // Register A2A task endpoints
  app.post('/a2a/tasks', async (req, res) => {
    const { task } = req.body as { task: { type: string; taskId: string; payload: Record<string, unknown> } };

    try {
      let result;
      if (['fetch_subscription_data', 'fetch_api_pricing', 'fetch_usage_metrics'].includes(task.type)) {
        result = await dataAgent.handleTask(task);
      } else if (['analyze_pricing', 'score_vendors', 'calculate_savings'].includes(task.type)) {
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

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      agents: ['DataAgent', 'ComputeAgent', 'ExecutorAgent'],
    });
  });

  app.listen(env.SPECIALIST_AGENTS_PORT, () => {
    logger.info({ port: env.SPECIALIST_AGENTS_PORT }, 'Specialist agents HTTP server started');
  });

  dataAgent.setupGracefulShutdown();
}

main().catch((err) => {
  logger.error(err, 'Fatal error starting specialist agents');
  process.exit(1);
});
