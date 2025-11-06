import type { FastifyInstance } from 'fastify';
import type { Block } from '../types';
import { processBlock } from '../services/blockService';
import { getPool } from '../database/connection';

export async function blocksRoutes(fastify: FastifyInstance) {
    fastify.post('/blocks', async (request, reply) => {
        const pool = getPool();
        const block = request.body as Block;

        try {
            await processBlock(pool, block);
            return { success: true, height: block.height };
        } catch (error: any) {
            console.error('Error processing block:', error);
            return reply.code(400).send({
                error: error.message || 'Failed to process block'
            });
        }
    });
}

