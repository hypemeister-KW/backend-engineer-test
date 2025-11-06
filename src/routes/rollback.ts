import type { FastifyInstance } from 'fastify';
import { rollbackToHeight } from '../services/blockService';
import { getPool } from '../database/connection';

export async function rollbackRoutes(fastify: FastifyInstance) {
    fastify.post('/rollback', async (request, reply) => {
        const pool = getPool();
        const { height } = request.query as { height?: string };

        if (!height) {
            return reply.code(400).send({ error: 'height parameter is required' });
        }

        const targetHeight = parseInt(height);
        if (isNaN(targetHeight) || targetHeight < 0) {
            return reply.code(400).send({ error: 'height must be a valid positive number' });
        }

        try {
            await rollbackToHeight(pool, targetHeight);
            return { success: true, height: targetHeight };
        } catch (error: any) {
            console.error('Error during rollback:', error);
            return reply.code(400).send({ error: error.message || 'Rollback failed' });
        }
    });
}

