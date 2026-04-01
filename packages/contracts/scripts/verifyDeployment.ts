import { ethers, run } from 'hardhat';

function isAlreadyVerified(error: unknown) {
  const message = String(error);
  return (
    message.includes('Already Verified') ||
    message.includes('already verified') ||
    message.includes('Contract source code already verified')
  );
}

async function verifyContract(address: string, constructorArguments: unknown[], label: string) {
  try {
    await run('verify:verify', {
      address,
      constructorArguments,
    });
    console.log(`${label} verified: ${address}`);
  } catch (error) {
    if (isAlreadyVerified(error)) {
      console.log(`${label} already verified: ${address}`);
      return;
    }

    throw error;
  }
}

async function main() {
  if (!process.env.ETHERSCAN_API_KEY) {
    throw new Error('ETHERSCAN_API_KEY is required to verify contracts');
  }

  const registryAddress = process.env.AGENT_REGISTRY_ADDRESS;
  const taskEscrowAddress = process.env.TASK_ESCROW_ADDRESS;
  const reputationOracleAddress = process.env.REPUTATION_ORACLE_ADDRESS;
  const auditLoggerAddress = process.env.AUDIT_LOGGER_ADDRESS;

  if (!registryAddress || !taskEscrowAddress || !reputationOracleAddress || !auditLoggerAddress) {
    throw new Error('Contract addresses are missing from the environment');
  }

  const [deployer] = await ethers.getSigners();
  const owner = deployer.address;

  await verifyContract(registryAddress, [owner], 'AgentRegistry');
  await verifyContract(taskEscrowAddress, [owner, registryAddress], 'TaskEscrow');
  await verifyContract(reputationOracleAddress, [owner], 'ReputationOracle');
  await verifyContract(auditLoggerAddress, [owner], 'AuditLogger');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
