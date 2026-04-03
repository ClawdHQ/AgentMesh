import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import pino from 'pino';
import Anthropic from '@anthropic-ai/sdk';
import { AGENTMESH_VERSION, type InternalServiceMetadata, type MissionPlan } from '@agentmesh/shared';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  PRIVATE_KEY: z.string().min(1),
  ORCHESTRATOR_PORT: z.string().transform(Number).default('3002'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  INTERNAL_SERVICE_API_KEY: z.string().optional(),
});

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});

async function main() {
  const env = EnvSchema.parse(process.env);
  const anthropic = env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    : undefined;

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

  const metadata: InternalServiceMetadata = {
    service: 'orchestrator',
    version: AGENTMESH_VERSION,
    generatedAt: new Date().toISOString(),
    ready: true,
    agents: [
      {
        key: 'orchestrator',
        name: 'Orchestrator Agent',
        role: 'orchestrator',
        url: '/plan',
        description: 'Plans missions, defines checkpoints, and enforces approval boundaries.',
        capabilities: ['plan_mission', 'define_approval_policy'],
      },
    ],
  };

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: metadata.service });
  });

  app.get('/metadata', (_req, res) => {
    res.json({
      ...metadata,
      generatedAt: new Date().toISOString(),
    });
  });

  app.post('/plan', async (req, res) => {
    try {
      const plan = await createMissionPlan(req.body, anthropic);
      return res.json(plan);
    } catch (error) {
      logger.error({ error }, 'Failed to create mission plan');
      return res.status(500).json({ error: String(error) });
    }
  });

  app.listen(env.ORCHESTRATOR_PORT, () => {
    logger.info({ port: env.ORCHESTRATOR_PORT }, 'Orchestrator planning service started');
  });
}

async function createMissionPlan(
  input: { objective?: string; budgetWei?: string; autonomyLevel?: number },
  anthropic?: Anthropic
): Promise<MissionPlan> {
  if (anthropic && input.objective) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system:
          'You are a mission planner for a trustworthy autonomous agent system. Return concise JSON with summary, checkpoints, and approvalPolicy.',
        messages: [
          {
            role: 'user',
            content: JSON.stringify(input),
          },
        ],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      const parsed = extractJson(text) as unknown as MissionPlan;
      if (parsed.summary && Array.isArray(parsed.checkpoints) && parsed.approvalPolicy) {
        return parsed;
      }
    } catch (error) {
      logger.warn({ error }, 'Falling back to deterministic planning response');
    }
  }

  return {
    summary: `Coordinate data collection, vendor ranking, risk assessment, and escrow settlement for: ${input.objective ?? 'autonomous mission'}`,
    checkpoints: [
      'Collect live market context and vendor quotes',
      'Rank vendors and compute settlement risk',
      'Persist encrypted requirements and log the decision onchain',
      'Require approval if policy or risk thresholds are exceeded',
      'Settle onchain and archive the result on Filecoin-backed storage',
    ],
    approvalPolicy: `Require approval when autonomy policy or settlement-risk policy triggers for autonomy level ${input.autonomyLevel ?? 2}.`,
  };
}

function extractJson(content: string): Record<string, unknown> {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Planner response did not contain JSON');
  }
  return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
}

main().catch((err) => {
  logger.error(err, 'Fatal error starting orchestrator');
  process.exit(1);
});
