import { ok, err, Result } from 'neverthrow';
import { StorageError } from '@agentmesh/shared';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class FilecoinClient {
  constructor(
    private readonly rpcUrl?: string,
    private readonly filecoinPinCommand: string = process.env.FILECOIN_PIN_COMMAND ?? 'filecoin-pin'
  ) {}

  async makeDeal(cid: string, durationDays: number = 365): Promise<Result<string, StorageError>> {
    try {
      const { stdout } = await execFileAsync(
        this.filecoinPinCommand,
        ['proofs', 'cid', cid, '--duration-days', String(durationDays)],
        { env: process.env }
      );
      return ok(stdout.trim());
    } catch (error) {
      return err(new StorageError(`Failed to make Filecoin deal: ${String(error)}`));
    }
  }

  async getDealStatus(cid: string): Promise<Result<string, StorageError>> {
    try {
      const { stdout } = await execFileAsync(this.filecoinPinCommand, ['data-set', '--cid', cid], {
        env: process.env,
      });
      return ok(stdout.trim());
    } catch (error) {
      return err(new StorageError(`Failed to inspect Filecoin deal status: ${String(error)}`));
    }
  }

  listDeals(): Array<{ cid: string; dealId: string; status: string }> {
    return [];
  }
}
