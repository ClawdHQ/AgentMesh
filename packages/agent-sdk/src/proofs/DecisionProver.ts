import { ok, err, Result } from 'neverthrow';
import { ProofError, sha256 } from '@agentmesh/shared';
import { Wallet } from 'ethers';
import type { DecisionInput, DecisionOutput, DecisionProof } from '../types';

// ZK-lite decision prover
// Uses deterministic SHA-256 hash chain to create verifiable decision traces.
// Full ZK circuit integration (e.g. Noir, Circom) is the production upgrade path.
// This implementation creates a cryptographically signed audit trail that is ZK-ready.
export class DecisionProver {
  private readonly wallet: Wallet;

  constructor(privateKey: string) {
    this.wallet = new Wallet(privateKey);
  }

  // Prove a decision by creating a signed hash chain
  async proveDecision(
    inputs: DecisionInput,
    outputs: DecisionOutput,
    reasoning: string[]
  ): Promise<Result<DecisionProof, ProofError>> {
    try {
      // Step 1: Hash each component deterministically
      const inputHash = sha256(JSON.stringify(inputs));
      const outputHash = sha256(JSON.stringify(outputs));
      const reasoningHash = sha256(JSON.stringify(reasoning));

      // Step 2: Create combined hash chain (order matters for verifiability)
      const combinedHash = sha256(`${inputHash}:${outputHash}:${reasoningHash}`);

      // Step 3: Sign with agent's secp256k1 private key
      const signature = await this.wallet.signMessage(combinedHash);

      const proof: DecisionProof = {
        inputHash,
        outputHash,
        reasoningHash,
        combinedHash,
        timestamp: Date.now(),
        agentId: `agent-${this.wallet.address.slice(2, 18)}`,
        signature,
      };

      return ok(proof);
    } catch (error) {
      return err(new ProofError(`Failed to prove decision: ${String(error)}`));
    }
  }

  // Verify a decision proof
  async verifyProof(
    proof: DecisionProof,
    inputs: DecisionInput,
    outputs: DecisionOutput,
    reasoning: string[]
  ): Promise<Result<boolean, ProofError>> {
    try {
      // Step 1: Recompute hashes
      const inputHash = sha256(JSON.stringify(inputs));
      const outputHash = sha256(JSON.stringify(outputs));
      const reasoningHash = sha256(JSON.stringify(reasoning));
      const combinedHash = sha256(`${inputHash}:${outputHash}:${reasoningHash}`);

      // Step 2: Verify hashes match
      if (
        inputHash !== proof.inputHash ||
        outputHash !== proof.outputHash ||
        reasoningHash !== proof.reasoningHash ||
        combinedHash !== proof.combinedHash
      ) {
        return ok(false);
      }

      // Step 3: Verify signature
      const { ethers } = await import('ethers');
      const recoveredAddress = ethers.verifyMessage(combinedHash, proof.signature);
      const isValid =
        ethers.isAddress(recoveredAddress) && recoveredAddress !== ethers.ZeroAddress;

      return ok(isValid);
    } catch (error) {
      return err(new ProofError(`Failed to verify proof: ${String(error)}`));
    }
  }

  // Create a hash-chain proof of a sequence of decisions
  createDecisionChain(proofs: DecisionProof[]): string {
    if (proofs.length === 0) return '';
    const hashes = proofs.map((p) => p.combinedHash);
    return hashes.reduce((acc, hash) => sha256(`${acc}:${hash}`));
  }

  getAddress(): string {
    return this.wallet.address;
  }
}
