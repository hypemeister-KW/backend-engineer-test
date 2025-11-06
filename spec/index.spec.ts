import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Pool } from 'pg';
import { createHash } from 'crypto';


function calculateBlockHash(height: number, txIds: string[]): string {
  const data = height.toString() + txIds.join('');
  return createHash('sha256').update(data).digest('hex');
}


const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5433/challenge_db'
});

const API_URL = 'http://localhost:3000';

async function postBlock(block: any) {
  const response = await fetch(`${API_URL}/blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(block)
  });
  return { status: response.status, data: await response.json() };
}

async function getBalance(address: string) {
  const response = await fetch(`${API_URL}/balances/${address}`);
  return { status: response.status, data: await response.json() };
}

async function rollback(height: number) {
  const response = await fetch(`${API_URL}/rollback?height=${height}`, {
    method: 'POST'
  });
  return { status: response.status, data: await response.json() };
}


async function clearDatabase() {
  await pool.query('DELETE FROM outputs');
  await pool.query('DELETE FROM transactions');
  await pool.query('DELETE FROM blocks');
  await pool.query('UPDATE state SET current_height = 0');
}

describe('Blockchain Indexer', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  describe('POST /blocks', () => {
    it('should accept valid genesis block', async () => {
      const block = {
        id: calculateBlockHash(1, ['tx1']),
        height: 1,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{
            address: 'addr1',
            value: 100
          }]
        }]
      };

      const result = await postBlock(block);
      expect(result.status).toBe(200);
      expect(result.data.success).toBe(true);


      const balance = await getBalance('addr1');
      expect(balance.data.balance).toBe(100);
    });

    it('should reject block with invalid height', async () => {
      const block = {
        id: calculateBlockHash(5, ['tx1']),
        height: 5,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{ address: 'addr1', value: 100 }]
        }]
      };

      const result = await postBlock(block);
      expect(result.status).toBe(400);
      expect(result.data.error).toContain('Invalid height');
    });

    it('should reject block with invalid hash', async () => {
      const block = {
        id: 'invalid_hash',
        height: 1,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{ address: 'addr1', value: 100 }]
        }]
      };

      const result = await postBlock(block);
      expect(result.status).toBe(400);
      expect(result.data.error).toContain('Invalid block hash');
    });

    it('should reject transaction where input sum != output sum', async () => {

      const genesis = {
        id: calculateBlockHash(1, ['tx1']),
        height: 1,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{ address: 'addr1', value: 100 }]
        }]
      };
      await postBlock(genesis);


      const invalidBlock = {
        id: calculateBlockHash(2, ['tx2']),
        height: 2,
        transactions: [{
          id: 'tx2',
          inputs: [{ txId: 'tx1', index: 0 }],
          outputs: [{ address: 'addr2', value: 50 }]
        }]
      };

      const result = await postBlock(invalidBlock);
      expect(result.status).toBe(400);
      expect(result.data.error).toContain('input sum');
    });

    it('should process valid transaction spending UTXO', async () => {
      const genesis = {
        id: calculateBlockHash(1, ['tx1']),
        height: 1,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{ address: 'addr1', value: 100 }]
        }]
      };
      await postBlock(genesis);

      const block2 = {
        id: calculateBlockHash(2, ['tx2']),
        height: 2,
        transactions: [{
          id: 'tx2',
          inputs: [{ txId: 'tx1', index: 0 }],
          outputs: [
            { address: 'addr2', value: 60 },
            { address: 'addr3', value: 40 }
          ]
        }]
      };
      const result = await postBlock(block2);
      expect(result.status).toBe(200);


      const bal1 = await getBalance('addr1');
      expect(bal1.data.balance).toBe(0);

      const bal2 = await getBalance('addr2');
      expect(bal2.data.balance).toBe(60);

      const bal3 = await getBalance('addr3');
      expect(bal3.data.balance).toBe(40);
    });

    it('should reject double spending', async () => {

      const genesis = {
        id: calculateBlockHash(1, ['tx1']),
        height: 1,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{ address: 'addr1', value: 100 }]
        }]
      };
      await postBlock(genesis);

      const block2 = {
        id: calculateBlockHash(2, ['tx2']),
        height: 2,
        transactions: [{
          id: 'tx2',
          inputs: [{ txId: 'tx1', index: 0 }],
          outputs: [{ address: 'addr2', value: 100 }]
        }]
      };
      await postBlock(block2);

      const block3 = {
        id: calculateBlockHash(3, ['tx3']),
        height: 3,
        transactions: [{
          id: 'tx3',
          inputs: [{ txId: 'tx1', index: 0 }],  // Already spent!
          outputs: [{ address: 'addr3', value: 100 }]
        }]
      };
      const result = await postBlock(block3);
      expect(result.status).toBe(400);
      expect(result.data.error).toContain('already spent');
    });

    it('should handle multiple transactions in one block', async () => {
      const block = {
        id: calculateBlockHash(1, ['tx1', 'tx2']),
        height: 1,
        transactions: [
          {
            id: 'tx1',
            inputs: [],
            outputs: [{ address: 'addr1', value: 100 }]
          },
          {
            id: 'tx2',
            inputs: [],
            outputs: [{ address: 'addr2', value: 200 }]
          }
        ]
      };

      const result = await postBlock(block);
      expect(result.status).toBe(200);

      const bal1 = await getBalance('addr1');
      expect(bal1.data.balance).toBe(100);

      const bal2 = await getBalance('addr2');
      expect(bal2.data.balance).toBe(200);
    });
  });

  describe('GET /balances/:address', () => {
    it('should return 0 for address with no UTXOs', async () => {
      const result = await getBalance('nonexistent');
      expect(result.status).toBe(200);
      expect(result.data.balance).toBe(0);
    });

    it('should return correct balance after multiple transactions', async () => {
      const block1 = {
        id: calculateBlockHash(1, ['tx1']),
        height: 1,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{ address: 'addr1', value: 100 }]
        }]
      };
      await postBlock(block1);

      const block2 = {
        id: calculateBlockHash(2, ['tx2']),
        height: 2,
        transactions: [{
          id: 'tx2',
          inputs: [],
          outputs: [{ address: 'addr1', value: 50 }]
        }]
      };
      await postBlock(block2);

      const balance = await getBalance('addr1');
      expect(balance.data.balance).toBe(150);
    });
  });

  describe('POST /rollback', () => {
    it('should rollback to previous height', async () => {
      const block1 = {
        id: calculateBlockHash(1, ['tx1']),
        height: 1,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{ address: 'addr1', value: 100 }]
        }]
      };
      await postBlock(block1);

      const block2 = {
        id: calculateBlockHash(2, ['tx2']),
        height: 2,
        transactions: [{
          id: 'tx2',
          inputs: [{ txId: 'tx1', index: 0 }],
          outputs: [
            { address: 'addr2', value: 60 },
            { address: 'addr3', value: 40 }
          ]
        }]
      };
      await postBlock(block2);

      const block3 = {
        id: calculateBlockHash(3, ['tx3']),
        height: 3,
        transactions: [{
          id: 'tx3',
          inputs: [{ txId: 'tx2', index: 1 }],
          outputs: [{ address: 'addr4', value: 40 }]
        }]
      };
      await postBlock(block3);


      const result = await rollback(2);
      expect(result.status).toBe(200);
      expect(result.data.success).toBe(true);


      const bal1 = await getBalance('addr1');
      expect(bal1.data.balance).toBe(0);

      const bal2 = await getBalance('addr2');
      expect(bal2.data.balance).toBe(60);

      const bal3 = await getBalance('addr3');
      expect(bal3.data.balance).toBe(40);

      const bal4 = await getBalance('addr4');
      expect(bal4.data.balance).toBe(0);
    });

    it('should reject rollback to future height', async () => {
      const result = await rollback(100);
      expect(result.status).toBe(400);
      expect(result.data.error).toContain('Cannot rollback');
    });

    it('should allow re-processing after rollback', async () => {
      const block1 = {
        id: calculateBlockHash(1, ['tx1']),
        height: 1,
        transactions: [{
          id: 'tx1',
          inputs: [],
          outputs: [{ address: 'addr1', value: 100 }]
        }]
      };
      await postBlock(block1);


      const block2 = {
        id: calculateBlockHash(2, ['tx2']),
        height: 2,
        transactions: [{
          id: 'tx2',
          inputs: [{ txId: 'tx1', index: 0 }],
          outputs: [{ address: 'addr2', value: 100 }]
        }]
      };
      await postBlock(block2);

      await rollback(1);

      const result = await postBlock(block2);
      expect(result.status).toBe(200);

      const balance = await getBalance('addr2');
      expect(balance.data.balance).toBe(100);
    });
  });
});

afterAll(async () => {
  await pool.end();
});