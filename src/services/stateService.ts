import { Pool } from 'pg';

export async function getCurrentHeight(pool: Pool): Promise<number> {
    const result = await pool.query('SELECT current_height FROM state WHERE id = 1');
    return result.rows[0]?.current_height || 0;
}

