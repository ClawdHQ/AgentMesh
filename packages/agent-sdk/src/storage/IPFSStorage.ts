import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import lighthouse from '@lighthouse-web3/sdk';
import { ok, err, Result } from 'neverthrow';
import { StorageError } from '@agentmesh/shared';
import type { AgentMemory } from '../types';
import type { ArtifactReference, StorageProvider } from '@agentmesh/shared';

const execFileAsync = promisify(execFile);

export class IPFSStorage {
  private readonly cache: Map<string, unknown> = new Map();
  private isConnected = false;
  private readonly provider: StorageProvider;
  private readonly lighthouseApiKey?: string;
  private readonly gatewayBaseUrl: string;
  private readonly filecoinPinCommand: string;
  private readonly filecoinPinGatewayUrl: string;

  constructor(
    private readonly email?: string,
    private readonly spaceDid?: string,
    options: {
      provider?: StorageProvider;
      lighthouseApiKey?: string;
      gatewayBaseUrl?: string;
      filecoinPinCommand?: string;
      filecoinPinGatewayUrl?: string;
    } = {}
  ) {
    this.provider =
      options.provider ??
      ((process.env.FILECOIN_STORAGE_PROVIDER as StorageProvider | undefined) || 'lighthouse');
    this.lighthouseApiKey = options.lighthouseApiKey ?? process.env.LIGHTHOUSE_API_KEY;
    this.gatewayBaseUrl =
      options.gatewayBaseUrl ??
      process.env.LIGHTHOUSE_GATEWAY_URL ??
      'https://gateway.lighthouse.storage/ipfs/';
    this.filecoinPinCommand =
      options.filecoinPinCommand ?? process.env.FILECOIN_PIN_COMMAND ?? resolveFilecoinPinCommand();
    this.filecoinPinGatewayUrl =
      options.filecoinPinGatewayUrl ??
      process.env.FILECOIN_PIN_GATEWAY_URL ??
      'https://ipfs.io/ipfs/';
  }

  async connect(): Promise<Result<void, StorageError>> {
    try {
      if (this.provider === 'lighthouse' && !this.lighthouseApiKey) {
        return err(new StorageError('LIGHTHOUSE_API_KEY is required for Lighthouse storage'));
      }
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
      const artifact =
        this.provider === 'filecoin-pin'
          ? await this.storeWithFilecoinPin(json)
          : await this.storeWithLighthouse(json);
      const cid = artifact.cid;
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
      const gatewayBase =
        this.provider === 'filecoin-pin' ? this.filecoinPinGatewayUrl : this.gatewayBaseUrl;
      const response = await fetch(`${gatewayBase}${cid}`);
      if (!response.ok) {
        return err(new StorageError(`Failed to retrieve from IPFS: ${response.status}`));
      }
      const text = await response.text();
      const data = JSON.parse(text) as unknown;
      this.cache.set(cid, data);
      return ok(data);
    } catch (error) {
      return err(new StorageError(`Failed to retrieve data: ${String(error)}`));
    }
  }

  // Store agent memory
  async storeMemory(agentId: string, memory: AgentMemory): Promise<Result<string, StorageError>> {
    // Remove agentId from memory to avoid duplicate property
    const { agentId: _removed, ...rest } = memory;
    return this.store({
      '@type': 'AgentMemory',
      agentId,
      ...rest,
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

  private async storeWithLighthouse(contents: string): Promise<ArtifactReference> {
    if (!this.lighthouseApiKey) {
      throw new StorageError('LIGHTHOUSE_API_KEY is required for Lighthouse storage');
    }

    const response = await lighthouse.uploadText(
      contents,
      this.lighthouseApiKey,
      `agentmesh-${Date.now()}.json`
    );
    const cid = String(response.data.Hash ?? response.data.cid ?? '');

    if (!cid) {
      throw new StorageError('Lighthouse upload did not return a CID');
    }

    return {
      cid,
      uri: `ipfs://${cid}`,
      gatewayUrl: `${this.gatewayBaseUrl}${cid}`,
      provider: 'lighthouse',
      network: 'ipfs',
      createdAt: new Date().toISOString(),
      contentType: 'application/json',
      sizeBytes: Buffer.byteLength(contents),
    };
  }

  private async storeWithFilecoinPin(contents: string): Promise<ArtifactReference> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentmesh-filecoin-pin-'));
    const filePath = path.join(tmpDir, 'artifact.json');

    try {
      await writeFile(filePath, contents, 'utf8');
      const { stdout } = await execFileAsync(this.filecoinPinCommand, ['add', filePath, '--auto-fund'], {
        env: process.env,
      });

      const cid = matchCliValue(stdout, /Root CID:\s*([A-Za-z0-9]+)/i);
      if (!cid) {
        throw new StorageError('Filecoin Pin upload did not return a Root CID');
      }

      return {
        cid,
        uri: `ipfs://${cid}`,
        gatewayUrl: `${this.filecoinPinGatewayUrl}${cid}`,
        provider: 'filecoin-pin',
        network: 'filecoin-calibration',
        createdAt: new Date().toISOString(),
        contentType: 'application/json',
        sizeBytes: Buffer.byteLength(contents),
        pieceCid: matchCliValue(stdout, /Piece CID:\s*([A-Za-z0-9]+)/i),
        proofTxHash: matchCliValue(stdout, /Transaction:\s*(0x[a-fA-F0-9]+)/i),
        dataSetId: matchCliValue(stdout, /Data Set ID:\s*([0-9]+)/i),
      };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

function matchCliValue(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match?.[1];
}

function resolveFilecoinPinCommand(): string {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules/.bin/filecoin-pin'),
    path.resolve(__dirname, '../../../../node_modules/.bin/filecoin-pin'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'filecoin-pin';
}
