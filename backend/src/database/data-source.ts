import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { readCaCert } from '../config/configuration';
import { entities } from './entities';

loadEnv({ path: '../.env', override: true });
loadEnv({ path: '.env', override: true });

/**
 * The migration CLI's own connection. It deliberately does not go through
 * NestJS config — there is no application to boot — which is why the TLS rules
 * here must mirror `app.module.ts` by hand. Missing that is how migrations end
 * up failing against a managed provider that the running app connects to fine.
 *
 * Against a hosted database this runs from a developer's machine: a free
 * hosting tier gives the deployed service no shell, and running migrations from
 * the build command would apply schema changes while the previous version is
 * still serving traffic.
 */
const caCert = readCaCert(process.env.POSTGRES_CA_CERT);

export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER ?? 'adaptivehire',
  password: process.env.POSTGRES_PASSWORD ?? 'adaptivehire',
  database: process.env.POSTGRES_DB ?? 'adaptivehire',
  ssl:
    process.env.POSTGRES_SSL === 'true'
      ? { ca: caCert || undefined, rejectUnauthorized: Boolean(caCert) }
      : false,
  // Small on purpose: the CLI runs alongside the deployed app, which is already
  // holding connections against a free plan's low server-side ceiling.
  extra: { max: 2 },
  entities,
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
