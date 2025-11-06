import { createHash } from 'crypto';

export function calculateBlockHash(height: number, txIds: string[]): string {
  const data = height.toString() + txIds.join('');
  return createHash('sha256').update(data).digest('hex');
}

