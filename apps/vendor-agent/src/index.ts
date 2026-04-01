import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import type { AgentConfig } from '@agentmesh/agent-sdk';
import pino from 'pino';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const EnvSchema = z.object({
  PRIVATE_KEY: z.string().min(1),
  SEPOLIA_RPC_URL: z.string().default('https://rpc.sepolia.org'),
  VENDOR_AGENT_PORT: z.string().transform(Number).default('3004'),
  LIBP2P_PORT: z.string().transform(Number).default('9003'),
  USDC_ADDRESS_SEPOLIA: z.string().default('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vendor-agent' });

async function main() {
  const env = EnvSchema.parse(process.env);
  logger.info({ port: env.VENDOR_AGENT_PORT }, 'Starting VendorAgent');

  const { VendorAgent } = await import('./VendorAgent');
  const express = (await import('express')).default;

  const app = express();
  app.use(express.json());

  const baseConfig: AgentConfig = {
    name: 'VendorAgent',
    description: 'Mock vendor agent offering subscription pricing',
    capabilities: ['subscription_pricing'],
    privateKey: env.PRIVATE_KEY,
    rpcUrl: env.SEPOLIA_RPC_URL,
    libp2pPort: Number(env.LIBP2P_PORT),
    bootstrapPeers: [],
    logLevel: env.LOG_LEVEL,
  };
  const vendorAgent = new VendorAgent({
    ...baseConfig,
    listPrice: 9.0,
    vendorName: 'BetterComms Pro',
    usdcAddress: env.USDC_ADDRESS_SEPOLIA,
  });

  await vendorAgent.start();

  // A2A task endpoint
  app.post('/a2a/tasks', async (req, res) => {
    const { task } = req.body as {
      task: { type: string; taskId: string; payload: Record<string, unknown> };
    };
    const result = await vendorAgent.handleTask(task);
    return res.json(result);
  });

  // Negotiation endpoint
  app.post('/negotiate', async (req, res) => {
    const { taskId, round, budget } = req.body as {
      taskId: string;
      round: number;
      budget: number;
    };
    const bid = vendorAgent.generateBid(taskId, round, budget);
    return res.json(bid);
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', agent: 'VendorAgent' });
  });

  app.listen(env.VENDOR_AGENT_PORT, () => {
    logger.info({ port: env.VENDOR_AGENT_PORT }, 'VendorAgent HTTP server started');
  });

  // vendorAgent.setupGracefulShutdown(); // Not present on VendorAgent
}

main().catch((err) => {
  logger.error(err, 'Fatal error starting vendor agent');
  process.exit(1);
});
