import dotenv from 'dotenv';
import path from 'path';
import { ethers } from 'ethers';
import { StructuredAutonomousSystem } from '../mesh/runtime';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const CHAIN_ID = Number(process.env.CHAIN_ID ?? '11155111');
const RPC_URL = process.env.SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const MISSIONS = [
  {
    title: 'Inference Capacity Procurement',
    objective: 'Source a reliable inference vendor for a 48-hour autonomous workload with strong delivery guarantees.',
    budgetEth: '0.0108',
  },
  {
    title: 'Autonomous Settlement Benchmark',
    objective: 'Select the lowest-risk execution vendor for repetitive onchain settlement tasks while preserving auditability.',
    budgetEth: '0.0102',
  },
];

async function main() {
  if (!RPC_URL || !PRIVATE_KEY) {
    throw new Error('SEPOLIA_RPC_URL and PRIVATE_KEY are required');
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const balanceWei = await wallet.getBalance();
  const balanceEth = Number(ethers.utils.formatEther(balanceWei));

  if (balanceEth < 0.02) {
    throw new Error(`Operator wallet balance is too low to seed dashboard stats safely: ${balanceEth} ETH`);
  }

  const runtime = new StructuredAutonomousSystem({
    apiLabel: CHAIN_ID === 11155111 ? 'Ethereum Sepolia' : `Chain ${CHAIN_ID}`,
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    privateKey: PRIVATE_KEY,
    registryAddress: process.env.AGENT_REGISTRY_ADDRESS,
    taskEscrowAddress: process.env.TASK_ESCROW_ADDRESS,
    auditLoggerAddress: process.env.AUDIT_LOGGER_ADDRESS,
    reputationOracleAddress: process.env.REPUTATION_ORACLE_ADDRESS,
    autonomyLevel: 4,
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterModel: process.env.OPENROUTER_MODEL,
    lighthouseApiKey: process.env.LIGHTHOUSE_API_KEY,
    lighthouseGatewayUrl: process.env.LIGHTHOUSE_GATEWAY_URL,
    litNetwork: process.env.LIT_NETWORK,
    filecoinStorageProvider: process.env.FILECOIN_STORAGE_PROVIDER as any,
    orchestratorServiceUrl: process.env.ORCHESTRATOR_SERVICE_URL,
    specialistServiceUrl: process.env.SPECIALIST_SERVICE_URL,
    vendorServiceUrls: (process.env.VENDOR_SERVICE_URLS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    internalServiceApiKey: process.env.INTERNAL_SERVICE_API_KEY,
    impulseApiKey: process.env.IMPULSE_API_KEY,
    impulseDeploymentId: process.env.IMPULSE_DEPLOYMENT_ID,
    publicApiUrl: process.env.PUBLIC_API_URL,
    publicDashboardUrl: process.env.PUBLIC_DASHBOARD_URL,
  });

  await runtime.awaitReady();

  for (const mission of MISSIONS) {
    await runtime.runMission(mission);
  }

  const snapshot = runtime.getSnapshot();

  console.log(
    JSON.stringify(
      {
        metrics: snapshot.metrics,
        agents: snapshot.agents.map((agent) => ({
          key: agent.key,
          status: agent.status,
          taskCount: agent.taskCount,
          reputationScore: agent.reputationScore,
          onchainAgentId: agent.onchain?.agentId,
        })),
        latestTasks: snapshot.tasks.slice(0, 2).map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          winnerAgentKey: task.winnerAgentKey,
          finalPriceWei: task.finalPriceWei,
          settlement: task.settlement,
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
