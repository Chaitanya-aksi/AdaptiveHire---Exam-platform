import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { readCaCert } from '../config/configuration';
import { entities } from './entities';

/*
 * Loaded nearest-file-first, and WITHOUT `override`, so an environment set by
 * the caller wins over both files.
 *
 * Both calls used to pass `override: true`, which made a caller-supplied
 * environment impossible to honour — the file clobbered it every time. That
 * turned out to matter: `test/global-teardown.ts` imports this module, so
 * running the e2e suites on a machine holding a production `.env` pointed the
 * suites at a local database (NestJS lets process env win) while pointing the
 * teardown sweep's DELETE statements at production. CI never saw it, because a
 * checkout has no `.env` at all and dotenv finds nothing to load.
 *
 * Reversing the order preserves the precedence between the two files —
 * `backend/.env` still beats the repo-root one — while dotenv's default
 * "first value wins, and an existing process.env value always wins" gives the
 * caller the last word. An ordinary `npm run migration:run` sets none of these
 * variables and so behaves exactly as before.
 */
loadEnv({ path: '.env' });
loadEnv({ path: '../.env' });

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
