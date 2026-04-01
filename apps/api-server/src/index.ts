import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import http from 'http';
import path from 'path';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { StructuredAutonomousSystem } from './mesh/runtime';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(3001),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  CHAIN_ID: z.coerce.number().default(11155111),
  SEPOLIA_RPC_URL: z.string().optional(),
  PRIVATE_KEY: z.string().optional(),
  AGENT_REGISTRY_ADDRESS: z.string().optional(),
  TASK_ESCROW_ADDRESS: z.string().optional(),
  AUDIT_LOGGER_ADDRESS: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('openai/gpt-4.1-mini'),
  LIGHTHOUSE_API_KEY: z.string().optional(),
  LIGHTHOUSE_GATEWAY_URL: z.string().default('https://gateway.lighthouse.storage/ipfs/'),
  LIT_NETWORK: z.string().default('datil-dev'),
  AUTONOMY_LEVEL: z.coerce.number().default(2),
  VITE_DASHBOARD_ORIGIN: z.string().default('http://localhost:5173'),
});

const env = EnvSchema.parse(process.env);
const logger = pino({ name: 'agentmesh-api', level: env.LOG_LEVEL });

const runtime = new StructuredAutonomousSystem({
  apiLabel: env.CHAIN_ID === 11155111 ? 'Ethereum Sepolia' : `Chain ${env.CHAIN_ID}`,
  chainId: env.CHAIN_ID,
  rpcUrl: env.SEPOLIA_RPC_URL,
  privateKey: env.PRIVATE_KEY,
  registryAddress: env.AGENT_REGISTRY_ADDRESS,
  taskEscrowAddress: env.TASK_ESCROW_ADDRESS,
  auditLoggerAddress: env.AUDIT_LOGGER_ADDRESS,
  autonomyLevel: env.AUTONOMY_LEVEL,
  openRouterApiKey: env.OPENROUTER_API_KEY,
  openRouterModel: env.OPENROUTER_MODEL,
  lighthouseApiKey: env.LIGHTHOUSE_API_KEY,
  lighthouseGatewayUrl: env.LIGHTHOUSE_GATEWAY_URL,
  litNetwork: env.LIT_NETWORK,
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(
  cors({
    origin: [env.VITE_DASHBOARD_ORIGIN, 'http://localhost:3000'],
    credentials: true,
  })
);
app.use(express.json());
app.use(pinoHttp({ logger }));

wss.on('connection', (ws: WebSocket) => {
  ws.send(JSON.stringify({ type: 'snapshot', payload: runtime.getSnapshot() }));
});

runtime.on('snapshot', (snapshot) => {
  const payload = JSON.stringify({ type: 'snapshot', payload: snapshot });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
});

const RunMissionSchema = z.object({
  title: z.string().optional(),
  objective: z.string().min(8),
  budgetEth: z.string().regex(/^\d+(\.\d+)?$/),
});

const AutonomySchema = z.object({
  level: z.number().int().min(0).max(4),
});

app.get('/health', async (_req, res) => {
  res.json({
    status: 'ok',
    websocketClients: wss.clients.size,
    snapshot: runtime.getSnapshot(),
  });
});

app.get('/system', async (_req, res) => {
  res.json(runtime.getSnapshot());
});

app.get('/agents', async (_req, res) => {
  res.json(runtime.getSnapshot().agents);
});

app.get('/intents', async (_req, res) => {
  res.json(runtime.getSnapshot().intents);
});

app.get('/tasks', async (_req, res) => {
  res.json(runtime.getSnapshot().tasks);
});

app.get('/audit', async (_req, res) => {
  res.json(runtime.getSnapshot().audit);
});

app.get('/payments', async (_req, res) => {
  res.json(runtime.getSnapshot().payments);
});

app.get('/memory', async (_req, res) => {
  res.json(runtime.getSnapshot().memory);
});

app.post('/tasks/run', async (req, res) => {
  try {
    const mission = RunMissionSchema.parse(req.body);
    const task = await runtime.runMission(mission);
    res.status(201).json(task);
  } catch (error) {
    logger.error({ error }, 'Mission execution failed');
    res.status(400).json({ error: String(error) });
  }
});

app.post('/tasks/:taskId/approve', async (req, res) => {
  try {
    const task = await runtime.approveTask(req.params.taskId);
    res.json(task);
  } catch (error) {
    logger.error({ error, taskId: req.params.taskId }, 'Task approval failed');
    res.status(400).json({ error: String(error) });
  }
});

app.post('/autonomy', async (req, res) => {
  try {
    const { level } = AutonomySchema.parse(req.body);
    await runtime.setAutonomyLevel(level);
    res.json({ success: true, level });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

app.post('/halt', async (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'Operator halt';
  await runtime.halt(reason);
  res.json({ success: true, halted: true, reason });
});

app.post('/halt/resume', async (_req, res) => {
  await runtime.resume();
  res.json({ success: true, halted: false });
});

async function start() {
  await runtime.initialize();

  server.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT }, 'AgentMesh API server started');
  });
}

start().catch((error) => {
  logger.error({ error }, 'Failed to start API server');
  process.exit(1);
});
