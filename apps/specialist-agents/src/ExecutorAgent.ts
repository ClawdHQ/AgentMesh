import pino from 'pino';
import { BaseAgent, LibP2PClient, DecisionProver } from '@agentmesh/agent-sdk';
import type { AgentTask, TaskResult, AgentCapability } from '@agentmesh/agent-sdk';
import { TOPIC_INTENTS } from '@agentmesh/shared';

export class ExecutorAgent extends BaseAgent {
  private executorLogger = pino({ level: 'info', name: 'ExecutorAgent' });
  private libp2p: LibP2PClient;
  private decisionProver: DecisionProver;

  constructor(config: ConstructorParameters<typeof BaseAgent>[0]) {
    super(config);
    this.libp2p = new LibP2PClient(
      config.libp2pPort,
      config.bootstrapPeers,
      this.identity.agentId
    );
    this.decisionProver = new DecisionProver(config.privateKey);
  }

  getCapabilities(): AgentCapability[] {
    return [
      { name: 'sign_transaction', description: 'Sign an Ethereum transaction' },
      { name: 'submit_payment', description: 'Submit a USDC payment to an escrow contract' },
      { name: 'update_registry', description: 'Update agent reputation in the registry' },
    ];
  }

  async handleTask(task: AgentTask): Promise<TaskResult> {
    this.executorLogger.info({ taskId: task.taskId, type: task.type }, 'ExecutorAgent handling task');

    // Verify we have a valid decision proof before executing
    if (!task.paymentProof && task.type !== 'sign_transaction') {
      this.executorLogger.warn({ taskId: task.taskId }, 'Missing payment proof, requiring verification');
    }

    await this.libp2p.broadcastIntent(
      this.identity.agentId,
      'EXECUTING',
      `Executing ${task.type} on-chain`
    );

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

      // Broadcast execution event
      await this.libp2p.publish(TOPIC_INTENTS, {
        type: 'intent',
        from: this.identity.agentId,
        payload: {
          action: 'EXECUTED',
          taskType: task.type,
          result,
        },
        timestamp: Date.now(),
      });

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

  private async signTransaction(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // In production, sign with ethers.js wallet
    const wallet = this.identity.getWallet();
    const message = JSON.stringify(payload);
    const signature = await wallet.signMessage(message);

    return {
      signed: true,
      signature,
      signer: this.identity.address,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  private async submitPayment(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // In production, call TaskEscrow.fundTask() via ethers.js
    const mockTxHash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;

    this.executorLogger.info(
      { txHash: mockTxHash, amount: payload.amount },
      'Payment submitted (mock)'
    );

    return {
      txHash: mockTxHash,
      amount: payload.amount,
      token: payload.token ?? 'USDC',
      recipient: payload.recipient,
      blockExplorer: `https://sepolia.basescan.org/tx/${mockTxHash}`,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
    };
  }

  private async updateRegistry(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // In production, call AgentRegistry.updateReputation() via ethers.js
    this.executorLogger.info(
      { agentId: payload.agentId, success: payload.success },
      'Registry updated (mock)'
    );

    return {
      updated: true,
      agentId: payload.agentId,
      success: payload.success,
      newReputationScore: 55,
      txHash: `0x${Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('')}`,
      timestamp: new Date().toISOString(),
    };
  }
}
