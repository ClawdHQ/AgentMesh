import { createHash } from 'crypto';

// Hashing utilities
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// Creates a deterministic hash of a JSON-serializable object
// Recursively sorts all keys for consistent serialization
export function hashObject(obj: unknown): string {
  const sortedJson = deterministicStringify(obj);
  return sha256(sortedJson);
}

function deterministicStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(deterministicStringify).join(',') + ']';
  }
  const sorted = Object.keys(val as Record<string, unknown>)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + deterministicStringify((val as Record<string, unknown>)[k]))
    .join(',');
  return '{' + sorted + '}';
}

// Timestamp utilities
export function nowMs(): number {
  return Date.now();
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isoNow(): string {
  return new Date().toISOString();
}

// Delay utility
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry utility with exponential backoff
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

// Truncate a string to a maximum length
export function truncate(str: string, maxLength: number = 100): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

// Format USDC amount (6 decimals) to human-readable
export function formatUSDC(amount: bigint): string {
  const whole = amount / BigInt(1_000_000);
  const fraction = amount % BigInt(1_000_000);
  const fractionStr = fraction.toString().padStart(6, '0').slice(0, 2);
  return `${whole}.${fractionStr} USDC`;
}

// Parse human-readable USDC to bigint (6 decimals)
export function parseUSDC(amount: string): bigint {
  const [whole, fraction = ''] = amount.replace(' USDC', '').split('.');
  const fractionPadded = (fraction + '000000').slice(0, 6);
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fractionPadded);
}

// Generate a random nonce
export function generateNonce(): string {
  return sha256(`${Date.now()}-${Math.random()}`);
}

// Safe JSON parse
export function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// Check if a string is a valid Ethereum address
export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

// Check if a string is a valid CID (simplified check)
export function isValidCID(cid: string): boolean {
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})/.test(cid);
}

// Build a score for vendor ranking: reputation * 0.4 + price_score * 0.4 + success_rate * 0.2
export function scoreVendor(
  reputationScore: number,
  priceScore: number,
  successRate: number
): number {
  return reputationScore * 0.4 + priceScore * 0.4 + successRate * 0.2;
}
