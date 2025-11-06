import type { FastifyInstance } from 'fastify';
import { getCurrentHeight } from '../services/stateService';
import { getPool } from '../database/connection';

export async function healthRoutes(fastify: FastifyInstance) {
    fastify.get('/health', async (request, reply) => {
        const pool = getPool();
        try {
            const height = await getCurrentHeight(pool);
            return { status: 'ok', currentHeight: height };
        } catch (error) {
            return reply.code(500).send({ status: 'error' });
        }
    });
}

