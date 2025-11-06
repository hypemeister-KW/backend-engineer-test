import { Pool } from 'pg';
import type { Block, Input, Transaction } from '../types';
import { calculateBlockHash } from '../utils/hash';
import { getCurrentHeight } from './stateService';
import { getOutputValue } from './outputService';

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

async function validateTransaction(pool: Pool, tx: Transaction): Promise<void> {
    const hasInputs = tx.inputs.length > 0;
    const inputSum = hasInputs ? await calculateInputSum(pool, tx.inputs) : 0;
    const outputSum = tx.outputs.reduce((sum, out) => sum + out.value, 0);

    if (hasInputs && inputSum !== outputSum) {
        throw new Error(`Transaction ${tx.id}: input sum (${inputSum}) != output sum (${outputSum})`);
    }
}

export async function processBlock(pool: Pool, block: Block): Promise<void> {
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

        await client.query(
            'INSERT INTO blocks (id, height) VALUES ($1, $2)',
            [block.id, block.height]
        );

        for (const tx of block.transactions) {
            await validateTransaction(pool, tx);

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

export async function rollbackToHeight(pool: Pool, targetHeight: number): Promise<void> {
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

