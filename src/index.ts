import Fastify from 'fastify';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

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