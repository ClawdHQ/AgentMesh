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
  VENDOR_AGENT_PORT: z.string().transform(Number).default('3004'),
  USDC_ADDRESS_SEPOLIA: z.string().default('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  INTERNAL_SERVICE_API_KEY: z.string().optional(),
});

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'vendor-agent' });

async function main() {
  const env = EnvSchema.parse(process.env);
  logger.info({ port: env.VENDOR_AGENT_PORT }, 'Starting VendorAgent service');

  const { VendorAgent } = await import('./VendorAgent');
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

  const vendorAgents = [
    new VendorAgent({
      name: 'Vertex Inference Market',
      description: 'Offers performant inference capacity with moderate price flexibility.',
      capabilities: ['quote_vendor', 'gpu_inference', 'batch_scoring'],
      privateKey: env.PRIVATE_KEY,
      rpcUrl: env.SEPOLIA_RPC_URL,
      libp2pPort: 0,
      bootstrapPeers: [],
      logLevel: env.LOG_LEVEL,
      profile: {
        key: 'vendor-alpha',
        vendorName: 'Vertex Inference Market',
        description: 'Offers performant inference capacity with moderate price flexibility.',
        capabilities: ['gpu_inference', 'batch_scoring'],
        features: ['fast-turnaround', 'batch-scoring', 'audit-ready'],
        initialPriceEth: '0.0105',
        floorPriceEth: '0.0088',
        reputationScore: 78,
        successRate: 0.92,
        taskCount: 12,
      },
    }),
    new VendorAgent({
      name: 'Nimbus Compute Mesh',
      description: 'Offers lower-cost execution with reliable delivery and tight settlement discipline.',
      capabilities: ['quote_vendor', 'execution', 'transaction_settlement'],
      privateKey: env.PRIVATE_KEY,
      rpcUrl: env.SEPOLIA_RPC_URL,
      libp2pPort: 0,
      bootstrapPeers: [],
      logLevel: env.LOG_LEVEL,
      profile: {
        key: 'vendor-beta',
        vendorName: 'Nimbus Compute Mesh',
        description: 'Offers lower-cost execution with reliable delivery and tight settlement discipline.',
        capabilities: ['execution', 'transaction_settlement'],
        features: ['low-cost-execution', 'predictable-settlement', 'slashing-guardrails'],
        initialPriceEth: '0.0098',
        floorPriceEth: '0.0079',
        reputationScore: 84,
        successRate: 0.95,
        taskCount: 19,
      },
    }),
    new VendorAgent({
      name: 'Atlas Autonomous Services',
      description: 'High-reputation premium operator for long-running autonomous tasks.',
      capabilities: ['quote_vendor', 'autonomous_workflows', 'proof_attestation'],
      privateKey: env.PRIVATE_KEY,
      rpcUrl: env.SEPOLIA_RPC_URL,
      libp2pPort: 0,
      bootstrapPeers: [],
      logLevel: env.LOG_LEVEL,
      profile: {
        key: 'vendor-gamma',
        vendorName: 'Atlas Autonomous Services',
        description: 'High-reputation premium operator for long-running autonomous tasks.',
        capabilities: ['autonomous_workflows', 'proof_attestation'],
        features: ['high-availability', 'proof-attestation', 'multi-step-workflows'],
        initialPriceEth: '0.0119',
        floorPriceEth: '0.0091',
        reputationScore: 91,
        successRate: 0.98,
        taskCount: 26,
      },
    }),
  ];

  const metadata: InternalServiceMetadata = {
    service: 'vendor-agent',
    version: AGENTMESH_VERSION,
    generatedAt: new Date().toISOString(),
    ready: true,
    agents: vendorAgents.map((agent) => ({
      key: agent.getProfile().key,
      name: agent.getProfile().vendorName,
      role: 'vendor',
      url: '/quotes',
      description: agent.getProfile().description,
      capabilities: agent.getProfile().capabilities,
      address: agent.getAddress(),
    })),
  };

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: metadata.service, vendors: vendorAgents.length });
  });

  app.get('/metadata', (_req, res) => {
    res.json({
      ...metadata,
      generatedAt: new Date().toISOString(),
    });
  });

  app.post('/a2a/tasks', async (req, res) => {
    const { task } = req.body as {
      task: { type: string; taskId: string; payload: Record<string, unknown> };
    };
    const results = await Promise.all(vendorAgents.map((agent) => agent.handleTask(task)));
    return res.json({
      taskId: task.taskId,
      success: true,
      data: {
        result: results.flatMap((result) => (result.data?.result ? [result.data.result] : [])),
      },
      completedAt: Date.now(),
    });
  });

  app.post('/quotes', async (req, res) => {
    const objective = typeof req.body?.objective === 'string' ? req.body.objective : 'Mission quote';
    const budgetWei = typeof req.body?.budgetWei === 'string' ? req.body.budgetWei : '0';
    const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : `quote-${Date.now()}`;

    const quotes = vendorAgents.map((agent) =>
      agent.generateQuote({
        objective,
        budgetWei,
        taskId,
      })
    );
    return res.json(quotes);
  });

  app.listen(env.VENDOR_AGENT_PORT, () => {
    logger.info({ port: env.VENDOR_AGENT_PORT }, 'VendorAgent HTTP server started');
  });
}

main().catch((err) => {
  logger.error(err, 'Fatal error starting vendor agent');
  process.exit(1);
});
