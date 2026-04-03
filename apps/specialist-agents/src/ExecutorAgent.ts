import pino from 'pino';
import { BaseAgent } from '@agentmesh/agent-sdk';
import type { AgentCapability, AgentTask, TaskResult } from '@agentmesh/agent-sdk';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';

const agentRegistryAbi = [
  'function updateReputation(uint256 agentId,bool success,uint256 paymentAmount) external',
  'function getAgent(uint256 agentId) external view returns (tuple(address owner,address operatorWallet,string agentURI,uint256 reputationScore,uint256 taskCount,uint256 successCount,bool active,uint256 registeredAt))',
];

const reputationOracleAbi = [
  'function recordReputation(uint256 agentId,uint256 score,uint256 taskCount,uint256 successCount) external',
];

export class ExecutorAgent extends BaseAgent {
  private executorLogger = pino({ level: 'info', name: 'ExecutorAgent' });
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private registry?: Contract;
  private reputationOracle?: Contract;

  constructor(config: ConstructorParameters<typeof BaseAgent>[0] & { reputationOracleAddress?: string }) {
    super(config);
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);

    if (config.agentRegistryAddress) {
      this.registry = new Contract(config.agentRegistryAddress, agentRegistryAbi, this.wallet);
    }
    if (config.reputationOracleAddress) {
      this.reputationOracle = new Contract(
        config.reputationOracleAddress,
        reputationOracleAbi,
        this.wallet
      );
    }
  }

  getCapabilities(): AgentCapability[] {
    return [
      { name: 'sign_transaction', description: 'Sign an AgentMesh settlement attestation' },
      { name: 'submit_payment', description: 'Submit a native ETH payment transaction' },
      { name: 'update_registry', description: 'Update onchain reputation for a registered agent' },
    ];
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.executorLogger.info({ taskId: task.taskId, type: task.type }, 'ExecutorAgent handling task');

    try {
      let result: unknown;
      switch (task.type) {
        case 'sign_transaction':
          result = await this.signTransaction(task.payload);
          break;
        case 'submit_payment':
          result = await this.submitPayment(task.payload);
          break;
        case 'update_registry':
          result = await this.updateRegistry(task.payload);
          break;
        default:
          return {
            taskId: task.taskId,
            success: false,
            error: `Unknown task type: ${task.type}`,
            completedAt: Date.now(),
          };
      }

      return {
        taskId: task.taskId,
        success: true,
        data: { result },
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        taskId: task.taskId,
        success: false,
        error: String(error),
        completedAt: Date.now(),
      };
    }
  }

  private async signTransaction(payload: Record<string, unknown>) {
    const message = JSON.stringify({
      agent: this.identity.agentId,
      payload,
      timestamp: Date.now(),
    });
    const signature = await this.wallet.signMessage(message);

    return {
      signed: true,
      signature,
      signer: this.identity.address,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  private async submitPayment(payload: Record<string, unknown>) {
    const to = typeof payload.to === 'string' ? payload.to : undefined;
    const valueWei = typeof payload.valueWei === 'string' ? payload.valueWei : undefined;
    if (!to || !valueWei) {
      throw new Error('submit_payment requires to and valueWei');
    }

    const tx = await this.wallet.sendTransaction({
      to,
      value: BigInt(valueWei),
      data: typeof payload.data === 'string' ? payload.data : undefined,
    });
    const receipt = await tx.wait();

    return {
      txHash: tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
      blockNumber: receipt?.blockNumber,
      timestamp: new Date().toISOString(),
    };
  }

  private async updateRegistry(payload: Record<string, unknown>) {
    if (!this.registry) {
      throw new Error('AGENT_REGISTRY_ADDRESS is required for update_registry');
    }

    const agentId = BigInt(String(payload.agentId));
    const success = Boolean(payload.success);
    const paymentAmountWei = BigInt(String(payload.paymentAmountWei ?? '0'));

    const tx = await this.registry.updateReputation(agentId, success, paymentAmountWei);
    await tx.wait();

    if (this.reputationOracle) {
      const agent = await this.registry.getAgent(agentId);
      const oracleTx = await this.reputationOracle.recordReputation(
        agentId,
        agent.reputationScore,
        agent.taskCount,
        agent.successCount
      );
      await oracleTx.wait();
    }

    return {
      updated: true,
      agentId: agentId.toString(),
      success,
      txHash: tx.hash,
      timestamp: new Date().toISOString(),
    };
  }
}
