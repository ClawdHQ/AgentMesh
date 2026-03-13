import { Wallet } from 'ethers';
import { hashObject, sha256 } from '@agentmesh/shared';
import type { AgentConfig, AgentIdentity } from '../types';

export class AgentIdentityManager {
  private readonly wallet: Wallet;
  private onChainId?: number;
  private agentCardCID?: string;

  constructor(private readonly config: AgentConfig) {
    this.wallet = new Wallet(config.privateKey);
  }

  get address(): string {
    return this.wallet.address;
  }

  get publicKey(): string {
    return this.wallet.signingKey.publicKey;
  }

  get agentId(): string {
    return `agent-${sha256(this.wallet.address + this.config.name).slice(0, 16)}`;
  }

  setOnChainId(id: number): void {
    this.onChainId = id;
  }

  setAgentCardCID(cid: string): void {
    this.agentCardCID = cid;
  }

  getIdentity(): AgentIdentity {
    return {
      agentId: this.agentId,
      onChainId: this.onChainId,
      address: this.address,
      publicKey: this.publicKey,
      agentCardCID: this.agentCardCID,
    };
  }

  async sign(data: unknown): Promise<string> {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    return this.wallet.signMessage(message);
  }

  async signHash(hash: string): Promise<string> {
    return this.wallet.signMessage(hash);
  }

  getWallet(): Wallet {
    return this.wallet;
  }

  async verifySignature(data: unknown, signature: string): Promise<string> {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    const { ethers } = await import('ethers');
    return ethers.verifyMessage(message, signature);
  }

  createMessageHash(data: unknown): string {
    return hashObject(data);
  }
}
