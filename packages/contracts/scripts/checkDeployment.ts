import { ethers } from 'hardhat';

async function assertContractCode(address: string, label: string) {
  const code = await ethers.provider.getCode(address);
  if (code === '0x') {
    throw new Error(`${label} has no code at ${address}`);
  }
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const expectedChainId = 11155111;

  if (chainId !== expectedChainId) {
    throw new Error(`Expected chain ${expectedChainId}, received ${chainId}`);
  }

  const registryAddress = process.env.AGENT_REGISTRY_ADDRESS;
  const taskEscrowAddress = process.env.TASK_ESCROW_ADDRESS;
  const reputationOracleAddress = process.env.REPUTATION_ORACLE_ADDRESS;
  const auditLoggerAddress = process.env.AUDIT_LOGGER_ADDRESS;

  if (!registryAddress || !taskEscrowAddress || !reputationOracleAddress || !auditLoggerAddress) {
    throw new Error('Deployment env vars are missing one or more contract addresses');
  }

  await assertContractCode(registryAddress, 'AgentRegistry');
  await assertContractCode(taskEscrowAddress, 'TaskEscrow');
  await assertContractCode(reputationOracleAddress, 'ReputationOracle');
  await assertContractCode(auditLoggerAddress, 'AuditLogger');

  const registry = await ethers.getContractAt(
    [
      'function owner() external view returns (address)',
      'function name() external view returns (string)',
      'function symbol() external view returns (string)',
      'function getAgentsByOwner(address ownerAddr) external view returns (uint256[])',
    ],
    registryAddress
  );
  const taskEscrow = await ethers.getContractAt(
    [
      'function owner() external view returns (address)',
      'function agentRegistry() external view returns (address)',
    ],
    taskEscrowAddress
  );
  const reputationOracle = await ethers.getContractAt(
    [
      'function owner() external view returns (address)',
      'function getTrackedAgents() external view returns (uint256[])',
    ],
    reputationOracleAddress
  );
  const auditLogger = await ethers.getContractAt(
    [
      'function owner() external view returns (address)',
      'function totalDecisions() external view returns (uint256)',
    ],
    auditLoggerAddress
  );

  const [registryOwner, registryName, registrySymbol, taskEscrowOwner, linkedRegistry, oracleOwner, trackedAgents, loggerOwner, totalDecisions] =
    await Promise.all([
      registry.owner(),
      registry.name(),
      registry.symbol(),
      taskEscrow.owner(),
      taskEscrow.agentRegistry(),
      reputationOracle.owner(),
      reputationOracle.getTrackedAgents(),
      auditLogger.owner(),
      auditLogger.totalDecisions(),
    ]);

  const [signer] = await ethers.getSigners();
  const ownedAgents = await registry.getAgentsByOwner(signer.address);

  console.log('Deployment check passed');
  console.log(`Chain ID: ${chainId}`);
  console.log(`AgentRegistry: ${registryAddress} (${registryName}/${registrySymbol}) owner=${registryOwner}`);
  console.log(`TaskEscrow: ${taskEscrowAddress} owner=${taskEscrowOwner} registry=${linkedRegistry}`);
  console.log(`ReputationOracle: ${reputationOracleAddress} owner=${oracleOwner} trackedAgents=${trackedAgents.length}`);
  console.log(`AuditLogger: ${auditLoggerAddress} owner=${loggerOwner} totalDecisions=${totalDecisions}`);
  console.log(`Deployer-owned agent identities: ${ownedAgents.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
