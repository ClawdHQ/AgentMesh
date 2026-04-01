import { LitNodeClient } from '@lit-protocol/lit-node-client';
import { encryptToJson } from '@lit-protocol/encryption';

export interface EncryptedArtifact {
  payload: string;
  accessControlConditions: unknown[];
}

export class LitAccessController {
  private client?: LitNodeClient;
  private connected = false;

  constructor(
    private readonly litNetwork: string = 'datil-dev',
    private readonly chain: string = 'ethereum'
  ) {}

  async encryptJson(data: unknown, allowedAddresses: string[]): Promise<EncryptedArtifact> {
    const litNodeClient = await this.getClient();
    const accessControlConditions = buildAddressConditions(allowedAddresses, this.chain);

    const payload = await encryptToJson({
      chain: this.chain,
      string: JSON.stringify(data),
      litNodeClient,
      accessControlConditions: accessControlConditions as any,
    });

    return {
      payload,
      accessControlConditions,
    };
  }

  private async getClient(): Promise<LitNodeClient> {
    if (!this.client) {
      this.client = new LitNodeClient({
        litNetwork: this.litNetwork as any,
        debug: false,
      });
    }

    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }

    return this.client;
  }
}

function buildAddressConditions(addresses: string[], chain: string) {
  return addresses.reduce<any[]>((conditions, address, index) => {
    if (index > 0) {
      conditions.push({ operator: 'or' });
    }

    conditions.push({
      contractAddress: '',
      standardContractType: '',
      chain,
      method: '',
      parameters: [':userAddress'],
      returnValueTest: {
        comparator: '=',
        value: address,
      },
    });

    return conditions;
  }, []);
}
