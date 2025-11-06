import { Pool } from 'pg';

export async function getOutputValue(
    pool: Pool,
    txId: string,
    index: number
): Promise<{ address: string; value: number } | null> {
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

export async function getBalance(pool: Pool, address: string): Promise<number> {
    const result = await pool.query(
        'SELECT COALESCE(SUM(value), 0) as balance FROM outputs WHERE address = $1 AND spent = FALSE',
        [address]
    );

    return parseInt(result.rows[0].balance);
}

