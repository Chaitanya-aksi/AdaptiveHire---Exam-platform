import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * One shared ioredis connection. Session state, the server-authoritative
 * timer TTL keys, and BullMQ all sit on this same instance.
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
          // Required by BullMQ, which shares this connection config.
          maxRetriesPerRequest: null,
        });

        // Without an 'error' listener ioredis prints a bare
        // "Unhandled error event" stack that names neither Redis nor the
        // address it failed to reach. Log it once per state change instead of
        // on every one of the endless reconnect attempts.
        let lastErrorCode: string | null = null;
        client.on('error', (err: NodeJS.ErrnoException) => {
          const code = err.code ?? err.message;
          if (code === lastErrorCode) return;
          lastErrorCode = code;
          logger.error(
            `Cannot reach Redis at ${host}:${port} (${code}). ` +
              `Is it running? \`docker compose up -d redis\``,
          );
        });

        client.on('ready', () => {
          lastErrorCode = null;
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
