import { Pool } from 'pg';

export async function createTables(pool: Pool): Promise<void> {
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

