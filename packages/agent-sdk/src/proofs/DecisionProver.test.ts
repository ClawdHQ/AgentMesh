import { describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { DecisionProver } from './DecisionProver';

describe('DecisionProver', () => {
  it('creates a verifiable proof for deterministic inputs and outputs', async () => {
    const wallet = Wallet.createRandom();
    const prover = new DecisionProver(wallet.privateKey);

    const inputs = {
      taskId: 'task-123',
      inputs: { objective: 'rank vendors', budgetWei: '10000000000000000' },
      timestamp: Date.now(),
    };
    const outputs = {
      taskId: 'task-123',
      outputs: { winner: 'vendor-beta', score: 0.91 },
      reasoning: ['normalized bids', 'weighted price and reputation'],
      timestamp: Date.now(),
    };
    const reasoning = ['normalized bids', 'selected highest trust-adjusted score'];

    const proofResult = await prover.proveDecision(inputs, outputs, reasoning);
    expect(proofResult.isOk()).toBe(true);

    const verifyResult = await prover.verifyProof(
      proofResult._unsafeUnwrap(),
      inputs,
      outputs,
      reasoning
    );
    expect(verifyResult.isOk()).toBe(true);
    expect(verifyResult._unsafeUnwrap()).toBe(true);
  });
});
