import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying AgentMesh contracts with account:', deployer.address);

  const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
  const agentRegistry = await AgentRegistry.deploy(deployer.address);
  await agentRegistry.waitForDeployment();
  console.log('AgentRegistry deployed to:', await agentRegistry.getAddress());

  const TaskEscrow = await ethers.getContractFactory('TaskEscrow');
  const taskEscrow = await TaskEscrow.deploy(deployer.address);
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

  console.log('\nDeployment complete!');
  console.log('Update .env with:');
  console.log(`AGENT_REGISTRY_ADDRESS=${await agentRegistry.getAddress()}`);
  console.log(`TASK_ESCROW_ADDRESS=${await taskEscrow.getAddress()}`);
  console.log(`REPUTATION_ORACLE_ADDRESS=${await reputationOracle.getAddress()}`);
  console.log(`AUDIT_LOGGER_ADDRESS=${await auditLogger.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
