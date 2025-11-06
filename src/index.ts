import Fastify from 'fastify';
import { initializePool } from './database/connection';
import { createTables } from './database/migrations';
import { getConfig } from './config';
import { blocksRoutes } from './routes/blocks';
import { balancesRoutes } from './routes/balances';
import { rollbackRoutes } from './routes/rollback';
import { healthRoutes } from './routes/health';

const fastify = Fastify({ logger: true });

async function bootstrap() {
  console.log('Bootstrapping...');
  const config = getConfig();

  const pool = initializePool(config.databaseUrl);
  await createTables(pool);

  await fastify.register(blocksRoutes);
  await fastify.register(balancesRoutes);
  await fastify.register(rollbackRoutes);
  await fastify.register(healthRoutes);
}

try {
  await bootstrap();
  const config = getConfig();
  await fastify.listen({
    port: config.port,
    host: config.host
  });
  console.log(`Server listening on ${config.host}:${config.port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
