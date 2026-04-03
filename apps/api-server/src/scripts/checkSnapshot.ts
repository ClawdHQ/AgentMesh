import dotenv from 'dotenv';
import path from 'path';
import { StructuredAutonomousSystem } from '../mesh/runtime';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

async function main() {
  const chainId = Number(process.env.CHAIN_ID ?? '11155111');

  const runtime = new StructuredAutonomousSystem({
    apiLabel: chainId === 11155111 ? 'Ethereum Sepolia' : `Chain ${chainId}`,
    chainId,
    rpcUrl: process.env.SEPOLIA_RPC_URL,
    privateKey: process.env.PRIVATE_KEY,
    registryAddress: process.env.AGENT_REGISTRY_ADDRESS,
    taskEscrowAddress: process.env.TASK_ESCROW_ADDRESS,
    auditLoggerAddress: process.env.AUDIT_LOGGER_ADDRESS,
    reputationOracleAddress: process.env.REPUTATION_ORACLE_ADDRESS,
    autonomyLevel: Number(process.env.AUTONOMY_LEVEL ?? '4'),
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
  const snapshot = runtime.getSnapshot();

  console.log(
    JSON.stringify(
      {
        ready: snapshot.ready,
        blockers: snapshot.blockers,
        metrics: snapshot.metrics,
        agents: snapshot.agents.map((agent) => ({
          key: agent.key,
          status: agent.status,
          agentId: agent.onchain?.agentId,
          taskCount: agent.taskCount,
          reputationScore: agent.reputationScore,
        })),
        latestTask: snapshot.tasks[0] ?? null,
        latestPayment: snapshot.payments[0] ?? null,
        latestAudit: snapshot.audit[0] ?? null,
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
