import dotenv from 'dotenv';
import { z } from 'zod';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { LibP2PClient } from '@agentmesh/agent-sdk';
import { TOPIC_INTENTS, TOPIC_HALT, TOPIC_TASKS } from '@agentmesh/shared';
import type { AgentMessage } from '@agentmesh/agent-sdk';
import { agentsRouter } from './routes/agents';
import { tasksRouter } from './routes/tasks';
import { haltRouter } from './routes/halt';
import { auditRouter } from './routes/audit';
import { IntentBroadcaster } from './websocket/IntentBroadcaster';

dotenv.config();

const EnvSchema = z.object({
  API_PORT: z.string().transform(Number).default('3001'),
  LIBP2P_PORT: z.string().transform(Number).default('9004'),
  PRIVATE_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const env = EnvSchema.parse(process.env);

const logger = pino({ level: env.LOG_LEVEL, name: 'api-server' });
const app = express();
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  })
);
app.use(express.json());
app.use(pinoHttp({ logger }));

// libp2p bridge
const libp2p = new LibP2PClient(
  env.LIBP2P_PORT,
  [],
  `api-server-${env.API_PORT}`
);

const broadcaster = new IntentBroadcaster(wss, libp2p);

// Agent state store (in-memory for demo)
const agentStates = new Map<
  string,
  {
    agentId: string;
    agentName: string;
    status: string;
    intent?: string;
    timestamp: number;
  }
>();

const haltState = { halted: false, reason: '' };

// WebSocket handler
wss.on('connection', (ws: WebSocket) => {
  logger.info('WebSocket client connected');

  // Send current agent states on connect
  for (const state of agentStates.values()) {
    ws.send(JSON.stringify({ type: 'state', ...state }));
  }
  ws.send(JSON.stringify({ type: 'halt_state', ...haltState }));

  ws.on('error', (err) => {
    logger.error({ err }, 'WebSocket client error');
  });
});

// Update agent state when messages arrive via libp2p
libp2p.on('message', (data: { topic: string; message: string; from: string }) => {
  try {
    const msg = JSON.parse(data.message) as AgentMessage;
    if (msg.type === 'intent') {
      const state = {
        agentId: msg.from,
        agentName: String(msg.payload.agentName ?? msg.from),
        status: 'running',
        intent: String(msg.payload.description ?? ''),
        timestamp: msg.timestamp,
      };
      agentStates.set(msg.from, state);
      broadcaster.broadcast(JSON.stringify({ type: 'intent', ...msg.payload, timestamp: msg.timestamp }));
    } else if (msg.type === 'halt') {
      haltState.halted = true;
      haltState.reason = String(msg.payload.reason ?? 'unknown');
      broadcaster.broadcast(JSON.stringify({ type: 'halt_state', ...haltState }));
    }
  } catch {
    // ignore parse errors
  }
});

// Routes
app.use('/agents', agentsRouter(agentStates));
app.use('/tasks', tasksRouter(libp2p));
app.use('/halt', haltRouter(libp2p, haltState, broadcaster));
app.use('/audit', auditRouter());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', halted: haltState.halted, connections: wss.clients.size });
});

// Start
async function start() {
  await libp2p.start();
  broadcaster.start();

  httpServer.listen(env.API_PORT, () => {
    logger.info({ port: env.API_PORT }, 'API server started');
    logger.info({ port: env.API_PORT }, 'WebSocket server started at ws://localhost:' + env.API_PORT + '/ws');
  });
}

start().catch((err) => {
  logger.error(err, 'Failed to start API server');
  process.exit(1);
});
