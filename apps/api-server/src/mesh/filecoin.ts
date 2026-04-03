import { IPFSStorage } from '@agentmesh/agent-sdk';
import type { ArtifactReference, StorageProvider } from '@agentmesh/shared';

export interface StoredArtifact extends ArtifactReference {}

export class FilecoinVault {
  private readonly storage: IPFSStorage;
  private readonly provider: StorageProvider;

  constructor(
    provider?: StorageProvider,
    lighthouseApiKey?: string,
    gatewayBaseUrl?: string
  ) {
    this.provider =
      provider ?? ((process.env.FILECOIN_STORAGE_PROVIDER as StorageProvider | undefined) || 'lighthouse');
    this.storage = new IPFSStorage(undefined, undefined, {
      provider: this.provider,
      lighthouseApiKey,
      gatewayBaseUrl,
    });
  }

  async connect(): Promise<void> {
    const result = await this.storage.connect();
    if (result.isErr()) {
      throw result.error;
    }
  }

  isConfigured(): boolean {
    return this.storage.isReady() || this.provider === 'filecoin-pin' || Boolean(process.env.LIGHTHOUSE_API_KEY);
  }

  getProvider(): StorageProvider {
    return this.provider;
  }

  async storeText(name: string, contents: string): Promise<StoredArtifact> {
    const payload = {
      name,
      contents,
    };
    return this.storeJson(name, payload);
  }

  async storeJson(name: string, payload: unknown): Promise<StoredArtifact> {
    const storeResult = await this.storage.store({
      name,
      payload,
    });

    if (storeResult.isErr()) {
      throw storeResult.error;
    }

    const cid = storeResult.value;
    const gatewayBase =
      this.provider === 'filecoin-pin'
        ? process.env.FILECOIN_PIN_GATEWAY_URL ?? 'https://ipfs.io/ipfs/'
        : process.env.LIGHTHOUSE_GATEWAY_URL ?? 'https://gateway.lighthouse.storage/ipfs/';

    return {
      cid,
      uri: `ipfs://${cid}`,
      gatewayUrl: `${gatewayBase}${cid}`,
      provider: this.provider,
      network: this.provider === 'filecoin-pin' ? 'filecoin-calibration' : 'ipfs',
      createdAt: new Date().toISOString(),
      contentType: 'application/json',
    };
  }
}
