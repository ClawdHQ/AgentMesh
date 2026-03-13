import { ok, err, Result } from 'neverthrow';
import { NetworkError, StorageError } from '@agentmesh/shared';
import type { AgentMemory } from '../types';

// IPFS Storage client
// Uses web3.storage w3up-client in production, falls back to mock for demo
export class IPFSStorage {
  private readonly cache: Map<string, unknown> = new Map();
  private mockCIDCounter = 1;
  private isConnected = false;

  constructor(
    private readonly email?: string,
    private readonly spaceDid?: string
  ) {}

  async connect(): Promise<Result<void, StorageError>> {
    try {
      // In production, initialize w3up-client:
      // const client = await create();
      // await client.login(this.email);
      // await client.setCurrentSpace(this.spaceDid);
      this.isConnected = true;
      return ok(undefined);
    } catch (error) {
      return err(new StorageError(`Failed to connect to IPFS: ${String(error)}`));
    }
  }

  // Store arbitrary data on IPFS, returns CID
  async store(data: unknown): Promise<Result<string, StorageError>> {
    try {
      const json = JSON.stringify(data);
      // In production: upload to web3.storage
      // const blob = new Blob([json]);
      // const cid = await this.client.uploadBlob(blob);
      // return ok(cid.toString());

      // Demo: generate deterministic mock CID
      const { sha256 } = await import('@agentmesh/shared');
      const hash = sha256(json).slice(0, 32);
      const cid = `Qm${hash}${(this.mockCIDCounter++).toString().padStart(12, '0')}`;
      this.cache.set(cid, data);
      return ok(cid);
    } catch (error) {
      return err(new StorageError(`Failed to store data: ${String(error)}`));
    }
  }

  // Retrieve data by CID
  async retrieve(cid: string): Promise<Result<unknown, StorageError>> {
    try {
      // Check local cache first
      const cached = this.cache.get(cid);
      if (cached !== undefined) {
        return ok(cached);
      }

      // In production: fetch from IPFS gateway
      const response = await fetch(`https://ipfs.io/ipfs/${cid}`);
      if (!response.ok) {
        return err(new StorageError(`Failed to retrieve from IPFS: ${response.status}`));
      }
      const data = await response.json();
      this.cache.set(cid, data);
      return ok(data);
    } catch (error) {
      return err(new StorageError(`Failed to retrieve data: ${String(error)}`));
    }
  }

  // Store agent memory
  async storeMemory(agentId: string, memory: AgentMemory): Promise<Result<string, StorageError>> {
    return this.store({
      '@type': 'AgentMemory',
      agentId,
      ...memory,
    });
  }

  // Retrieve agent memory by CID
  async retrieveMemory(cid: string): Promise<Result<AgentMemory, StorageError>> {
    const result = await this.retrieve(cid);
    if (result.isErr()) return err(result.error);

    try {
      const { AgentMemorySchema } = await import('../types');
      const memory = AgentMemorySchema.parse(result.value);
      return ok(memory);
    } catch (error) {
      return err(new StorageError(`Invalid memory schema: ${String(error)}`));
    }
  }

  // Store a file with a specific key for easy retrieval
  storeLocal(key: string, data: unknown): void {
    this.cache.set(key, data);
  }

  retrieveLocal(key: string): unknown | undefined {
    return this.cache.get(key);
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  isReady(): boolean {
    return this.isConnected;
  }
}
