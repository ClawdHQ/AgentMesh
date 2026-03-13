import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const AgentMeshModule = buildModule('AgentMeshModule', (m) => {
  const deployer = m.getAccount(0);

  const agentRegistry = m.contract('AgentRegistry', [deployer]);
  const taskEscrow = m.contract('TaskEscrow', [deployer]);
  const reputationOracle = m.contract('ReputationOracle', [deployer]);
  const auditLogger = m.contract('AuditLogger', [deployer]);

  return {
    agentRegistry,
    taskEscrow,
    reputationOracle,
    auditLogger,
  };
});

export default AgentMeshModule;
