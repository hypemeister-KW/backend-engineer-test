import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
    if (!pool) {
        throw new Error('Database pool not initialized. Call initializePool() first.');
    }
    return pool;
}

export function initializePool(connectionString: string): Pool {
    pool = new Pool({
        connectionString
    });
    return pool;
}

export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

