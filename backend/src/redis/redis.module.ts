import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { connectionErrorReporter } from './connection-error-log';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * The application's own ioredis connection: session state and the
 * server-authoritative timer TTL keys.
 *
 * BullMQ talks to the same Redis *server* but does not share this client — it
 * is handed connection options in `app.module.ts` and builds its own, because a
 * worker needs a connection it can block on and blocking it would stall every
 * session read. This comment used to claim the connection was shared, which
 * made the missing error handling on BullMQ's side look deliberate; see
 * `queue-errors.module.ts`.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.getOrThrow<string>('redis.host');
        const port = config.getOrThrow<number>('redis.port');
        const logger = new Logger('Redis');

        const client = new Redis({
          host,
          port,
          // Matches what BullMQ requires of its own connections, so both
          // behave the same way when Redis goes away mid-request.
          maxRetriesPerRequest: null,
        });

        // Without an 'error' listener ioredis prints a bare
        // "Unhandled error event" stack that names neither Redis nor the
        // address it failed to reach.
        const errors = connectionErrorReporter(
          logger,
          (code) =>
            `Cannot reach Redis at ${host}:${port} (${code}). ` +
            `Is it running? \`docker compose up -d redis\``,
        );
        client.on('error', errors.report);

        client.on('ready', () => {
          errors.reset();
          logger.log(`Connected to Redis at ${host}:${port}`);
        });

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // `quit` rejects if the socket was never established (e.g. Redis was down
    // the whole time); disconnect unconditionally so shutdown can't hang.
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
