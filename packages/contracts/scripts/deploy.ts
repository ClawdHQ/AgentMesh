import { ethers } from 'hardhat';
import fs from 'fs';
import path from 'path';

const ROOT_ENV_PATH = path.resolve(__dirname, '../../../.env');
const ORCHESTRATOR_ENV_PATH = path.resolve(__dirname, '../../../apps/orchestrator/.env');
const SPECIALIST_ENV_PATH = path.resolve(__dirname, '../../../apps/specialist-agents/.env');
const VENDOR_ENV_PATH = path.resolve(__dirname, '../../../apps/vendor-agent/.env');
const API_SERVER_ENV_PATH = path.resolve(__dirname, '../../../apps/api-server/.env');
const LEGACY_ENV_KEYS = ['BASE_SEPOLIA_RPC_URL', 'USDC_ADDRESS_BASE_SEPOLIA'];

function upsertEnvValue(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const nextLine = `${key}=${value}`;

  if (pattern.test(content)) {
    return content.replace(pattern, nextLine);
  }

  const normalized = content.endsWith('\n') || content.length === 0 ? content : `${content}\n`;
  return `${normalized}${nextLine}\n`;
}

function removeEnvKeys(content: string, keys: string[]): string {
  return content
    .split('\n')
    .filter((line) => !keys.some((key) => line.startsWith(`${key}=`)))
    .join('\n');
}

function syncEnvFile(filePath: string, values: Record<string, string>) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const sanitized = removeEnvKeys(existing, LEGACY_ENV_KEYS);
  const next = Object.entries(values).reduce(
    (content, [key, value]) => upsertEnvValue(content, key, value),
    sanitized
  );
  fs.writeFileSync(filePath, next);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying AgentMesh contracts with account:', deployer.address);

  const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
  const agentRegistry = await AgentRegistry.deploy(deployer.address);
  await agentRegistry.waitForDeployment();
  console.log('AgentRegistry deployed to:', await agentRegistry.getAddress());

  const TaskEscrow = await ethers.getContractFactory('TaskEscrow');
  const taskEscrow = await TaskEscrow.deploy(
    deployer.address,
    await agentRegistry.getAddress()
  );
  await taskEscrow.waitForDeployment();
  console.log('TaskEscrow deployed to:', await taskEscrow.getAddress());

  const ReputationOracle = await ethers.getContractFactory('ReputationOracle');
  const reputationOracle = await ReputationOracle.deploy(deployer.address);
  await reputationOracle.waitForDeployment();
  console.log('ReputationOracle deployed to:', await reputationOracle.getAddress());

  const AuditLogger = await ethers.getContractFactory('AuditLogger');
  const auditLogger = await AuditLogger.deploy(deployer.address);
  await auditLogger.waitForDeployment();
  console.log('AuditLogger deployed to:', await auditLogger.getAddress());

  const addresses = {
    CHAIN_ID: '11155111',
    SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL ?? '',
    USDC_ADDRESS_SEPOLIA: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    AGENT_REGISTRY_ADDRESS: await agentRegistry.getAddress(),
    TASK_ESCROW_ADDRESS: await taskEscrow.getAddress(),
    REPUTATION_ORACLE_ADDRESS: await reputationOracle.getAddress(),
    AUDIT_LOGGER_ADDRESS: await auditLogger.getAddress(),
  };

  syncEnvFile(ROOT_ENV_PATH, addresses);
  syncEnvFile(ORCHESTRATOR_ENV_PATH, addresses);
  syncEnvFile(SPECIALIST_ENV_PATH, addresses);
  syncEnvFile(VENDOR_ENV_PATH, addresses);
  syncEnvFile(API_SERVER_ENV_PATH, addresses);

  console.log('\nDeployment complete!');
  console.log('Updated environment files with:');
  for (const [key, value] of Object.entries(addresses)) {
    if (value) {
      console.log(`${key}=${value}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
