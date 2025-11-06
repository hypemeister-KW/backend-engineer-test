import type { FastifyInstance } from 'fastify';
import { getBalance } from '../services/outputService';
import { getPool } from '../database/connection';

export async function balancesRoutes(fastify: FastifyInstance) {
    fastify.get('/balances/:address', async (request, reply) => {
        const pool = getPool();
        const { address } = request.params as { address: string };

        try {
            const balance = await getBalance(pool, address);
            return { balance };
        } catch (error: any) {
            console.error('Error getting balance:', error);
            return reply.code(500).send({ error: 'Failed to get balance' });
        }
    });
}

