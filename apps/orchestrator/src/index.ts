import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import pino from 'pino';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  PRIVATE_KEY: z.string().min(1),
  SEPOLIA_RPC_URL: z.string().default('https://rpc.sepolia.org'),
  AGENT_REGISTRY_ADDRESS: z.string().optional(),
  TASK_ESCROW_ADDRESS: z.string().optional(),
  AUDIT_LOGGER_ADDRESS: z.string().optional(),
  USDC_ADDRESS_SEPOLIA: z.string().default('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
  LIBP2P_PORT: z.string().transform(Number).default('9000'),
  ORCHESTRATOR_PORT: z.string().transform(Number).default('3002'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  W3_STORAGE_EMAIL: z.string().optional(),
  W3_STORAGE_SPACE_DID: z.string().optional(),
});

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});

async function main() {
  const env = EnvSchema.parse(process.env);
  logger.info({ port: env.ORCHESTRATOR_PORT }, 'Starting OrchestratorAgent');

  const { OrchestratorAgent } = await import('./OrchestratorAgent');

  const agent = new OrchestratorAgent({
    name: 'OrchestratorAgent',
    description:
      'Personal AI agent that manages subscriptions and purchases on behalf of your user',
    capabilities: ['orchestrate', 'negotiate', 'delegate', 'approve'],
    privateKey: env.PRIVATE_KEY,
    rpcUrl: env.SEPOLIA_RPC_URL,
    agentRegistryAddress: env.AGENT_REGISTRY_ADDRESS,
    taskEscrowAddress: env.TASK_ESCROW_ADDRESS,
    auditLoggerAddress: env.AUDIT_LOGGER_ADDRESS,
    libp2pPort: env.LIBP2P_PORT,
    bootstrapPeers: [],
    logLevel: env.LOG_LEVEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    usdcAddress: env.USDC_ADDRESS_SEPOLIA,
    port: env.ORCHESTRATOR_PORT,
  });

  // agent.setupGracefulShutdown(); // Not present on OrchestratorAgent
  await agent.start();
}

main().catch((err) => {
  logger.error(err, 'Fatal error starting orchestrator');
  process.exit(1);
});
