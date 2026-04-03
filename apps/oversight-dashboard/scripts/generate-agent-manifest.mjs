import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dashboardUrl = stripSlash(
  readEnv('PUBLIC_DASHBOARD_URL') ?? readEnv('VITE_DASHBOARD_ORIGIN') ?? 'http://localhost:5173'
);
const apiUrl = stripSlash(readEnv('PUBLIC_API_URL') ?? readEnv('VITE_API_URL') ?? 'http://localhost:3001');
const autonomyLevel = Number(process.env.AUTONOMY_LEVEL ?? '2');
const storageProvider = readEnv('FILECOIN_STORAGE_PROVIDER') ?? 'lighthouse';

const manifest = {
  agentId: 'agentmesh-control-plane',
  agentName: 'AgentMesh',
  version: process.env.npm_package_version ?? '0.1.0',
  description:
    'Production-grade autonomous agent control plane with ERC-8004 identity, onchain settlement, Filecoin-backed receipts, and human oversight.',
  homepage: dashboardUrl,
  controlPlaneUrl: apiUrl,
  dashboardUrl,
  agentLogUrl: `${apiUrl}/agent_log.json`,
  capabilities: [
    'trust-gated-agent-routing',
    'onchain-settlement',
    'filecoin-backed-receipts',
    'impulse-risk-scoring',
    'human-oversight',
  ],
  tracks: [
    'AI & Robotics',
    'Impulse AI: Autonomous ML for Every App',
    'Agents With Receipts — 8004',
    'Filecoin',
  ],
  receipts: {
    onchainIdentityRegistry: readEnv('AGENT_REGISTRY_ADDRESS') ?? '',
    settlementEscrow: readEnv('TASK_ESCROW_ADDRESS') ?? '',
    auditLogger: readEnv('AUDIT_LOGGER_ADDRESS') ?? '',
    filecoinArtifacts: storageProvider,
  },
  networks: {
    sepoliaChainId: Number(process.env.CHAIN_ID ?? '11155111'),
    filecoinCalibrationEnabled: storageProvider === 'filecoin-pin',
  },
  operatorModel: {
    humanOversight: true,
    haltSupported: true,
    approvalRequiredAbove: approvalThresholdForAutonomy(autonomyLevel),
  },
};

const publicDir = resolve(process.cwd(), 'public');
mkdirSync(publicDir, { recursive: true });
writeFileSync(resolve(publicDir, 'agent.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

function stripSlash(value) {
  return value.replace(/\/$/, '');
}

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

function approvalThresholdForAutonomy(level) {
  switch (level) {
    case 0:
    case 1:
      return '0';
    case 2:
      return '0.004';
    case 3:
      return '0.02';
    default:
      return 'unbounded';
  }
}
