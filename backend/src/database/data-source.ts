import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { entities } from './entities';

// The repo-root .env is the single source of truth for both the host and the
// compose stack; fall back to a backend-local one if someone prefers that.
loadEnv({ path: '../.env' });
loadEnv();

/**
 * Used by the TypeORM CLI only (migration:generate / migration:run).
 * The running app builds its own DataSource from ConfigService.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER ?? 'adaptivehire',
  password: process.env.POSTGRES_PASSWORD ?? 'adaptivehire',
  database: process.env.POSTGRES_DB ?? 'adaptivehire',
  entities,
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
