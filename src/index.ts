import Fastify from 'fastify';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const fastify = Fastify({ logger: true });

interface Output {
  address: string;
  value: number;
}

interface Input {
  txId: string;
  index: number;
}

interface Transaction {
  id: string;
  inputs: Input[];
  outputs: Output[];
}

interface Block {
  id: string;
  height: number;
  transactions: Transaction[];
}

async function createTables(pool: Pool) {
  const client = await pool.connect();
  try {

    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id VARCHAR(255) PRIMARY KEY,
        height INTEGER UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);


    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(255) PRIMARY KEY,
        block_id VARCHAR(255) REFERENCES blocks(id) ON DELETE CASCADE,
        block_height INTEGER NOT NULL
      );
    `);


    await client.query(`
      CREATE TABLE IF NOT EXISTS outputs (
        tx_id VARCHAR(255) NOT NULL,
        output_index INTEGER NOT NULL,
        address VARCHAR(255) NOT NULL,
        value BIGINT NOT NULL,
        spent BOOLEAN DEFAULT FALSE,
        spent_by_tx VARCHAR(255),
        PRIMARY KEY (tx_id, output_index)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_outputs_address_spent 
      ON outputs(address, spent);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        current_height INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT single_row CHECK (id = 1)
      );
    `);


    await client.query(`
      INSERT INTO state (id, current_height) 
      VALUES (1, 0) 
      ON CONFLICT (id) DO NOTHING;
    `);

    console.log('Database initialized');
  } finally {
    client.release();
  }
}

function calculateBlockHash(height: number, txIds: string[]): string {
  const data = height.toString() + txIds.join('');
  return createHash('sha256').update(data).digest('hex');
}

async function getCurrentHeight(pool: Pool): Promise<number> {
  const result = await pool.query('SELECT current_height FROM state WHERE id = 1');
  return result.rows[0]?.current_height || 0;
}

async function getOutputValue(pool: Pool, txId: string, index: number): Promise<{ address: string; value: number } | null> {
  const result = await pool.query(
    'SELECT address, value FROM outputs WHERE tx_id = $1 AND output_index = $2',
    [txId, index]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    address: result.rows[0].address,
    value: parseInt(result.rows[0].value)
  };
}

async function calculateInputSum(pool: Pool, inputs: Input[]): Promise<number> {
  let sum = 0;

  for (const input of inputs) {
    const output = await getOutputValue(pool, input.txId, input.index);
    if (!output) {
      throw new Error(`Output not found: ${input.txId}[${input.index}]`);
    }
    sum += output.value;
  }

  return sum;
}

async function processBlock(pool: Pool, block: Block): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentHeight = await getCurrentHeight(pool);
    if (block.height !== currentHeight + 1) {
      throw new Error(`Invalid height: expected ${currentHeight + 1}, got ${block.height}`);
    }

    const txIds = block.transactions.map(tx => tx.id);
    const expectedHash = calculateBlockHash(block.height, txIds);
    if (block.id !== expectedHash) {
      throw new Error(`Invalid block hash: expected ${expectedHash}, got ${block.id}`);
    }

    for (const tx of block.transactions) {
      const inputSum = tx.inputs.length > 0 ? await calculateInputSum(pool, tx.inputs) : 0;
      const outputSum = tx.outputs.reduce((sum, out) => sum + out.value, 0);

      if (inputSum !== outputSum) {
        throw new Error(`Transaction ${tx.id}: input sum (${inputSum}) != output sum (${outputSum})`);
      }

      await client.query(
        'INSERT INTO transactions (id, block_id, block_height) VALUES ($1, $2, $3)',
        [tx.id, block.id, block.height]
      );

      for (const input of tx.inputs) {
        const result = await client.query(
          'UPDATE outputs SET spent = TRUE, spent_by_tx = $1 WHERE tx_id = $2 AND output_index = $3 AND spent = FALSE',
          [tx.id, input.txId, input.index]
        );

        if (result.rowCount === 0) {
          throw new Error(`Output already spent or not found: ${input.txId}[${input.index}]`);
        }
      }

      for (let i = 0; i < tx.outputs.length; i++) {
        const output = tx.outputs[i];
        await client.query(
          'INSERT INTO outputs (tx_id, output_index, address, value, spent) VALUES ($1, $2, $3, $4, FALSE)',
          [tx.id, i, output.address, output.value]
        );
      }
    }

    await client.query(
      'INSERT INTO blocks (id, height) VALUES ($1, $2)',
      [block.id, block.height]
    );

    await client.query(
      'UPDATE state SET current_height = $1 WHERE id = 1',
      [block.height]
    );

    await client.query('COMMIT');
    console.log(`Block ${block.height} processed successfully`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error processing block:`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function getBalance(pool: Pool, address: string): Promise<number> {
  const result = await pool.query(
    'SELECT COALESCE(SUM(value), 0) as balance FROM outputs WHERE address = $1 AND spent = FALSE',
    [address]
  );

  return parseInt(result.rows[0].balance);
}

async function rollbackToHeight(pool: Pool, targetHeight: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentHeight = await getCurrentHeight(pool);

    if (targetHeight > currentHeight) {
      throw new Error(`Cannot rollback to height ${targetHeight} (current: ${currentHeight})`);
    }

    if (currentHeight - targetHeight > 2000) {
      throw new Error(`Cannot rollback more than 2000 blocks (requested: ${currentHeight - targetHeight})`);
    }

    const blocksToRemove = await client.query(
      'SELECT id, height FROM blocks WHERE height > $1 ORDER BY height DESC',
      [targetHeight]
    );

    console.log(`Rolling back ${blocksToRemove.rows.length} blocks`);

    for (const block of blocksToRemove.rows) {
      const txs = await client.query(
        'SELECT id FROM transactions WHERE block_height = $1',
        [block.height]
      );

      for (const tx of txs.rows) {
        await client.query(
          'UPDATE outputs SET spent = FALSE, spent_by_tx = NULL WHERE spent_by_tx = $1',
          [tx.id]
        );

        await client.query(
          'DELETE FROM outputs WHERE tx_id = $1',
          [tx.id]
        );
      }

      await client.query(
        'DELETE FROM transactions WHERE block_height = $1',
        [block.height]
      );

      await client.query(
        'DELETE FROM blocks WHERE id = $1',
        [block.id]
      );
    }

    await client.query(
      'UPDATE state SET current_height = $1 WHERE id = 1',
      [targetHeight]
    );

    await client.query('COMMIT');
    console.log(`Rolled back to height ${targetHeight}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Rollback error:`, error);
    throw error;
  } finally {
    client.release();
  }
}



fastify.get('/', async (request, reply) => {
  return { hello: 'world' };
});

async function testPostgres(pool: Pool) {
  const id = randomUUID();
  const name = 'Satoshi';
  const email = 'Nakamoto';

  await pool.query(`DELETE FROM users;`);

  await pool.query(`
    INSERT INTO users (id, name, email)
    VALUES ($1, $2, $3);
  `, [id, name, email]);

  const { rows } = await pool.query(`
    SELECT * FROM users;
  `);

  console.log('USERS', rows);
}



async function bootstrap() {
  console.log('Bootstrapping...');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({
    connectionString: databaseUrl
  });

  await createTables(pool);
  await testPostgres(pool);
}

try {
  await bootstrap();
  await fastify.listen({
    port: 3000,
    host: '0.0.0.0'
  })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
};