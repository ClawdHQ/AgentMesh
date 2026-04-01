import lighthouse from '@lighthouse-web3/sdk';

export interface StoredArtifact {
  cid: string;
  gatewayUrl: string;
}

export class FilecoinVault {
  constructor(
    private readonly apiKey?: string,
    private readonly gatewayBaseUrl: string = 'https://gateway.lighthouse.storage/ipfs/'
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async storeText(name: string, contents: string): Promise<StoredArtifact> {
    if (!this.apiKey) {
      throw new Error('LIGHTHOUSE_API_KEY is required for Filecoin storage');
    }

    const response = await lighthouse.uploadText(contents, this.apiKey, name);
    const cid = String(response.data.Hash ?? response.data.cid ?? '');

    if (!cid) {
      throw new Error('Lighthouse upload did not return a CID');
    }

    return {
      cid,
      gatewayUrl: `${this.gatewayBaseUrl}${cid}`,
    };
  }

  async storeJson(name: string, payload: unknown): Promise<StoredArtifact> {
    return this.storeText(name, JSON.stringify(payload, null, 2));
  }
}
